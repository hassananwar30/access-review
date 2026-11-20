export type NodeType = 'User' | 'ServiceAccount' | 'Group' | 'Role' | 'Resource'
export type EdgeType = 'MEMBER_OF' | 'ASSUMES' | 'GRANTS_READ' | 'GRANTS_WRITE' | 'GRANTS_ADMIN'

export interface GraphNode {
  id: string
  name: string
  type: NodeType
  department: string
  sensitivity?: 'low' | 'medium' | 'high' | 'critical'
  description: string
}

export interface GraphEdge {
  id: string
  sourceId: string
  targetId: string
  relation: EdgeType
  label?: string
  createdBy?: string
  justification?: string
}

export const permissionRank = { NONE: 0, READ: 1, WRITE: 2, ADMIN: 3 } as const
export type PermissionLevel = keyof typeof permissionRank
type GrantLevel = Exclude<PermissionLevel, 'NONE'>
const grants = { GRANTS_READ: 'READ', GRANTS_WRITE: 'WRITE', GRANTS_ADMIN: 'ADMIN' } as const

export interface AccessPath {
  nodeIds: string[]
  edgeIds: string[]
  level: GrantLevel
}

export interface EffectiveAccess {
  principalId: string
  resourceId: string
  isServiceAccount: boolean
  level: GrantLevel
  paths: AccessPath[]
}

function compareIds(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0
}

function isPrincipal(node: GraphNode) {
  return node.type === 'User' || node.type === 'ServiceAccount'
}

function indexGraph(nodes: readonly GraphNode[], edges: readonly GraphEdge[]) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const outgoing = new Map<string, GraphEdge[]>()
  for (const edge of edges) {
    if (!byId.has(edge.sourceId) || !byId.has(edge.targetId)) continue
    const siblings = outgoing.get(edge.sourceId)
    if (siblings) siblings.push(edge)
    else outgoing.set(edge.sourceId, [edge])
  }
  for (const siblings of outgoing.values()) siblings.sort((a, b) => compareIds(a.id, b.id))
  return { byId, outgoing }
}

function accessForPrincipal(
  graph: ReturnType<typeof indexGraph>,
  principal: GraphNode,
  resourceId?: string,
  visitEdge?: () => void,
): EffectiveAccess[] {
  const byResource = new Map<string, EffectiveAccess>()
  const nodeIds = [principal.id]
  const edgeIds: string[] = []
  const visited = new Set(nodeIds)
  const stack = [(graph.outgoing.get(principal.id) ?? []).values()]

  // Only the active DFS branch owns these nodes. A sibling may revisit a shared role.
  while (stack.length) {
    const next = stack[stack.length - 1].next()
    if (next.done) {
      stack.pop()
      visited.delete(nodeIds.pop()!)
      edgeIds.pop()
      continue
    }
    const edge = next.value
    visitEdge?.()
    if (visited.has(edge.targetId)) continue
    const target = graph.byId.get(edge.targetId)!
    if (edge.relation === 'MEMBER_OF' || edge.relation === 'ASSUMES') {
      if (target.type === 'Resource') continue
      visited.add(target.id)
      nodeIds.push(target.id)
      edgeIds.push(edge.id)
      stack.push((graph.outgoing.get(target.id) ?? []).values())
      continue
    }
    if (target.type !== 'Resource' || (resourceId !== undefined && target.id !== resourceId)) continue

    const level = grants[edge.relation]
    const access: EffectiveAccess = byResource.get(target.id) ?? {
      principalId: principal.id, resourceId: target.id, isServiceAccount: principal.type === 'ServiceAccount',
      level, paths: [],
    }
    if (permissionRank[level] > permissionRank[access.level]) access.level = level
    access.paths.push({ nodeIds: [...nodeIds, target.id], edgeIds: [...edgeIds, edge.id], level })
    byResource.set(target.id, access)
  }
  return [...byResource.values()].sort((a, b) => compareIds(a.resourceId, b.resourceId))
}

/** One entry per reachable principal/resource pair, in stable ID order. */
export function computeEffectiveAccess(nodes: readonly GraphNode[], edges: readonly GraphEdge[]) {
  const graph = indexGraph(nodes, edges)
  const principals = nodes.filter(isPrincipal).sort((a, b) => compareIds(a.id, b.id))
  return principals.flatMap(principal => accessForPrincipal(graph, principal))
}

/** Simple-path enumeration can be exponential even on a small cyclic graph. */
export function canEnumerateGraph(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): boolean {
  const graph = indexGraph(nodes, edges)
  const limitReached = new Error('Graph traversal limit')
  let remaining = 25_000
  try {
    for (const principal of nodes.filter(isPrincipal)) {
      accessForPrincipal(graph, principal, undefined, () => {
        if (--remaining < 0) throw limitReached
      })
    }
    return true
  } catch (error) {
    if (error !== limitReached) throw error
    return false
  }
}

export interface AccessChange {
  principalId: string
  resourceId: string
  isServiceAccount: boolean
  beforeLevel: GrantLevel
  afterLevel: PermissionLevel
  brokenPaths: AccessPath[]
  survivingPaths: AccessPath[]
}

function pathIsBroken(path: AccessPath, removed: ReadonlySet<string>) {
  return path.edgeIds.some(id => removed.has(id))
}

export function simulateEdgeRemoval(
  nodes: readonly GraphNode[], edges: readonly GraphEdge[], edgeIdsToRemove: readonly string[],
) {
  const removed = new Set(edgeIdsToRemove)
  const before = computeEffectiveAccess(nodes, edges)
  const after = computeEffectiveAccess(nodes, edges.filter(edge => !removed.has(edge.id)))
  const pairKey = (access: EffectiveAccess) => JSON.stringify([access.principalId, access.resourceId])
  const remaining = new Map(after.map(access => [pairKey(access), access]))
  const losesAccess: AccessChange[] = []
  const downgradedAccess: AccessChange[] = []
  const keepsAccessViaShadowPath: (AccessChange & { shadowPaths: AccessPath[] })[] = []
  const impacted = new Set<string>()
  const brokenAccounts = new Set<string>()
  const downgradedAccounts = new Set<string>()

  for (const access of before) {
    const brokenPaths = access.paths.filter(path => pathIsBroken(path, removed))
    if (!brokenPaths.length) continue
    const successor = remaining.get(pairKey(access))
    const change: AccessChange = {
      principalId: access.principalId,
      resourceId: access.resourceId,
      isServiceAccount: access.isServiceAccount,
      beforeLevel: access.level,
      afterLevel: successor?.level ?? 'NONE',
      brokenPaths,
      survivingPaths: successor?.paths ?? [],
    }
    impacted.add(access.principalId)
    if (!successor) {
      losesAccess.push(change)
      if (access.isServiceAccount) brokenAccounts.add(access.principalId)
    } else if (successor.level !== access.level) {
      downgradedAccess.push(change)
      if (access.isServiceAccount) downgradedAccounts.add(access.principalId)
    } else {
      const shadowPaths = successor.paths.filter(path => path.level === access.level)
      keepsAccessViaShadowPath.push({ ...change, shadowPaths })
    }
  }
  return {
    losesAccess, downgradedAccess, keepsAccessViaShadowPath,
    summary: {
      principalsImpacted: impacted.size,
      accessLostCount: losesAccess.length,
      shadowAccessCount: keepsAccessViaShadowPath.length,
      downgradedCount: downgradedAccess.length,
      serviceAccountsBroken: brokenAccounts.size,
      serviceAccountsDowngraded: downgradedAccounts.size,
    },
  }
}

export function findShadowAccessPaths(
  nodes: readonly GraphNode[], edges: readonly GraphEdge[], principalId: string, resourceId: string,
) {
  const graph = indexGraph(nodes, edges)
  const principal = graph.byId.get(principalId)
  const [access] = principal && isPrincipal(principal) ? accessForPrincipal(graph, principal, resourceId) : []
  const paths = access?.paths ?? []
  const level: PermissionLevel = access?.level ?? 'NONE'
  const strongestCount = paths.filter(path => path.level === level).length
  return {
    principalId, resourceId, level,
    // Another path grants at least this level. Paths may still share individual edges.
    paths: paths.map(path => ({ ...path, isRedundant: path.level !== level || strongestCount > 1 })),
  }
}

function cutCollateral(access: EffectiveAccess[], removed: ReadonlySet<string>) {
  const impacted = new Set<string>()
  const accountsImpacted = new Set<string>()
  const losingPrivilege = new Set<string>()
  const brokenAccounts = new Set<string>()
  for (const pair of access) {
    const surviving = pair.paths.filter(path => !pathIsBroken(path, removed))
    if (surviving.length === pair.paths.length) continue
    impacted.add(pair.principalId)
    if (pair.isServiceAccount) accountsImpacted.add(pair.principalId)
    if (!surviving.some(path => path.level === pair.level)) losingPrivilege.add(pair.principalId)
    if (pair.isServiceAccount && !surviving.length) brokenAccounts.add(pair.principalId)
  }
  return {
    principalsImpacted: impacted.size,
    serviceAccountsImpacted: accountsImpacted.size,
    principalsLosingPrivilege: losingPrivilege.size,
    serviceAccountsBroken: brokenAccounts.size,
  }
}

export interface MinimalCutResult {
  /** Zero means already revoked. Null means no cut fits within three edges. */
  size: number | null
  candidates: { edgeIds: string[], collateral: ReturnType<typeof cutCollateral> }[]
}

export function findMinimalCut(
  nodes: readonly GraphNode[], edges: readonly GraphEdge[], principalId: string, resourceId: string,
): MinimalCutResult {
  const before = computeEffectiveAccess(nodes, edges)
  const target = before.find(pair => pair.principalId === principalId && pair.resourceId === resourceId)
  if (!target) return { size: 0, candidates: [] }
  const others = before.filter(pair => pair.principalId !== principalId)

  // Every valid cut must hit the first unbroken path. Branch only on its edges.
  // Each frontier contains unique edge sets of one size, so the first hits are all minimum cuts.
  let frontier: string[][] = [[]]
  for (let size = 0; size <= 3; size++) {
    const next = new Map<string, string[]>()
    const candidates: MinimalCutResult['candidates'] = []
    for (const edgeIds of frontier) {
      const removed = new Set(edgeIds)
      const unbroken = target.paths.find(path => !pathIsBroken(path, removed))
      if (!unbroken) {
        candidates.push({ edgeIds, collateral: cutCollateral(others, removed) })
      } else if (size < 3 && !candidates.length) {
        for (const edgeId of unbroken.edgeIds) {
          const extended = [...edgeIds, edgeId].sort(compareIds)
          next.set(JSON.stringify(extended), extended)
        }
      }
    }
    if (candidates.length) {
      candidates.sort((a, b) =>
        a.collateral.serviceAccountsBroken - b.collateral.serviceAccountsBroken
        || a.collateral.principalsLosingPrivilege - b.collateral.principalsLosingPrivilege
        || a.collateral.principalsImpacted - b.collateral.principalsImpacted
        || compareIds(JSON.stringify(a.edgeIds), JSON.stringify(b.edgeIds)))
      return { size, candidates }
    }
    frontier = [...next.values()]
  }
  return { size: null, candidates: [] }
}

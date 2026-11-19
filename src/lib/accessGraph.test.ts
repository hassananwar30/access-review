import { describe, expect, it } from 'vitest'
import {
  computeEffectiveAccess, findMinimalCut, findShadowAccessPaths, simulateEdgeRemoval,
  type EdgeType, type GraphEdge, type GraphNode, type NodeType,
} from './accessGraph'
import { seedEdges, seedNodes } from './seedOrg'

function node(id: string, type: NodeType): GraphNode {
  return { id, name: id, type, department: 'Test', description: id }
}

function edge(id: string, sourceId: string, relation: EdgeType, targetId: string): GraphEdge {
  return { id, sourceId, relation, targetId }
}

const payments = 'prod-payments-db'
const pii = 'prod-customer-pii'
const cluster = 'k8s-prod-cluster'
const danaContract = 'dana:MEMBER_OF:contractors'
const contractorAdmin = 'contractors:ASSUMES:db-admin'
const simulateSeed = (...removed: string[]) => simulateEdgeRemoval(seedNodes, seedEdges, removed)

describe('Kestrel Cloud', () => {
  it('has stable unique keys, connected edge endpoints, and the specified seed population', () => {
    const ids = new Set(seedNodes.map(n => n.id))
    expect(ids.size).toBe(seedNodes.length)
    expect(seedNodes).toHaveLength(28)
    expect(seedNodes.filter(n => n.type === 'User')).toHaveLength(8)
    expect(seedNodes.filter(n => n.type === 'ServiceAccount')).toHaveLength(2)
    expect(new Set(seedEdges.map(e => e.id)).size).toBe(seedEdges.length)
    expect(seedEdges.length).toBeGreaterThanOrEqual(45)
    expect(seedEdges.length).toBeLessThanOrEqual(52)
    expect(seedEdges.every(e => ids.has(e.sourceId) && ids.has(e.targetId))).toBe(true)
  })

  it.each([danaContract, contractorAdmin])('explains why Dana retains ADMIN after removing %s', removed => {
    const result = simulateSeed(removed)
    const dana = result.keepsAccessViaShadowPath.find(p => p.principalId === 'dana' && p.resourceId === payments)
    const grant = 'db-admin:GRANTS_ADMIN:' + payments
    expect(dana).toMatchObject({
      beforeLevel: 'ADMIN', afterLevel: 'ADMIN',
      brokenPaths: [{
        nodeIds: ['dana', 'contractors', 'db-admin', payments],
        edgeIds: [danaContract, contractorAdmin, grant], level: 'ADMIN',
      }],
      shadowPaths: [{
        nodeIds: ['dana', 'ops-oncall', 'legacy-vpn', 'db-admin', payments],
        edgeIds: ['dana:MEMBER_OF:ops-oncall', 'ops-oncall:MEMBER_OF:legacy-vpn', 'legacy-vpn:ASSUMES:db-admin', grant],
        level: 'ADMIN',
      }],
    })
  })

  it('downgrades Alex from ADMIN to READ through the data team', () => {
    const result = simulateSeed('alex:MEMBER_OF:platform-sre')
    expect(result.downgradedAccess.find(p => p.principalId === 'alex' && p.resourceId === pii)).toMatchObject({
      beforeLevel: 'ADMIN', afterLevel: 'READ',
      brokenPaths: [{ nodeIds: ['alex', 'platform-sre', 'db-admin', pii] }],
      survivingPaths: [{ nodeIds: ['alex', 'data-team', 'analytics-reader', pii], level: 'READ' }],
    })
  })

  it('flags the CI bot alongside the humans who lose production deployment access', () => {
    const result = simulateSeed('ci-release:GRANTS_WRITE:' + cluster)
    expect(result.summary).toEqual({
      principalsImpacted: 5, accessLostCount: 5, shadowAccessCount: 0, downgradedCount: 0,
      serviceAccountsBroken: 1, serviceAccountsDowngraded: 0,
    })
    expect(result.losesAccess.map(p => p.principalId)).toEqual(['alex', 'ci-deploy-bot', 'dana', 'liam', 'marcus'])
    expect(result.losesAccess.every(p => p.resourceId === cluster && p.afterLevel === 'NONE')).toBe(true)
    expect(result.losesAccess.filter(p => p.isServiceAccount)).toMatchObject([{
      principalId: 'ci-deploy-bot', beforeLevel: 'WRITE', survivingPaths: [],
      brokenPaths: [{ nodeIds: ['ci-deploy-bot', 'ci-release', cluster] }],
    }])
  })

  it('revokes only Chloe’s ticket access and identifies her assignment as a zero-collateral cut', () => {
    const assignment = 'chloe:ASSUMES:support-viewer'
    const result = simulateSeed(assignment)
    expect(result.summary).toEqual({
      principalsImpacted: 1, accessLostCount: 1, downgradedCount: 0, shadowAccessCount: 0,
      serviceAccountsBroken: 0, serviceAccountsDowngraded: 0,
    })
    expect(result.losesAccess).toMatchObject([{ principalId: 'chloe', resourceId: 'support-tickets', afterLevel: 'NONE' }])
    const cut = findMinimalCut(seedNodes, seedEdges, 'chloe', 'support-tickets')
    expect(cut.size).toBe(1)
    expect(cut.candidates[0]).toMatchObject({ edgeIds: [assignment], collateral: { principalsImpacted: 0 } })
  })

  it('produces the same results for reordered inputs without mutating the graph', () => {
    const original = JSON.stringify([seedNodes, seedEdges])
    const reversedNodes = [...seedNodes].reverse()
    const reversedEdges = [...seedEdges].reverse()
    expect(computeEffectiveAccess(reversedNodes, reversedEdges)).toEqual(computeEffectiveAccess(seedNodes, seedEdges))
    expect(simulateEdgeRemoval(reversedNodes, reversedEdges, [contractorAdmin, danaContract, danaContract]))
      .toEqual(simulateSeed(danaContract, contractorAdmin))
    expect(findMinimalCut(reversedNodes, reversedEdges, 'dana', payments))
      .toEqual(findMinimalCut(seedNodes, seedEdges, 'dana', payments))
    expect(JSON.stringify([seedNodes, seedEdges])).toBe(original)
  })
})

describe('reachability and revocation', () => {
  const nodes = [node('u', 'User'), node('b', 'ServiceAccount'), node('g', 'Group'), node('r', 'Role'), node('x', 'Resource')]
  const edges = [
    edge('member', 'u', 'MEMBER_OF', 'g'), edge('assume', 'g', 'ASSUMES', 'r'),
    edge('write', 'r', 'GRANTS_WRITE', 'x'), edge('read', 'u', 'GRANTS_READ', 'x'),
    edge('admin', 'u', 'GRANTS_ADMIN', 'x'), edge('assume-bot', 'b', 'ASSUMES', 'r'),
  ]

  it('traverses only simple grant-terminated paths and ignores dangling or invalid grants', () => {
    const graph = [
      ...edges, edge('self', 'g', 'MEMBER_OF', 'g'), edge('cycle', 'r', 'MEMBER_OF', 'g'),
      edge('grant-to-role', 'u', 'GRANTS_ADMIN', 'r'), edge('membership-to-resource', 'u', 'MEMBER_OF', 'x'),
      edge('through-resource', 'x', 'ASSUMES', 'r'), edge('dangling', 'r', 'GRANTS_ADMIN', 'absent'),
      edge('unknown-source', 'missing', 'ASSUMES', 'r'),
    ]
    expect(computeEffectiveAccess(nodes, graph)).toEqual([
      { principalId: 'b', isServiceAccount: true, resourceId: 'x', level: 'WRITE',
        paths: [{ nodeIds: ['b', 'r', 'x'], edgeIds: ['assume-bot', 'write'], level: 'WRITE' }] },
      { principalId: 'u', isServiceAccount: false, resourceId: 'x', level: 'ADMIN', paths: [
        { nodeIds: ['u', 'x'], edgeIds: ['admin'], level: 'ADMIN' },
        { nodeIds: ['u', 'g', 'r', 'x'], edgeIds: ['member', 'assume', 'write'], level: 'WRITE' },
        { nodeIds: ['u', 'x'], edgeIds: ['read'], level: 'READ' },
      ] },
    ])
  })

  it('marks a path redundant when another path supplies at least its privilege', () => {
    const paths = findShadowAccessPaths(nodes, edges, 'u', 'x')
    expect(paths.level).toBe('ADMIN')
    expect(paths.paths.map(p => [p.level, p.isRedundant])).toEqual([['ADMIN', false], ['WRITE', true], ['READ', true]])
    const dana = findShadowAccessPaths(seedNodes, seedEdges, 'dana', payments)
    expect(dana.paths).toHaveLength(2)
    expect(dana.paths.every(p => p.isRedundant)).toBe(true)
    for (const [principal, resource] of [['missing', 'x'], ['g', 'x'], ['u', 'missing'], ['u', 'r']]) {
      expect(findShadowAccessPaths(nodes, edges, principal, resource)).toMatchObject({ level: 'NONE', paths: [] })
    }
  })

  it('keeps all surviving paths and highlights only paths explaining the original privilege', () => {
    const result = simulateEdgeRemoval(nodes, edges, ['write'])
    const [shadow] = result.keepsAccessViaShadowPath
    expect(shadow.brokenPaths.map(p => p.level)).toEqual(['WRITE'])
    expect(shadow.survivingPaths.map(p => p.level)).toEqual(['ADMIN', 'READ'])
    expect(shadow.shadowPaths.map(p => p.edgeIds)).toEqual([['admin']])
    expect(result.losesAccess.map(p => p.principalId)).toEqual(['b'])
    expect(result.summary.principalsImpacted).toBe(2)
  })

  it('handles batch removal and counts broken accounts once across multiple resources', () => {
    const graph = [...edges, edge('second', 'r', 'GRANTS_ADMIN', 'y')]
    const result = simulateEdgeRemoval([...nodes, node('y', 'Resource')], graph, ['assume-bot', 'admin', 'member', 'member'])
    expect(result.summary).toEqual({
      principalsImpacted: 2, serviceAccountsBroken: 1, accessLostCount: 3, downgradedCount: 1, shadowAccessCount: 0,
      serviceAccountsDowngraded: 0,
    })
    expect(result.downgradedAccess).toMatchObject([{ principalId: 'u', resourceId: 'x', afterLevel: 'READ' }])
  })

  it('flags a service account that keeps read access after losing write access', () => {
    const graph = [...edges, edge('bot-read', 'b', 'GRANTS_READ', 'x')]
    const result = simulateEdgeRemoval(nodes, graph, ['write'])
    expect(result.downgradedAccess).toMatchObject([{
      principalId: 'b', isServiceAccount: true, beforeLevel: 'WRITE', afterLevel: 'READ',
    }])
    expect(result.summary).toMatchObject({ serviceAccountsBroken: 0, serviceAccountsDowngraded: 1 })
  })

  it('leaves untouched pairs out of every impact category', () => {
    expect(computeEffectiveAccess([], [])).toEqual([])
    for (const removed of [[], ['unknown']]) {
      expect(simulateEdgeRemoval(nodes, edges, removed)).toEqual({
        losesAccess: [], downgradedAccess: [], keepsAccessViaShadowPath: [],
        summary: {
          principalsImpacted: 0, accessLostCount: 0, downgradedCount: 0, shadowAccessCount: 0,
          serviceAccountsBroken: 0, serviceAccountsDowngraded: 0,
        },
      })
    }
  })
})

describe('bounded minimum cuts', () => {
  it.each([2, 3])('finds every smallest cut across %i independent two-edge paths', count => {
    const nodes = [node('u', 'User'), node('x', 'Resource')]
    const edges: GraphEdge[] = []
    let expected: string[][] = [[]]
    for (let i = 0; i < count; i++) {
      const id = 'r' + i
      nodes.push(node(id, 'Role'))
      edges.push(edge('in' + i, 'u', 'ASSUMES', id), edge('out' + i, id, 'GRANTS_READ', 'x'))
      expected = expected.flatMap(cut => ['in' + i, 'out' + i].map(e => [...cut, e].sort()))
    }
    const result = findMinimalCut(nodes, edges, 'u', 'x')
    expect(result.size).toBe(count)
    expect(new Set(result.candidates.map(c => JSON.stringify(c.edgeIds)))).toEqual(new Set(expected.map(c => JSON.stringify(c))))
    expect(result.candidates).toHaveLength(2 ** count)
  })

  it('distinguishes no access from access requiring more than three removals', () => {
    const nodes = [node('u', 'User'), node('x', 'Resource')]
    const edges = ['a', 'b', 'c', 'd'].map(id => edge(id, 'u', 'GRANTS_READ', 'x'))
    expect(findMinimalCut(nodes, [], 'u', 'x')).toEqual({ size: 0, candidates: [] })
    expect(findMinimalCut(nodes, edges, 'u', 'x')).toEqual({ size: null, candidates: [] })
  })

  it('counts other principals once across resources and separates lost paths from lost privilege', () => {
    const nodes = [
      node('u', 'User'), node('v', 'User'), node('b', 'ServiceAccount'), node('g', 'Group'),
      node('r', 'Role'), node('x', 'Resource'), node('y', 'Resource'),
    ]
    const edges = [
      ...['u', 'v', 'b'].map(id => edge(id, id, 'MEMBER_OF', 'g')),
      edge('shared', 'g', 'ASSUMES', 'r'), edge('grant-x', 'r', 'GRANTS_ADMIN', 'x'),
      edge('grant-y', 'r', 'GRANTS_READ', 'y'), edge('v-x', 'v', 'GRANTS_ADMIN', 'x'),
      edge('v-y', 'v', 'GRANTS_READ', 'y'),
    ]
    const result = findMinimalCut(nodes, edges, 'u', 'x')
    expect(result.size).toBe(1)
    expect(result.candidates.map(c => c.edgeIds)).toEqual([['u'], ['grant-x'], ['shared']])
    expect(result.candidates[0].collateral).toEqual({
      principalsImpacted: 0, serviceAccountsImpacted: 0, principalsLosingPrivilege: 0, serviceAccountsBroken: 0,
    })
    for (const candidate of result.candidates.slice(1)) {
      expect(candidate.collateral).toEqual({
        principalsImpacted: 2, serviceAccountsImpacted: 1, principalsLosingPrivilege: 1, serviceAccountsBroken: 1,
      })
    }
  })
})

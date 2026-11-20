import { RECORD_NOT_FOUND, type ActionResult, type GetActionData, type QueryActionData } from 'deepspace/worker'
import { z } from 'zod'
import { canEnumerateGraph, simulateEdgeRemoval } from '../lib/accessGraph'
import { orgGraphSchema } from '../lib/orgGraphJson'
import { graphFromRecords, type EdgeRecord, type NodeRecord } from '../lib/reviewGraph'
import { seedEdges, seedNodes } from '../lib/seedOrg'

type Execute = <T>(userId: string, tool: string, params: Record<string, unknown>) => Promise<ActionResult<T>>
type RecordKey = { collection: string; recordId: string }
type Write = RecordKey & { data: Record<string, unknown> }
type Change = Write | RecordKey
type ReviewPlan = { actorId: string; refreshGraph?: boolean } & ({ writes: Change[] } | { chunks: number })
const journalKey = 'access-review:pending-operation'
const journalChunk = (index: number) => `${journalKey}:${index}`
const edgeSelection = z.array(z.string().min(1).max(256)).min(1).max(100)
const submission = z.object({
  title: z.string().trim().min(1).max(160),
  rationale: z.string().trim().min(1).max(4000),
  edgeIds: edgeSelection,
})
const decision = z.object({
  proposalId: z.string().min(1).max(128),
  reason: z.string().trim().max(4000).optional(),
})

export const reviewActions = ['createRevocationProposal', 'applyRevocation', 'rejectProposal', 'resetDemoOrg', 'importOrgGraph'] as const
export type ReviewAction = typeof reviewActions[number]

function unwrap<T>(result: ActionResult<T>): T {
  if (!result.success) throw new Error(result.error)
  return result.data
}

const failure = (status: number, error: string) => Response.json({ success: false, error }, { status })

export async function runReviewAction(
  name: ReviewAction, actorId: string, params: unknown, ownerId: string,
  execute: Execute, storage: DurableObjectStorage, refreshSubscriptions: () => void,
): Promise<Response> {
  const get = (collection: string, recordId: string) =>
    execute<GetActionData>(actorId, 'records.get', { collection, recordId })
  const role = actorId === ownerId ? 'admin' : (await get('users', actorId)).data?.record.data.role
  if (role !== 'admin' && !(role === 'member' && name === 'createRevocationProposal')) {
    return failure(403, 'Your role cannot perform this action.')
  }

  // The RecordRoom serializes review actions. Persist the write plan first so
  // interrupted writes can resume with the original actor, IDs and blast summary.
  async function finish(plan: ReviewPlan) {
    async function apply(changes: Change[]) {
      for (const change of changes) {
        if ('data' in change) {
          unwrap(await execute(plan.actorId, 'records.create', change))
        } else {
          const result = await execute(plan.actorId, 'records.delete', change)
          if (result.success === false && result.error !== RECORD_NOT_FOUND) unwrap(result)
        }
      }
    }
    const chunks = 'chunks' in plan ? plan.chunks : 0
    if ('writes' in plan) await apply(plan.writes)
    for (let index = 0; index < chunks; index++) {
      const changes = await storage.get<Change[]>(journalChunk(index))
      if (!changes) throw new Error('Incomplete review operation journal')
      await apply(changes)
    }
    await storage.transaction(async txn => {
      await txn.delete(journalKey)
      for (let index = 0; index < chunks; index++) await txn.delete(journalChunk(index))
    })
    if (plan.refreshGraph) refreshSubscriptions()
  }
  const interrupted = await storage.get<ReviewPlan>(journalKey)
  if (interrupted) await finish(interrupted)

  async function commit(changes: Change[], refreshGraph = false) {
    // A graph can exceed the per-value storage limit. Keep bounded chunks under
    // one journal transaction, and keep support for an in-flight legacy plan.
    const chunkSize = 8
    const plan = { actorId, chunks: Math.ceil(changes.length / chunkSize), refreshGraph }
    await storage.transaction(async txn => {
      await txn.put(journalKey, plan)
      for (let index = 0; index < plan.chunks; index++) {
        await txn.put(journalChunk(index), changes.slice(index * chunkSize, (index + 1) * chunkSize))
      }
    })
    await finish(plan)
  }
  async function query<T extends Record<string, unknown>>(collection: string, orderBy = 'createdAt', where?: Record<string, unknown>) {
    let offset: number | undefined = 0
    const records: QueryActionData<T>['records'] = []
    while (offset !== undefined) {
      const page: QueryActionData<T> & { nextOffset?: number } = unwrap(await execute(actorId, 'records.query', {
        collection, where, offset, limit: 100, orderBy, orderDir: 'asc',
      }))
      records.push(...page.records)
      offset = page.nextOffset
    }
    return records
  }

  const timestamp = new Date().toISOString()
  function audit(action: string, edgeIds: string[], summary: unknown, proposalId?: string): Write {
    return {
      collection: 'audit_logs', recordId: crypto.randomUUID(),
      data: {
        action, actorId, actorRole: role, proposalId, timestamp,
        targetEdgeIdsJson: JSON.stringify(edgeIds), blastSummaryJson: JSON.stringify(summary),
      },
    }
  }

  if (name === 'resetDemoOrg' || name === 'importOrgGraph') {
    const reset = name === 'resetDemoOrg'
    const parsed = reset ? { success: true as const, data: { nodes: seedNodes, edges: seedEdges } } : orgGraphSchema.safeParse(params)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return failure(400, `${issue.path.join('.') || 'Graph'}: ${issue.message}`)
    }
    const { nodes, edges } = parsed.data
    if (!reset && !canEnumerateGraph(nodes, edges)) {
      return failure(422, 'This graph has too many alternate paths to simulate safely. Simplify nested memberships or role chains.')
    }
    const previousNodes = await query<NodeRecord & Record<string, unknown>>('graph_nodes', 'nodeKey')
    const previousEdges = await query<EdgeRecord & Record<string, unknown>>('graph_edges', 'edgeKey')
    const previousNodeById = new Map(previousNodes.map(record => [record.data.nodeKey, record]))
    const incomingNodeTypes = new Map(nodes.map(node => [node.id, node.type]))
    const incomingEdges = new Map(edges.map(edge => [edge.id, edge]))
    const preservedEdges = new Set(previousEdges.flatMap(({ data }) => {
      const edge = incomingEdges.get(data.edgeKey)
      const matches = edge && (data.isActive === true || data.isActive === 1)
        && edge.sourceId === data.sourceKey && edge.targetId === data.targetKey && edge.relation === data.relation
        && previousNodeById.get(edge.sourceId)?.data.nodeType === incomingNodeTypes.get(edge.sourceId)
        && previousNodeById.get(edge.targetId)?.data.nodeType === incomingNodeTypes.get(edge.targetId)
      return matches ? [data.edgeKey] : []
    }))
    const proposals = await query<{ edgeIdsJson: string }>('revocation_proposals', 'createdAt', reset ? undefined : { status: 'pending' })
    const staleProposals = new Set(proposals.filter(({ data }) => {
      if (reset) return true
      try {
        const result = edgeSelection.safeParse(JSON.parse(data.edgeIdsJson))
        return !result.success || result.data.some(id => !preservedEdges.has(id))
      } catch {
        return true
      }
    }).map(record => record.recordId))
    const comments = reset || staleProposals.size ? await query<{ proposalId: string }>('proposal_comments') : []

    const changes: Change[] = [
      ...comments.filter(({ data }) => reset || staleProposals.has(data.proposalId))
        .map(({ recordId }) => ({ collection: 'proposal_comments', recordId })),
      ...[...staleProposals].map(recordId => ({ collection: 'revocation_proposals', recordId })),
      ...previousEdges.map(({ recordId }) => ({ collection: 'graph_edges', recordId })),
      ...previousNodes.filter(({ data }) => !incomingNodeTypes.has(data.nodeKey))
        .map(({ recordId }) => ({ collection: 'graph_nodes', recordId })),
    ]
    changes.push(...nodes.map(({ id, type, sensitivity, ...data }) => ({
      collection: 'graph_nodes', recordId: previousNodeById.get(id)?.recordId ?? crypto.randomUUID(),
      data: { ...data, nodeKey: id, nodeType: type, sensitivity: sensitivity ?? null },
    })))
    changes.push(...edges.map(({ id, sourceId, targetId, relation, label, justification }) => ({
      collection: 'graph_edges', recordId: crypto.randomUUID(),
      data: { edgeKey: id, sourceKey: sourceId, targetKey: targetId, relation, label, justification, isActive: true },
    })))
    const counts = { nodes: nodes.length, edges: edges.length, clearedProposals: staleProposals.size }
    changes.push(audit(reset ? 'ORG_RESET' : 'ORG_IMPORTED', [], counts))
    await commit(changes, true)
    return Response.json({ success: true, data: counts })
  }

  const request = { title: '', rationale: '', edgeIds: [] as string[], proposalId: '', reason: '' }
  if (name === 'createRevocationProposal') {
    const parsed = submission.safeParse(params)
    if (!parsed.success) return failure(400, 'Provide a title, rationale, and at least one permission edge.')
    Object.assign(request, parsed.data, { proposalId: crypto.randomUUID() })
  } else {
    const parsed = decision.safeParse(params)
    if (!parsed.success) return failure(400, 'Provide a proposal ID and a valid review note.')
    request.proposalId = parsed.data.proposalId
    request.reason = parsed.data.reason ?? ''
    if (name === 'rejectProposal' && !request.reason) return failure(400, 'Provide a reason for rejection.')
    const result = await get('revocation_proposals', request.proposalId)
    if (!result.success) {
      if (result.error?.startsWith('Record not found')) return failure(404, 'Proposal not found.')
      unwrap(result)
    }
    const proposal = result.data!.record.data
    if (proposal.status !== 'pending') return failure(409, 'This proposal has already been reviewed.')
    const parsedEdges = edgeSelection.safeParse(JSON.parse(String(proposal.edgeIdsJson)))
    if (!parsedEdges.success) return failure(409, 'This proposal has an invalid edge selection.')
    request.edgeIds = parsedEdges.data
    if (name === 'rejectProposal') {
      await commit([
        audit('PROPOSAL_REJECTED', request.edgeIds, JSON.parse(String(proposal.blastSummaryJson)), request.proposalId),
        {
          collection: 'revocation_proposals', recordId: request.proposalId,
          data: { status: 'rejected', reviewedBy: actorId, reviewedAt: timestamp, reviewNote: request.reason },
        },
      ])
      return Response.json({ success: true, data: { proposalId: request.proposalId } })
    }
  }

  const edgeIds = [...new Set(request.edgeIds)].sort()
  const nodeRecords = await query<NodeRecord & Record<string, unknown>>('graph_nodes', 'nodeKey')
  const edgeRecords = await query<EdgeRecord & Record<string, unknown>>('graph_edges', 'edgeKey', { isActive: 1 })
  const { nodes, edges } = graphFromRecords(nodeRecords, edgeRecords)
  const activeIds = new Map(edgeRecords.map(({ recordId, data }) => [data.edgeKey, recordId]))
  if (!edgeIds.every(id => edges.some(edge => edge.id === id))) {
    return failure(409, 'An edge is no longer active. Refresh the simulation.')
  }
  const { summary } = simulateEdgeRemoval(nodes, edges, edgeIds)
  const blastSummaryJson = JSON.stringify(summary)
  const recordId = request.proposalId

  if (name === 'createRevocationProposal') {
    await commit([{
      collection: 'revocation_proposals', recordId,
      data: {
        title: request.title, rationale: request.rationale, edgeIdsJson: JSON.stringify(edgeIds),
        status: 'pending', createdBy: actorId, blastSummaryJson,
      },
    }])
  } else {
    const writes = edgeIds.map(id => ({
      collection: 'graph_edges', recordId: activeIds.get(id)!, data: { isActive: false },
    }))
    const nodeNames = new Map(nodes.map(node => [node.id, node.name]))
    const targetEdges = edges.filter(edge => edgeIds.includes(edge.id)).map(edge => ({
      id: edge.id,
      label: `${nodeNames.get(edge.sourceId)} → ${nodeNames.get(edge.targetId)}`,
    }))
    await commit([
      ...writes,
      audit('EDGE_REVOKED', edgeIds, { ...summary, targetEdges }, recordId),
      {
        collection: 'revocation_proposals', recordId,
        data: { status: 'approved', reviewedBy: actorId, reviewedAt: timestamp, reviewNote: request.reason, blastSummaryJson },
      },
    ])
  }
  return Response.json({ success: true, data: { proposalId: recordId, summary } })
}

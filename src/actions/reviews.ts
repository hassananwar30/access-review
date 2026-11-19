import type { ActionResult, GetActionData, QueryActionData } from 'deepspace/worker'
import { z } from 'zod'
import { simulateEdgeRemoval, type GraphEdge, type GraphNode } from '../lib/accessGraph'
import { seedEdges, seedNodes } from '../lib/seedOrg'

type Execute = <T>(userId: string, tool: string, params: Record<string, unknown>) => Promise<ActionResult<T>>
type Write = { collection: string; recordId: string; data: Record<string, unknown> }
type ReviewPlan = { actorId: string; writes: Write[] }
const journalKey = 'access-review:pending-operation'
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

export const reviewActions = ['createRevocationProposal', 'applyRevocation', 'rejectProposal', 'resetDemoOrg'] as const
export type ReviewAction = typeof reviewActions[number]

interface NodeData extends Record<string, unknown> {
  nodeKey: string
  name: string
  nodeType: GraphNode['type']
  department: string
  description: string
  sensitivity?: GraphNode['sensitivity']
}
interface EdgeData extends Record<string, unknown> {
  edgeKey: string
  sourceKey: string
  targetKey: string
  relation: GraphEdge['relation']
  justification?: string
}

function unwrap<T>(result: ActionResult<T>): T {
  if (!result.success) throw new Error(result.error)
  return result.data
}

const failure = (status: number, error: string) => Response.json({ success: false, error }, { status })

export async function runReviewAction(
  name: ReviewAction, actorId: string, params: unknown, ownerId: string,
  execute: Execute, storage: DurableObjectStorage,
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
    for (const write of plan.writes) unwrap(await execute(plan.actorId, 'records.create', write))
    await storage.delete(journalKey)
  }
  const interrupted = await storage.get<ReviewPlan>(journalKey)
  if (interrupted) await finish(interrupted)

  async function commit(writes: Write[]) {
    const plan = { actorId, writes }
    await storage.put(journalKey, plan)
    await finish(plan)
  }
  async function query<T extends Record<string, unknown>>(collection: string, orderBy: string, where?: Record<string, unknown>) {
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

  if (name === 'resetDemoOrg') {
    const writes: Write[] = seedNodes.map(({ id, type, ...data }) => ({
      collection: 'graph_nodes', recordId: id, data: { ...data, nodeKey: id, nodeType: type },
    }))
    writes.push(...seedEdges.map(({ id, sourceId, targetId, relation, justification }) => ({
      collection: 'graph_edges', recordId: id,
      data: { edgeKey: id, sourceKey: sourceId, targetKey: targetId, relation, justification, isActive: true },
    })))
    writes.push(audit('ORG_RESET', [], { nodes: seedNodes.length, edges: seedEdges.length }))
    await commit(writes)
    return Response.json({ success: true, data: { nodes: seedNodes.length, edges: seedEdges.length } })
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
  const nodeRecords = await query<NodeData>('graph_nodes', 'nodeKey')
  const edgeRecords = await query<EdgeData>('graph_edges', 'edgeKey', { isActive: 1 })
  const nodeIds = new Set(nodeRecords.map(({ data }) => data.nodeKey))
  const activeRecords = edgeRecords.filter(({ data }) => nodeIds.has(data.sourceKey) && nodeIds.has(data.targetKey))
  const activeIds = new Map(activeRecords.map(({ recordId, data }) => [data.edgeKey, recordId]))
  if (!edgeIds.every(id => activeIds.has(id))) return failure(409, 'An edge is no longer active. Refresh the simulation.')

  const nodes: GraphNode[] = nodeRecords.map(({ data }) => ({
    id: data.nodeKey, type: data.nodeType, name: data.name, department: data.department,
    sensitivity: data.sensitivity, description: data.description,
  }))
  const edges: GraphEdge[] = activeRecords.map(({ data }) => ({
    id: data.edgeKey, sourceId: data.sourceKey, targetId: data.targetKey, relation: data.relation,
    justification: data.justification,
  }))
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
    await commit([
      ...writes,
      audit('EDGE_REVOKED', edgeIds, summary, recordId),
      {
        collection: 'revocation_proposals', recordId,
        data: { status: 'approved', reviewedBy: actorId, reviewedAt: timestamp, reviewNote: request.reason, blastSummaryJson },
      },
    ])
  }
  return Response.json({ success: true, data: { proposalId: recordId, summary } })
}

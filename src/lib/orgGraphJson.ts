import { z } from 'zod'

const id = z.string().min(1).max(256).refine(value => value.trim().length > 0, 'ID cannot be blank.')

export const orgGraphSchema = z.strictObject({
  nodes: z.array(z.strictObject({
    id,
    name: z.string().min(1).max(200).refine(value => value.trim().length > 0, 'Name cannot be blank.'),
    type: z.enum(['User', 'ServiceAccount', 'Group', 'Role', 'Resource']),
    department: z.string().max(200),
    sensitivity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    description: z.string().max(2048),
  })).max(80, 'Import at most 80 nodes.'),
  edges: z.array(z.strictObject({
    id,
    sourceId: id,
    targetId: id,
    relation: z.enum(['MEMBER_OF', 'ASSUMES', 'GRANTS_READ', 'GRANTS_WRITE', 'GRANTS_ADMIN']),
    label: z.string().max(200).optional(),
    justification: z.string().max(2048).optional(),
  })).max(200, 'Import at most 200 edges.'),
}).superRefine(({ nodes, edges }, context) => {
  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()
  nodes.forEach((node, index) => {
    if (nodeIds.has(node.id)) context.addIssue({ code: 'custom', path: ['nodes', index, 'id'], message: 'Duplicate node ID.' })
    nodeIds.add(node.id)
  })
  edges.forEach((edge, index) => {
    if (edgeIds.has(edge.id)) context.addIssue({ code: 'custom', path: ['edges', index, 'id'], message: 'Duplicate edge ID.' })
    edgeIds.add(edge.id)
    for (const endpoint of ['sourceId', 'targetId'] as const) {
      if (!nodeIds.has(edge[endpoint])) {
        context.addIssue({ code: 'custom', path: ['edges', index, endpoint], message: 'References a missing node ID.' })
      }
    }
  })
})

export type OrgGraph = z.infer<typeof orgGraphSchema>

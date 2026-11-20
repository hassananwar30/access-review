import type { GraphEdge, GraphNode } from './accessGraph'

export const maxOrgGraphBytes = 4 * 1024 * 1024

export const scenarios = [
  { name: 'Shadow Path', edgeId: 'contractors:ASSUMES:db-admin' },
  { name: 'CI Bot Outage', edgeId: 'ci-release:GRANTS_WRITE:k8s-prod-cluster' },
  { name: 'Downgrade', edgeId: 'alex:MEMBER_OF:platform-sre' },
] as const

export interface NodeRecord {
  nodeKey: string
  name: string
  nodeType: GraphNode['type']
  department: string
  description: string
  sensitivity?: GraphNode['sensitivity']
}

export interface EdgeRecord {
  edgeKey: string
  sourceKey: string
  targetKey: string
  relation: GraphEdge['relation']
  label?: string
  justification?: string
  isActive: boolean | number
}

export function graphFromRecords(nodes: readonly { data: NodeRecord }[], edges: readonly { data: EdgeRecord }[]) {
  const nodeIds = new Set(nodes.map(({ data }) => data.nodeKey))
  return {
    nodes: nodes.map(({ data }): GraphNode => ({
      id: data.nodeKey, name: data.name, type: data.nodeType, department: data.department,
      description: data.description, sensitivity: data.sensitivity,
    })),
    edges: edges.filter(({ data }) =>
      (data.isActive === true || data.isActive === 1) && nodeIds.has(data.sourceKey) && nodeIds.has(data.targetKey),
    ).map(({ data }): GraphEdge => ({
      id: data.edgeKey, sourceId: data.sourceKey, targetId: data.targetKey,
      relation: data.relation, label: data.label, justification: data.justification,
    })),
  }
}

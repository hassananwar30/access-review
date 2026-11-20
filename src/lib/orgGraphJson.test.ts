import { describe, expect, it } from 'vitest'
import { canEnumerateGraph } from './accessGraph'
import { orgGraphSchema, type OrgGraph } from './orgGraphJson'

const example: OrgGraph = {
  nodes: [
    { id: 'sam', name: 'Sam', type: 'User', department: '', description: '' },
    { id: 'tickets', name: 'Tickets', type: 'Resource', department: '', description: '', sensitivity: 'low' },
  ],
  edges: [{ id: 'read', sourceId: 'sam', targetId: 'tickets', relation: 'GRANTS_READ', label: 'Read', justification: 'Support' }],
}

describe('organization graph JSON', () => {
  it('preserves valid graph fields and permits an empty graph', () => {
    expect(orgGraphSchema.parse(example)).toEqual(example)
    expect(orgGraphSchema.parse({ nodes: [], edges: [] })).toEqual({ nodes: [], edges: [] })
  })

  it.each([
    { nodes: [...example.nodes, example.nodes[0]], edges: example.edges },
    { nodes: example.nodes, edges: [...example.edges, example.edges[0]] },
    { ...example, edges: [{ ...example.edges[0], targetId: 'missing' }] },
    { ...example, edges: [{ ...example.edges[0], relation: 'OWNS' }] },
    { ...example, nodes: [{ ...example.nodes[0], type: 'Team' }, example.nodes[1]] },
    { ...example, surprise: true },
  ])('rejects invalid graph JSON %#', graph => {
    expect(orgGraphSchema.safeParse(graph).success).toBe(false)
  })

  it('enforces node and edge caps independently', () => {
    const nodes = Array.from({ length: 81 }, (_, index) => ({ ...example.nodes[0], id: String(index) }))
    const edges = Array.from({ length: 201 }, (_, index) => ({ ...example.edges[0], id: String(index) }))
    expect(orgGraphSchema.safeParse({ nodes, edges: [] }).success).toBe(false)
    expect(orgGraphSchema.safeParse({ nodes: example.nodes, edges }).success).toBe(false)
  })

  it('detects a small graph with too many alternate paths to enumerate', () => {
    const nodes = [...example.nodes]
    const edges: OrgGraph['edges'] = []
    let previous = ['sam']
    for (let level = 0; level < 14; level++) {
      const next = [`a-${level}`, `b-${level}`]
      for (const targetId of next) {
        nodes.push({ id: targetId, type: 'Group', name: targetId, department: '', description: '' })
        for (const sourceId of previous) {
          edges.push({ id: `${sourceId}:${targetId}`, sourceId, targetId, relation: 'MEMBER_OF' })
        }
      }
      previous = next
    }
    expect(canEnumerateGraph(example.nodes, example.edges)).toBe(true)
    expect(canEnumerateGraph(nodes, edges)).toBe(false)
  })
})

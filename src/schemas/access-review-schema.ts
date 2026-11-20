import type { CollectionSchema, ColumnDefinition, RolePermissions } from 'deepspace/schema'

const readOnly: RolePermissions = { read: true, create: false, update: false, delete: false }
const privateReads = { admin: readOnly, member: readOnly, viewer: readOnly }
const text = (name: string, required = true): ColumnDefinition =>
  ({ name, required, storage: 'text', interpretation: 'plain' })
const select = (name: string, ...options: string[]): ColumnDefinition =>
  ({ ...text(name), interpretation: { kind: 'select', options } })
const owner = (name: string): ColumnDefinition =>
  ({ ...text(name, false), userBound: true, immutable: true })

export const accessReviewSchemas: CollectionSchema[] = [
  {
    name: 'graph_nodes',
    uniqueOn: ['nodeKey'],
    columns: [
      text('nodeKey'), text('name'), select('nodeType', 'User', 'ServiceAccount', 'Group', 'Role', 'Resource'),
      { ...text('department', false), default: '' }, { ...select('sensitivity', 'low', 'medium', 'high', 'critical'), required: false },
      { ...text('description', false), default: '' },
    ],
    permissions: privateReads,
  },
  {
    name: 'graph_edges',
    uniqueOn: ['edgeKey'],
    columns: [
      text('edgeKey'), text('sourceKey'), text('targetKey'),
      select('relation', 'MEMBER_OF', 'ASSUMES', 'GRANTS_READ', 'GRANTS_WRITE', 'GRANTS_ADMIN'),
      text('label', false), text('justification', false),
      { name: 'isActive', storage: 'number', interpretation: 'boolean', required: true, default: true },
    ],
    permissions: privateReads,
  },
  {
    name: 'revocation_proposals',
    ownerField: 'createdBy',
    columns: [
      text('title'), text('edgeIdsJson'), text('rationale'), owner('createdBy'),
      { ...select('status', 'pending', 'approved', 'rejected'), default: 'pending' },
      text('blastSummaryJson'), text('reviewedBy', false), text('reviewedAt', false), text('reviewNote', false),
    ],
    permissions: privateReads,
  },
  {
    name: 'proposal_comments',
    ownerField: 'authorId',
    columns: [
      { ...text('proposalId'), immutable: true }, text('body'), owner('authorId'),
      text('authorName', false), text('createdAt', false),
    ],
    permissions: {
      viewer: readOnly,
      member: { read: true, create: true, update: 'own', delete: 'own', writableFields: ['proposalId', 'body'] },
      admin: { read: true, create: true, update: true, delete: true, writableFields: ['proposalId', 'body'] },
    },
  },
  {
    name: 'audit_logs',
    columns: [
      select('action', 'EDGE_REVOKED', 'PROPOSAL_REJECTED', 'ORG_RESET', 'SNAPSHOT_IMPORTED', 'ORG_IMPORTED'),
      text('actorId'), text('actorRole'), text('proposalId', false),
      text('targetEdgeIdsJson'), text('blastSummaryJson'), text('timestamp'),
    ],
    permissions: privateReads,
  },
]

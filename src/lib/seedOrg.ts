import type { EdgeType, GraphEdge, GraphNode, NodeType } from './accessGraph'

function node(
  id: string, name: string, type: NodeType, department: string, description: string,
  sensitivity?: GraphNode['sensitivity'],
): GraphNode {
  return { id, name, type, department, description, ...(sensitivity && { sensitivity }) }
}

/** Kestrel Cloud. IDs are stable across resets and independent of display names. */
export const seedNodes: readonly GraphNode[] = [
  node('dana', 'Dana Patel', 'User', 'Contract Engineering', 'Contractor supporting the payments migration.'),
  node('marcus', 'Marcus Chen', 'User', 'Reliability', 'Staff SRE responsible for production recovery.'),
  node('priya', 'Priya Nair', 'User', 'Data', 'Data analyst reconciling usage and invoices.'),
  node('alex', 'Alex Rivera', 'User', 'Engineering', 'Backend engineer rotating between reliability and data work.'),
  node('sofia', 'Sofia Gomez', 'User', 'Finance', 'Finance operations lead for the monthly close.'),
  node('liam', 'Liam Brooks', 'User', 'Security', 'Security lead maintaining emergency access.'),
  node('noah', 'Noah Kim', 'User', 'Support', 'Support engineer investigating payment discrepancies.'),
  node('chloe', 'Chloe Park', 'User', 'Support', 'Intern shadowing the customer support desk.'),
  node('ci-deploy-bot', 'ci-deploy-bot', 'ServiceAccount', 'Release Engineering', 'Publishes approved builds to the production cluster.'),
  node('nightly-etl-bot', 'nightly-etl-bot', 'ServiceAccount', 'Data', 'Loads reconciled data into the warehouse overnight.'),

  node('contractors', 'Contractors', 'Group', 'Contract Engineering', 'External migration team with a temporary database exception.'),
  node('platform-sre', 'Platform-SRE', 'Group', 'Reliability', 'Production platform maintainers.'),
  node('ops-oncall', 'Ops-OnCall', 'Group', 'Operations', 'Incident rotation with inherited legacy VPN membership.'),
  node('data-team', 'Data-Team', 'Group', 'Data', 'Warehouse and reporting staff.'),
  node('finance-users', 'Finance-Users', 'Group', 'Finance', 'Ledger operators responsible for payment reconciliation.'),
  node('legacy-vpn', 'Legacy-VPN-Admins', 'Group', 'Security', 'Historic recovery group still trusted by the payments database.'),

  node('db-admin', 'Prod-DB-Admin', 'Role', 'Reliability', 'Manages production payments and customer databases.'),
  node('db-reader', 'Prod-DB-ReadOnly', 'Role', 'Reliability', 'Inspects production records for reconciliation.'),
  node('billing-admin', 'Billing-Admin', 'Role', 'Finance', 'Maintains ledger entries and monthly reconciliation reports.'),
  node('ci-release', 'CI-Release-Role', 'Role', 'Release Engineering', 'Deploys production workloads and reads build telemetry.'),
  node('analytics-reader', 'Analytics-Reader', 'Role', 'Data', 'Reads the warehouse and customer data used for analysis.'),
  node('support-viewer', 'Support-Viewer', 'Role', 'Support', 'Views incoming support tickets.'),

  node('prod-payments-db', 'prod-payments-db', 'Resource', 'Payments', 'Payment transactions and settlement state.', 'critical'),
  node('prod-customer-pii', 'prod-customer-pii', 'Resource', 'Customer Engineering', 'Customer identity and contact records.', 'critical'),
  node('billing-ledger', 'billing-ledger', 'Resource', 'Finance', 'Internal billing ledger and adjustments.', 'high'),
  node('k8s-prod-cluster', 'k8s-prod-cluster', 'Resource', 'Reliability', 'Production Kubernetes workloads.', 'critical'),
  node('analytics-warehouse', 'analytics-warehouse', 'Resource', 'Data', 'Reporting warehouse and deployment telemetry.', 'medium'),
  node('support-tickets', 'support-tickets', 'Resource', 'Support', 'Customer case queue.', 'low'),
]

function edge(sourceId: string, relation: EdgeType, targetId: string, justification: string): GraphEdge {
  return { id: [sourceId, relation, targetId].join(':'), sourceId, targetId, relation, justification }
}

export const seedEdges: readonly GraphEdge[] = [
  edge('dana', 'MEMBER_OF', 'contractors', 'Payments migration assignment.'),
  edge('dana', 'MEMBER_OF', 'ops-oncall', 'Weekend cutover rotation.'),
  edge('marcus', 'MEMBER_OF', 'platform-sre', 'Staff reliability assignment.'),
  edge('marcus', 'MEMBER_OF', 'ops-oncall', 'Primary incident commander.'),
  edge('marcus', 'ASSUMES', 'ci-release', 'Production release lead.'),
  edge('priya', 'MEMBER_OF', 'data-team', 'Analytics reporting assignment.'),
  edge('priya', 'GRANTS_READ', 'billing-ledger', 'Validate monthly invoice totals.'),
  edge('alex', 'MEMBER_OF', 'platform-sre', 'Reliability rotation.'),
  edge('alex', 'MEMBER_OF', 'data-team', 'Query customer reporting inputs.'),
  edge('sofia', 'MEMBER_OF', 'finance-users', 'Own the billing close.'),
  edge('sofia', 'ASSUMES', 'support-viewer', 'Review disputed invoices against customer cases.'),
  edge('liam', 'MEMBER_OF', 'legacy-vpn', 'Own the emergency recovery policy.'),
  edge('liam', 'MEMBER_OF', 'ops-oncall', 'Security escalation duty.'),
  edge('liam', 'ASSUMES', 'db-reader', 'Audit production data changes.'),
  edge('noah', 'ASSUMES', 'support-viewer', 'Triage incoming cases.'),
  edge('noah', 'ASSUMES', 'db-reader', 'Investigate transaction discrepancies.'),
  edge('chloe', 'ASSUMES', 'support-viewer', 'Time-limited internship entitlement.'),
  edge('ci-deploy-bot', 'ASSUMES', 'ci-release', 'Identity used by the production release pipeline.'),
  edge('nightly-etl-bot', 'MEMBER_OF', 'data-team', 'Scheduled extract job.'),
  edge('nightly-etl-bot', 'ASSUMES', 'db-reader', 'Load settled transactions each night.'),
  edge('nightly-etl-bot', 'GRANTS_WRITE', 'analytics-warehouse', 'Write the reconciled nightly partition.'),

  edge('contractors', 'ASSUMES', 'db-admin', 'Temporary exception for the schema migration.'),
  edge('contractors', 'ASSUMES', 'support-viewer', 'Triage cutover reports.'),
  edge('platform-sre', 'ASSUMES', 'db-admin', 'Recover production databases.'),
  edge('platform-sre', 'ASSUMES', 'ci-release', 'Coordinate production deployments.'),
  edge('platform-sre', 'ASSUMES', 'support-viewer', 'Read incidents escalated by support.'),
  edge('ops-oncall', 'MEMBER_OF', 'legacy-vpn', 'Inherited access for after-hours recovery.'),
  edge('ops-oncall', 'ASSUMES', 'ci-release', 'Roll back failed releases on call.'),
  edge('ops-oncall', 'ASSUMES', 'support-viewer', 'Inspect the incident queue.'),
  edge('legacy-vpn', 'ASSUMES', 'db-admin', 'Pre-migration database recovery entitlement.'),
  edge('data-team', 'ASSUMES', 'analytics-reader', 'Read inputs used for quarterly reporting.'),
  edge('finance-users', 'ASSUMES', 'billing-admin', 'Post and review billing adjustments.'),
  edge('finance-users', 'ASSUMES', 'db-reader', 'Reconcile settlements against the ledger.'),
  edge('finance-users', 'GRANTS_READ', 'analytics-warehouse', 'Verify invoice rollups.'),

  edge('db-admin', 'GRANTS_ADMIN', 'prod-payments-db', 'Manage the settlement database.'),
  edge('db-admin', 'GRANTS_ADMIN', 'prod-customer-pii', 'Manage customer database recovery.'),
  edge('db-reader', 'GRANTS_READ', 'prod-payments-db', 'Read settled transactions.'),
  edge('db-reader', 'GRANTS_READ', 'prod-customer-pii', 'Look up affected customer records.'),
  edge('billing-admin', 'GRANTS_ADMIN', 'billing-ledger', 'Administer invoice adjustments.'),
  edge('billing-admin', 'GRANTS_WRITE', 'analytics-warehouse', 'Publish close reports.'),
  edge('ci-release', 'GRANTS_WRITE', 'k8s-prod-cluster', 'Apply approved workload manifests.'),
  edge('ci-release', 'GRANTS_READ', 'analytics-warehouse', 'Verify release telemetry.'),
  edge('analytics-reader', 'GRANTS_READ', 'analytics-warehouse', 'Read reporting tables.'),
  edge('analytics-reader', 'GRANTS_READ', 'prod-customer-pii', 'Read customer reporting inputs.'),
  edge('support-viewer', 'GRANTS_READ', 'support-tickets', 'Read customer case history.'),
]

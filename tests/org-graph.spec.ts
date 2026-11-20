import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { expect, loadAllTestAccounts, test } from 'deepspace/testing'
import { seedNodes, seedEdges } from '../src/lib/seedOrg'

test.skip(loadAllTestAccounts().length < 2, 'Requires two usable DeepSpace test accounts.')

async function authenticate(page: Page) {
  const response = await page.request.post('/api/auth/token')
  expect(response.ok()).toBeTruthy()
  const { token } = await response.json()
  return { Authorization: `Bearer ${token}` }
}

test('admin imports and resets a live graph while members can only export', async ({ users }) => {
  test.setTimeout(90_000)
  const [admin, member] = await users(2)
  await Promise.all([admin.page.goto('/home'), member.page.goto('/home')])
  await expect(admin.page.getByText('Admin / IAM Approver')).toBeVisible()
  await expect(member.page.getByText('Member / Security Engineer')).toBeVisible()
  const [adminHeaders, memberHeaders] = await Promise.all([authenticate(admin.page), authenticate(member.page)])
  const call = (action: string, data: object, headers = adminHeaders) =>
    admin.page.request.post(`/api/actions/${action}`, { data, headers })

  try {
    expect((await call('resetDemoOrg', {})).ok()).toBeTruthy()
    const preset = admin.page.getByRole('button', { name: 'Shadow Path', exact: true })
    await expect(preset).toBeEnabled()
    const retained = seedEdges.find(edge => edge.sourceId === 'dana' && edge.targetId === 'contractors')!
    const retainedNodes = seedNodes.filter(node => node.id === retained.sourceId || node.id === retained.targetId)
    const graph = {
      nodes: [...retainedNodes, { id: 'work-queue', name: 'Incident Queue', type: 'Resource', department: '', description: '' }],
      edges: [retained, {
        id: 'work-queue-read', sourceId: 'contractors', targetId: 'work-queue', relation: 'GRANTS_READ',
        label: 'Read queue', justification: 'Triage incidents',
      }],
    }
    const obsolete = await call('createRevocationProposal', {
      title: 'xyz', rationale: 'Stale test proposal', edgeIds: ['ci-release:GRANTS_WRITE:k8s-prod-cluster'],
    }, memberHeaders)
    expect(obsolete.ok()).toBeTruthy()
    const keep = await call('createRevocationProposal', {
      title: 'Keep pending', rationale: 'Still references an existing edge', edgeIds: [retained.id],
    }, memberHeaders)
    expect(keep.ok()).toBeTruthy()
    await expect(member.page.getByRole('button', { name: 'Import JSON' })).toHaveCount(0)
    expect((await call('importOrgGraph', graph, memberHeaders)).status()).toBe(403)
    for (const invalid of [
      { ...graph, edges: [{ ...graph.edges[1], targetId: 'absent' }] },
      { ...graph, nodes: [{ ...graph.nodes[0], type: 'Team' }] },
    ]) {
      expect((await call('importOrgGraph', invalid)).status()).toBe(400)
    }
    await expect(preset).toBeEnabled()

    await admin.page.getByRole('button', { name: 'Import JSON' }).click()
    const modal = admin.page.getByRole('dialog', { name: 'Import IAM graph' })
    const input = modal.getByRole('textbox', { name: 'Graph JSON' })
    await modal.getByRole('button', { name: 'Load minimal example JSON' }).click()
    await expect(input).toHaveValue(/sam-read-tickets/)
    await input.fill('{')
    await modal.getByRole('button', { name: 'Replace workspace graph' }).click()
    await expect(modal.getByRole('alert')).toContainText('Enter valid JSON')
    await modal.getByLabel('Choose a JSON file').setInputFiles({
      name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(graph)),
    })
    await expect(input).toHaveValue(/work-queue/)
    await modal.getByRole('button', { name: 'Replace workspace graph' }).click()
    await expect(admin.page.getByRole('status').filter({ hasText: 'Imported 3 nodes and 2 edges.' })).toBeVisible()
    await expect(preset).toBeDisabled()
    await expect(member.page.getByRole('button', { name: 'Shadow Path', exact: true })).toBeDisabled()
    const customEdge = member.page.getByRole('button', { name: 'Contractors → Incident Queue' })
    await expect(customEdge).toHaveCount(1)
    await member.page.getByLabel('Add a relationship').selectOption('work-queue-read')
    await expect(member.page.getByRole('heading', { name: 'Loses Access' })).toBeVisible()
    await expect(member.page.getByText('READ → NONE', { exact: true })).toBeVisible()
    await expect(member.page.getByTestId('revocation-proposal').filter({ hasText: 'xyz' })).toHaveCount(0)
    await expect(member.page.getByTestId('revocation-proposal').filter({ hasText: 'Keep pending' })).toBeVisible()

    const downloaded = member.page.waitForEvent('download')
    await member.page.getByRole('button', { name: 'Export JSON' }).click()
    const file = await downloaded
    expect(file.suggestedFilename()).toMatch(/\.json$/)
    const exported = JSON.parse(await readFile(await file.path(), 'utf8'))
    expect(exported.nodes).toHaveLength(3)
    expect(exported.edges).toEqual(expect.arrayContaining(graph.edges))
    await admin.page.getByRole('button', { name: 'Audit Log' }).click()
    const audit = admin.page.getByTestId('audit-entry').filter({ hasText: 'ORG_IMPORTED' })
    await expect(audit).toContainText('3 nodes')
    await expect(audit).toContainText('2 edges')

    expect((await call('resetDemoOrg', {})).ok()).toBeTruthy()
    await expect(preset).toBeEnabled()
    await expect(member.page.getByRole('button', { name: 'Contractors → Incident Queue' })).toHaveCount(0)
    await expect(member.page.getByTestId('revocation-proposal')).toHaveCount(0)
    await expect(audit).toBeVisible()
  } finally {
    expect((await call('resetDemoOrg', {})).ok()).toBeTruthy()
  }
})

test('Worker imports and exports a full-size graph across journal and query pages', async ({ users }) => {
  test.setTimeout(90_000)
  const [admin] = await users(1)
  await admin.page.goto('/home')
  await expect(admin.page.getByText('Admin / IAM Approver')).toBeVisible()
  const headers = await authenticate(admin.page)
  const details = 'Imported fixture '.repeat(98)
  const graph = {
    nodes: Array.from({ length: 80 }, (_, index) => ({
      id: `node-${index}`, name: `Node ${index}`, type: index === 0 ? 'User' : 'Resource',
      department: 'Fixture', description: details,
    })),
    edges: Array.from({ length: 200 }, (_, index) => ({
      id: `edge-${index}`, sourceId: 'node-0', targetId: `node-${index % 79 + 1}`,
      relation: 'GRANTS_READ', justification: details,
    })),
  }
  try {
    const imported = await admin.page.request.post('/api/actions/importOrgGraph', { headers, data: graph })
    expect(imported.status()).toBe(200)
    expect(await imported.json()).toMatchObject({ data: { nodes: 80, edges: 200 } })
    await expect(admin.page.getByText('80 identities and resources · 200 active relationships')).toBeVisible({ timeout: 20_000 })
    const download = admin.page.waitForEvent('download')
    await admin.page.getByRole('button', { name: 'Export JSON' }).click()
    const exported = JSON.parse(await readFile(await (await download).path(), 'utf8'))
    expect(exported.nodes).toHaveLength(80)
    expect(exported.edges).toHaveLength(200)
  } finally {
    expect((await admin.page.request.post('/api/actions/resetDemoOrg', { headers, data: {} })).ok()).toBeTruthy()
  }
})

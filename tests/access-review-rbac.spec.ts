import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, loadAllTestAccounts, test } from 'deepspace/testing'
import { clientBuild, encode } from 'deepspace/worker'

test.skip(loadAllTestAccounts().length < 2, 'Requires two usable DeepSpace test accounts.')

async function sessionToken(page: Page): Promise<string> {
  const response = await page.request.post('/api/auth/token')
  expect(response.ok()).toBeTruthy()
  const { token } = await response.json()
  expect(typeof token).toBe('string')
  return token
}

async function confirmClientWriteDenied(page: Page, recordSocketUrl: string, message: string, requestId: string) {
  const result = await page.evaluate(({ url, message, requestId }) => new Promise<{ success: boolean; error?: string }>((resolve, reject) => {
    const socket = new WebSocket(url)
    const timeout = window.setTimeout(() => {
      socket.close()
      reject(new Error('No acknowledgement for the test write.'))
    }, 8000)
    socket.addEventListener('open', () => socket.send(message))
    socket.addEventListener('error', () => {
      window.clearTimeout(timeout)
      reject(new Error('The test records socket failed.'))
    })
    socket.addEventListener('message', event => {
      const reply = JSON.parse(event.data)
      if (reply.payload?.requestId !== requestId) return
      window.clearTimeout(timeout)
      socket.close()
      resolve(reply.payload)
    })
  }), { url: recordSocketUrl, message, requestId })
  expect(result.success).toBe(false)
  expect(result.error).toMatch(/permission|denied|not allowed|forbidden/i)
}

test('a member proposes and an admin applies a revocation across both live browsers', async ({ users }) => {
  test.setTimeout(90_000)
  const [admin, member] = await users(2)
  const recordSocket = (page: Page) => page.waitForEvent('websocket', {
    predicate: socket => /^\/ws\/[^/]+$/.test(new URL(socket.url()).pathname),
  })
  const sockets = Promise.all([recordSocket(admin.page), recordSocket(member.page)])
  await Promise.all([admin.page.goto('/home'), member.page.goto('/home')])
  const [adminSocket, memberSocket] = await sockets
  const [adminJwt, memberJwt] = await Promise.all([sessionToken(admin.page), sessionToken(member.page)])
  const call = (page: Page, token: string, action: string, data: object) =>
    page.request.post(`/api/actions/${action}`, { headers: { Authorization: `Bearer ${token}` }, data })
  await expect(admin.page.getByText('Admin / IAM Approver')).toBeVisible()
  await expect(member.page.getByText('Member / Security Engineer')).toBeVisible()

  try {
    expect((await call(admin.page, adminJwt, 'resetDemoOrg', {})).ok()).toBeTruthy()
    const adminScenario = admin.page.getByRole('button', { name: 'Shadow Path', exact: true })
    const memberScenario = member.page.getByRole('button', { name: 'Shadow Path', exact: true })
    await expect(adminScenario).toBeEnabled()
    await expect(memberScenario).toBeEnabled()
    await expect(admin.page.getByText('2 online', { exact: true })).toBeVisible()
    await expect(member.page.getByText('2 online', { exact: true })).toBeVisible()
    await memberScenario.click()
    const retainedPath = member.page.getByText(/Dana Patel → Ops-OnCall → Legacy-VPN-Admins/).first()
    await expect(retainedPath).toBeVisible()
    await expect(admin.page.getByText(/is simulating Contractors → Prod-DB-Admin/)).toBeVisible()

    const title = 'Revoke contractor migration privilege'
    await member.page.getByRole('button', { name: 'Propose Revocation' }).click()
    await member.page.getByLabel('Proposal title').fill(title)
    await member.page.getByLabel('Rationale').fill('The payments migration is complete.')
    const submitted = member.page.waitForResponse(response => response.url().endsWith('/api/actions/createRevocationProposal'))
    await member.page.getByRole('button', { name: 'Submit proposal' }).click()
    const proposalResponse = await submitted
    expect(proposalResponse.ok()).toBeTruthy()
    const { data: { proposalId } } = await proposalResponse.json()
    const adminProposal = admin.page.getByTestId('revocation-proposal').filter({ hasText: title })
    const memberProposal = member.page.getByTestId('revocation-proposal').filter({ hasText: title })
    await expect(adminProposal).toContainText('pending')
    await expect(memberProposal.getByRole('button', { name: 'Approve & Apply' })).toHaveCount(0)

    const denied = await call(member.page, memberJwt, 'applyRevocation', { proposalId })
    expect(denied.status()).toBe(403)
    await expect(adminScenario).toBeEnabled()
    await expect(memberScenario).toBeEnabled()
    const requestId = randomUUID()
    const auditAttempt = {
      action: 'EDGE_REVOKED', actorId: admin.userId, actorRole: 'admin', proposalId,
      targetEdgeIdsJson: '[]', blastSummaryJson: '{}', timestamp: new Date().toISOString(),
    }
    await confirmClientWriteDenied(member.page, memberSocket.url(), encode(clientBuild.put('audit_logs', randomUUID(), auditAttempt, requestId)), requestId)

    await adminProposal.getByRole('button', { name: 'Approve & Apply' }).click()
    await expect(adminProposal).toContainText('approved')
    await expect(memberProposal).toContainText('approved')
    await expect(adminScenario).toBeDisabled()
    await expect(memberScenario).toBeDisabled()
    for (const page of [admin.page, member.page]) {
      await page.getByRole('button', { name: 'Audit Log' }).click()
      const revocation = page.getByTestId('audit-entry').filter({ hasText: 'EDGE_REVOKED' })
      await expect(revocation).toHaveCount(1)
      await expect(revocation).toContainText(admin.userId!)
      await expect(revocation).toContainText('Contractors → Prod-DB-Admin')
    }
    const recordId = await admin.page.getByTestId('audit-entry').filter({ hasText: 'EDGE_REVOKED' }).getAttribute('data-record-id')
    expect(recordId).toBeTruthy()
    const editRequest = randomUUID()
    const deleteRequest = randomUUID()
    await confirmClientWriteDenied(admin.page, adminSocket.url(),
      encode(clientBuild.put('audit_logs', recordId!, { actorRole: 'viewer' }, editRequest)), editRequest)
    await confirmClientWriteDenied(admin.page, adminSocket.url(),
      encode(clientBuild.remove('audit_logs', recordId!, deleteRequest)), deleteRequest)
  } finally {
    expect((await call(admin.page, adminJwt, 'resetDemoOrg', {})).ok()).toBeTruthy()
  }
})

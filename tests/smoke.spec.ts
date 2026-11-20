import { test, expect } from '@playwright/test'
import { captureConsoleErrors } from './helpers/errors'

/**
 * Smoke tests covering both page kinds this template ships:
 *   - '/'      → the static landing (top level of src/pages/): no providers,
 *                so no auth fetch and no records WebSocket on load.
 *   - '/home'  → a dynamic page (under src/pages/(app)/): the providers mount,
 *                the nav shell renders, and the records WebSocket connects.
 *
 * The "static contract" test is the guardrail for the per-page opt-out: if
 * someone moves the providers back up into _app.tsx, it fails.
 */

/** Wait for the React app shell (present on every page). */
async function waitForApp(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 })
}

test.describe('Smoke tests', () => {
  test('static landing loads without JS errors', async ({ page }) => {
    const errors = captureConsoleErrors(page)
    await page.goto('/')
    await waitForApp(page)
    await expect(page.getByTestId('static-landing')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('landing carries one title, one description, one canonical', async ({ page }) => {
    // <Seo> (src/pages/index.tsx, values from src/seo.ts) hoists these into
    // <head>. Exactly one of each: index.html ships no static description or
    // canonical, because React 19 would not dedupe against them on mount.
    await page.goto('/')
    await expect(page.getByTestId('static-landing')).toBeVisible()
    await expect(page).toHaveTitle(/\S/)
    expect(await page.locator('head meta[name="description"]').count()).toBe(1)
    expect(await page.locator('head link[rel="canonical"]').count()).toBe(1)
  })

  for (const path of ['/', '/guide']) {
    test(`static contract: ${path} opens no auth or data connection`, async ({ page }) => {
      const offenders: string[] = []
      page.on('request', (req) => {
        if (new URL(req.url()).pathname.startsWith('/api/auth/')) offenders.push('/api/auth/')
      })
      // Only the DO room route counts. Vite's HMR socket is a dev artifact.
      page.on('websocket', (ws) => {
        const { pathname } = new URL(ws.url())
        if (pathname.startsWith('/ws/')) offenders.push(`ws: ${pathname}`)
      })
      await page.goto(path)
      await expect(page.getByRole('heading', {
        name: path === '/' ? 'Preview a permission change' : 'How Access Review works',
      })).toBeVisible()
      await page.waitForTimeout(1500)
      expect(offenders).toEqual([])
    })
  }

  test('guide links the public simulator and workspace', async ({ page }) => {
    const errors = captureConsoleErrors(page)
    await page.goto('/')
    await page.getByRole('link', { name: 'How it works' }).click()
    await expect(page).toHaveURL(/\/guide$/)
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      'Entity & Permission Flow', 'Selected for Removal & Blast Radius', 'The 3 Preset Scenarios', 'Governance Workflow',
    ])
    const demoLinks = page.getByRole('link', { name: 'Launch Interactive Demo' })
    await expect(demoLinks).toHaveCount(2)
    for (const link of await demoLinks.all()) await expect(link).toHaveAttribute('href', '/')
    expect(errors).toEqual([])
    await page.getByRole('link', { name: 'Open Full Workspace' }).first().click()
    await expect(page).toHaveURL(/\/home$/)
    await page.getByTestId('app-navigation').getByRole('link', { name: 'How it works' }).click()
    await expect(page.getByRole('heading', { name: 'How Access Review works' })).toBeVisible()
  })

  test('dynamic app boundary mounts on /home', async ({ page }) => {
    await page.goto('/home')
    await expect(page.getByTestId('app-navigation')).toBeVisible({ timeout: 15000 })
  })

  test('guest can simulate all three scenarios and carries the selection into sign-in', async ({ page }) => {
    await page.goto('/')
    const inspector = page.getByRole('complementary', { name: 'Blast radius' })
    await page.getByRole('button', { name: 'Shadow Path', exact: true }).click()
    await expect(inspector.getByText(/Dana Patel → Ops-OnCall → Legacy-VPN-Admins/).first()).toBeVisible()
    const destination = new URL(
      (await page.getByRole('link', { name: 'Sign in to Propose & Collaborate' }).getAttribute('href'))!,
      page.url(),
    )
    expect(destination.searchParams.getAll('edge')).toEqual(['contractors:ASSUMES:db-admin'])
    await page.getByRole('button', { name: 'CI Bot Outage', exact: true }).click()
    await expect(inspector.getByRole('alert')).toContainText('1 service accounts lose access')
    await page.getByRole('button', { name: 'Downgrade', exact: true }).click()
    await expect(inspector.getByText('ADMIN → READ').first()).toBeVisible()
    await page.getByRole('link', { name: 'Sign in to Propose & Collaborate' }).click()
    await expect(page).toHaveURL(/\/home\?edge=alex%3AMEMBER_OF%3Aplatform-sre/)
    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible()
  })

  test('sign-in button visible when logged out', async ({ page }) => {
    await page.goto('/home')
    await expect(page.getByTestId('nav-sign-in-button')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('nav-user-name')).toHaveCount(0)
  })

  test('unknown route shows 404', async ({ page }) => {
    await page.goto('/nonexistent-page-xyz')
    await waitForApp(page)
    await expect(page.locator('text=404')).toBeVisible()
  })
})

import { expect, test, type Page } from '@playwright/test'

// Mirrors server/tests/e2eSeed.ts — keep in sync if that fixture changes.
const FIXTURE = {
  convenorEmail: 'e2e-convenor@example.com',
  managerEmail: 'e2e-manager@example.com',
  authorEmail: 'e2e-author@example.com',
  reviewerEmail: 'e2e-reviewer@example.com',
  chairEmail: 'e2e-chair@example.com',
  staffEmail: 'e2e-staff@example.com',
  adminEmail: 'e2e-admin@example.com',
  password: 'Str0ng!Pass1',
}

// A 401/403 from an "am I signed in / do I have this permission" probe is
// expected, handled noise — not a bug. Same pattern as the other e2e specs.
const EXPECTED_AUTH_PROBE_NOISE = /Failed to load resource.*\b40[13]\b/

// Internal identifiers that must never leak into visible UI text — see
// docs/usability-audit.md. 'null' is checked too, but only as a whole word
// so it doesn't false-positive on prose that happens to contain it.
const BAD_TEXT_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'undefined', re: /\bundefined\b/ },
  { name: 'NaN', re: /\bNaN\b/ },
  { name: 'Invalid Date', re: /\bInvalid Date\b/ },
  { name: 'null', re: /\bnull\b/ },
]
// snake_case: two+ lowercase segments joined by underscore, as a standalone
// word — catches a leaked enum/template-key/audit-action, not a stray
// variable name inside a code sample (none of these pages show code).
const SNAKE_CASE_RE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+){1,}\b/g

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !EXPECTED_AUTH_PROBE_NOISE.test(msg.text())) errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

// SuperAdminLoginPage/ProtectedRoute probe "am I already signed in?" via
// GET /api/auth/me before the user has signed in — a legitimate 401, not a
// bug. Same reasoning as EXPECTED_AUTH_PROBE_NOISE above, applied to actual
// network responses rather than the console-logged echo of one.
function isExpectedAuthProbe(url: string, status: number): boolean {
  return url.includes('/api/auth/me') && (status === 401 || status === 403)
}

function trackFailedRequests(page: Page): string[] {
  const failed: string[] = []
  page.on('response', (res) => {
    if (res.status() >= 400 && res.url().includes('/api/') && !isExpectedAuthProbe(res.url(), res.status())) {
      failed.push(`${res.status()} ${res.url()}`)
    }
  })
  return failed
}

async function assertCleanPage(page: Page, label: string) {
  const bodyText = await page.locator('body').innerText()
  for (const { name, re } of BAD_TEXT_PATTERNS) {
    expect(re.test(bodyText), `"${name}" visible on ${label}`).toBe(false)
  }
  const snakeMatches = [...new Set(bodyText.match(SNAKE_CASE_RE) ?? [])]
  expect(snakeMatches, `snake_case text visible on ${label}: ${snakeMatches.join(', ')}`).toEqual([])
}

async function assertNoHorizontalScroll(page: Page, label: string) {
  const hasScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  expect(hasScroll, `horizontal scroll at 390px on ${label}`).toBe(false)
}

async function signIn(page: Page, email: string, role: string) {
  await page.goto('/login')
  await page.locator('#si-email').fill(email)
  await page.locator('#si-password').fill(FIXTURE.password)
  await page.locator('#si-role').selectOption(role)
  await Promise.all([
    page.waitForResponse((res) => res.url().includes('/api/auth/login')),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ])
}

/** Every link inside the one <nav> on the page — convenor/manager and the shared portal sidebar both wrap their items this way. */
async function sidebarLabels(page: Page): Promise<string[]> {
  const links = page.locator('nav').getByRole('link')
  const count = await links.count()
  const labels: string[] = []
  for (let i = 0; i < count; i++) labels.push((await links.nth(i).innerText()).trim())
  return labels
}

/** Visits every page this role's sidebar links to, plus every sub-tab (role="tab") each page shows, running all four checks on each. */
async function auditSidebar(page: Page, errors: string[], failedRequests: string[], roleLabel: string) {
  for (const label of await sidebarLabels(page)) {
    await page.locator('nav').getByRole('link', { name: label, exact: true }).click()
    await page.waitForLoadState('networkidle').catch(() => {})
    await assertCleanPage(page, `${roleLabel} / ${label}`)

    const tabs = page.getByRole('tab')
    const tabCount = await tabs.count()
    const tabLabels: string[] = []
    for (let i = 0; i < tabCount; i++) tabLabels.push((await tabs.nth(i).innerText()).trim())
    for (const tabLabel of tabLabels) {
      await page.getByRole('tab', { name: tabLabel, exact: true }).click()
      await page.waitForLoadState('networkidle').catch(() => {})
      await assertCleanPage(page, `${roleLabel} / ${label} > ${tabLabel}`)
    }
  }

  expect(errors, `console errors for ${roleLabel}:\n${errors.join('\n')}`).toEqual([])
  expect(failedRequests, `failed API requests for ${roleLabel}:\n${failedRequests.join('\n')}`).toEqual([])
}

const PORTAL_ROLES: Array<{ label: string; email: string; role: string }> = [
  { label: 'author', email: FIXTURE.authorEmail, role: 'author' },
  { label: 'reviewer', email: FIXTURE.reviewerEmail, role: 'reviewer' },
  { label: 'session chair', email: FIXTURE.chairEmail, role: 'session_chair' },
  { label: 'staff', email: FIXTURE.staffEmail, role: 'staff' },
]

for (const r of PORTAL_ROLES) {
  test(`usability: ${r.label} — every sidebar page is clean (no console errors, no leaked technical text, every sidebar link works)`, async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page)
    const failedRequests = trackFailedRequests(page)
    await signIn(page, r.email, r.role)
    await expect(page).toHaveURL(/\/portal/)
    await auditSidebar(page, errors, failedRequests, r.label)
  })

  test(`usability: ${r.label} — no horizontal scroll at 390px on any sidebar page`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page, r.email, r.role)
    await expect(page).toHaveURL(/\/portal/)
    for (const label of await sidebarLabels(page)) {
      await page.getByRole('button', { name: 'Menu' }).click()
      await page.locator('nav').getByRole('link', { name: label, exact: true }).click()
      await page.waitForLoadState('networkidle').catch(() => {})
      await assertNoHorizontalScroll(page, `${r.label} / ${label}`)
    }
  })
}

test('usability: convenor — every sidebar page and tab is clean', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  const failedRequests = trackFailedRequests(page)
  await signIn(page, FIXTURE.convenorEmail, 'convenor')
  await expect(page).toHaveURL(/\/convenor/)
  await auditSidebar(page, errors, failedRequests, 'convenor')
})

test('usability: manager — every sidebar page and tab is clean', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  const failedRequests = trackFailedRequests(page)
  await signIn(page, FIXTURE.managerEmail, 'manager')
  await expect(page).toHaveURL(/\/manager/)
  await auditSidebar(page, errors, failedRequests, 'manager')
})

test('usability: super admin — every tab is clean', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  const failedRequests = trackFailedRequests(page)
  await page.goto('/super-admin/login')
  await page.locator('#sa-email').fill(FIXTURE.adminEmail)
  await page.locator('#sa-password').fill(FIXTURE.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/super-admin$/)

  await assertCleanPage(page, 'super admin / Dashboard')
  const tabs = page.getByRole('tab')
  const tabCount = await tabs.count()
  const tabLabels: string[] = []
  for (let i = 0; i < tabCount; i++) tabLabels.push((await tabs.nth(i).innerText()).trim())
  for (const tabLabel of tabLabels) {
    await page.getByRole('tab', { name: tabLabel, exact: true }).click()
    await page.waitForLoadState('networkidle').catch(() => {})
    await assertCleanPage(page, `super admin / ${tabLabel}`)
  }

  expect(errors, `console errors for super admin:\n${errors.join('\n')}`).toEqual([])
  expect(failedRequests, `failed API requests for super admin:\n${failedRequests.join('\n')}`).toEqual([])
})

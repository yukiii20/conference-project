import { expect, test, type Page } from '@playwright/test'

// Mirrors server/tests/e2eSeed.ts — keep in sync if that fixture changes.
const FIXTURE = {
  conferenceSlug: 'e2e-conf',
  convenorEmail: 'e2e-convenor@example.com',
  authorEmail: 'e2e-author@example.com',
  reviewerEmail: 'e2e-reviewer@example.com',
  chairEmail: 'e2e-chair@example.com',
  staffEmail: 'e2e-staff@example.com',
  managerEmail: 'e2e-manager@example.com',
  password: 'Str0ng!Pass1',
}

// Same reasoning as e2e/convenorPortal.spec.ts: a 401/403 from an "am I
// signed in / do I have this permission" probe is expected, handled noise.
const EXPECTED_AUTH_PROBE_NOISE = /Failed to load resource.*\b40[13]\b/

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !EXPECTED_AUTH_PROBE_NOISE.test(msg.text())) errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

// Full names only allow letters/spaces/'.'/apostrophes/hyphens (see
// src/lib/validation.ts nameSchema) — no digits — so a timestamp can't be
// used directly to make a name unique across runs. This substitutes for one.
function randomLetters(length: number): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  return Array.from({ length }, () => letters[Math.floor(Math.random() * letters.length)]).join('')
}

async function expectNotBlank(page: Page) {
  // A retrying web-first assertion, not a one-shot innerText() read — the
  // latter can catch <main> mid-render (e.g. right after a route change)
  // and flake on an empty string that fills in a moment later.
  await expect(page.locator('main')).not.toBeEmpty()
}

async function signIn(page: Page, email: string, role: string) {
  await page.goto('/login')
  await page.locator('#si-email').fill(email)
  await page.locator('#si-password').fill(FIXTURE.password)
  await page.locator('#si-role').selectOption(role)
  // Wait for the login response itself, not just the click — an immediate
  // navigation right after can otherwise race the in-flight request.
  await Promise.all([
    page.waitForResponse((res) => res.url().includes('/api/auth/login')),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ])
}

/** Every link inside the one <nav> on the page — the convenor/manager sidebar and the shared portal sidebar both wrap their items this way. */
async function sidebarLabels(page: Page, mobile: boolean): Promise<string[]> {
  if (mobile) await page.getByRole('button', { name: 'Menu' }).click()
  const links = page.locator('nav').getByRole('link')
  const count = await links.count()
  const labels: string[] = []
  for (let i = 0; i < count; i++) labels.push((await links.nth(i).innerText()).trim())
  if (mobile) await page.getByRole('button', { name: 'Close menu' }).click()
  return labels
}

async function visitEverySidebarPage(page: Page, mobile: boolean) {
  for (const label of await sidebarLabels(page, mobile)) {
    if (mobile) await page.getByRole('button', { name: 'Menu' }).click()
    await page.locator('nav').getByRole('link', { name: label, exact: true }).click()
    await expectNotBlank(page)
    if (mobile) {
      const hasHorizontalScroll = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(hasHorizontalScroll, `horizontal scroll on "${label}"`).toBe(false)
    }
  }
}

// Every non-convenor role lands on the shared /portal shell; manager keeps
// using the convenor-shell /manager portal (same permission-driven sidebar
// as convenor, just missing the manager-hidden tabs) — see roles.ts.
const PORTAL_ROLES: Array<{ label: string; email: string; role: string; urlPattern: RegExp }> = [
  { label: 'author', email: FIXTURE.authorEmail, role: 'author', urlPattern: /\/portal/ },
  { label: 'reviewer', email: FIXTURE.reviewerEmail, role: 'reviewer', urlPattern: /\/portal/ },
  { label: 'session chair', email: FIXTURE.chairEmail, role: 'session_chair', urlPattern: /\/portal/ },
  { label: 'staff', email: FIXTURE.staffEmail, role: 'staff', urlPattern: /\/portal/ },
  { label: 'manager', email: FIXTURE.managerEmail, role: 'manager', urlPattern: /\/manager/ },
]

for (const r of PORTAL_ROLES) {
  test(`${r.label} logs in, lands on the right dashboard, and every sidebar page opens without errors (desktop)`, async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page)
    await signIn(page, r.email, r.role)
    await expect(page).toHaveURL(r.urlPattern)
    await expectNotBlank(page)

    await visitEverySidebarPage(page, false)

    expect(errors, `console errors for ${r.label}:\n${errors.join('\n')}`).toEqual([])
  })

  test(`${r.label} logs in, lands on the right dashboard, and every sidebar page opens without errors (390px mobile)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const errors = trackConsoleErrors(page)
    await signIn(page, r.email, r.role)
    await expect(page).toHaveURL(r.urlPattern)
    await expectNotBlank(page)

    await visitEverySidebarPage(page, true)

    expect(errors, `console errors for ${r.label} on mobile:\n${errors.join('\n')}`).toEqual([])
  })
}

test('a user with two roles sees both sections in one sidebar', async ({ page }) => {
  // e2e-chair holds both session_chair and reviewer in e2e-conf — logging
  // in picks one role to satisfy the login gate, but the sidebar is built
  // from every role the account holds, not just the one picked at login.
  await signIn(page, FIXTURE.chairEmail, 'session_chair')
  await expect(page).toHaveURL(/\/portal/)
  const labels = await sidebarLabels(page, false)
  expect(labels).toContain('My sessions')
  expect(labels).toContain('My reviews')
  expect(labels).not.toContain('My submissions')
  expect(labels).not.toContain('Check-in desk')
})

test('author registers to attend from My ticket, staff checks them in, convenor issues and releases a certificate, author downloads it from My certificates', async ({
  page,
}) => {
  // Approving the role request below triggers a window.confirm().
  page.on('dialog', (dialog) => dialog.accept())

  // A fresh author, not the shared e2e-author fixture — registration.spec.ts
  // already registers e2e-author for e2e-conf, and a conference only allows
  // one active registration per user (reusing that fixture here would 409
  // on whichever spec file happens to run second).
  const stamp = Date.now()
  const email = `e2e-portal-author-${stamp}@example.com`
  const fullName = `Portal Cert Author ${randomLetters(8)}`

  await page.goto(`/signup?conference=${FIXTURE.conferenceSlug}`)
  await page.getByRole('button', { name: 'Author', exact: true }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.locator('#su-full_name').fill(fullName)
  await page.locator('#su-email').fill(email)
  await page.locator('#su-phone').fill('9888888888')
  await page.locator('#su-password').fill(FIXTURE.password)
  await page.locator('#su-confirm_password').fill(FIXTURE.password)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('Account created')).toBeVisible()

  // Convenor approves the role request — login isn't allowed before that.
  await signIn(page, FIXTURE.convenorEmail, 'convenor')
  await expect(page).toHaveURL(/\/convenor/)
  await page.locator('nav').getByRole('link', { name: 'People' }).click()
  const requestRow = page.locator('li', { hasText: email })
  await expect(requestRow).toBeVisible()
  await requestRow.getByRole('button', { name: 'Approve' }).click()
  await expect(requestRow).toHaveCount(0)

  // 1. The author registers to attend from the portal's own "My ticket" page.
  await signIn(page, email, 'author')
  await expect(page).toHaveURL(/\/portal/)
  await page.locator('nav').getByRole('link', { name: 'My ticket' }).click()
  await page.locator('select').filter({ hasText: 'Choose a category' }).selectOption({ label: 'General' })
  await page.getByRole('button', { name: 'Register to attend' }).click()
  await expect(page.getByAltText('Your check-in QR code')).toBeVisible()

  // 2. Staff checks them in from the shared Check-in desk section.
  await signIn(page, FIXTURE.staffEmail, 'staff')
  await expect(page).toHaveURL(/\/portal/)
  await page.locator('nav').getByRole('link', { name: 'Check-in desk' }).click()
  await page.getByPlaceholder('Name, email or registration number').fill(fullName)
  const resultRow = page.locator('li', { hasText: fullName })
  await expect(resultRow).toBeVisible()
  await resultRow.getByRole('button', { name: 'Check in' }).click()
  await expect(page.getByText(new RegExp(`Checked in: ${fullName}`))).toBeVisible()

  // 3. The convenor (re-)generates participation certificates and releases them.
  await signIn(page, FIXTURE.convenorEmail, 'convenor')
  await page.locator('nav').getByRole('link', { name: 'Event' }).click()
  await page.getByRole('link', { name: 'Certificates', exact: true }).click()
  await page.getByRole('button', { name: 'Generate certificates' }).click()
  await expect(page.getByText(/Issued \d+, already had one: \d+\./)).toBeVisible()
  await expect(page.locator('tr', { hasText: fullName })).toBeVisible()
  await page.getByRole('button', { name: 'Release now' }).click()

  // 4. The author downloads their certificate from the shared My certificates section.
  await signIn(page, email, 'author')
  await page.locator('nav').getByRole('link', { name: 'My certificates' }).click()
  const downloadLink = page.getByRole('link', { name: 'Download PDF' })
  await expect(downloadLink).toBeVisible()
  const href = await downloadLink.getAttribute('href')
  const response = await page.request.get(href!)
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('pdf')
})

test('old single-role URLs redirect into the shared portal', async ({ page }) => {
  await signIn(page, FIXTURE.authorEmail, 'author')
  await page.goto('/author')
  await expect(page).toHaveURL(/\/portal\/author$/)
})

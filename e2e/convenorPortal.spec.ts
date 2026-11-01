import { expect, test, type Page } from '@playwright/test'

// The app shell's sidebar (#portal-sidebar, #convenor-sidebar, #admin-sidebar). A bare 'nav' also matches
// the dashboard's Quick links and the breadcrumb.
const SIDEBAR = '[id$="-sidebar"]'

// Mirrors server/tests/e2eSeed.ts — keep in sync if that fixture changes.
const FIXTURE = {
  conferenceSlug: 'e2e-conf',
  convenorEmail: 'e2e-convenor@example.com',
  password: 'Str0ng!Pass1',
}

// Same reasoning as e2e/main.spec.ts: a 401 from an "am I signed in / do I
// have this permission" probe is expected, handled noise — not a bug.
const EXPECTED_AUTH_PROBE_NOISE = /Failed to load resource.*\b40[13]\b/

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !EXPECTED_AUTH_PROBE_NOISE.test(msg.text())) errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

async function expectNotBlank(page: Page) {
  await expect.poll(async () => (await page.locator('main').innerText()).trim().length).toBeGreaterThan(0)
}

async function signInAsConvenor(page: Page) {
  await page.goto(`/c/${FIXTURE.conferenceSlug}/login`)
  await page.locator('#si-email').fill(FIXTURE.convenorEmail)
  await page.locator('#si-password').fill(FIXTURE.password)
  await page.locator('#si-role').selectOption('convenor')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/convenor/)
}

// Mirrors src/pages/convenor/sidebarConfig.ts — keep in sync if that changes.
const PAGES: Array<{ label: string; tabs: string[] }> = [
  { label: 'Dashboard', tabs: [] },
  { label: 'Conference setup', tabs: ['Details', 'Logo and branding', 'Location', 'Supporters'] },
  { label: 'Dates and tracks', tabs: ['Key dates', 'Tracks'] },
  { label: 'People', tabs: ['Role requests', 'Members and roles', 'Committees', 'Speakers'] },
  { label: 'Papers', tabs: ['Submissions', 'Reviews and decisions', 'Review settings'] },
  { label: 'Event', tabs: ['Programme', 'Attendance', 'Certificates', 'Book of abstracts', 'Feedback survey'] },
  { label: 'Communication', tabs: ['Announcements', 'Bulk email', 'Email templates', 'Email log', 'Reports', 'Analytics', 'Activity log'] },
]

test('convenor opens every sidebar page and tab without console errors (desktop)', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await signInAsConvenor(page)

  for (const sidebarPage of PAGES) {
    await page.locator(SIDEBAR).getByRole('link', { name: sidebarPage.label }).click()
    await expectNotBlank(page)
    for (const tab of sidebarPage.tabs) {
      await page.getByRole('link', { name: tab, exact: true }).click()
      await expectNotBlank(page)
    }
  }

  expect(errors, `console errors while visiting the convenor sidebar:\n${errors.join('\n')}`).toEqual([])
})

test('convenor opens every sidebar page and tab without console errors (390px mobile)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const errors = trackConsoleErrors(page)
  await signInAsConvenor(page)

  async function checkNoPageScroll(label: string) {
    const hasHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(hasHorizontalScroll, `horizontal scroll on "${label}"`).toBe(false)
  }

  for (const sidebarPage of PAGES) {
    await page.getByRole('button', { name: 'Menu' }).click()
    await page.locator(SIDEBAR).getByRole('link', { name: sidebarPage.label }).click()
    await expectNotBlank(page)
    await checkNoPageScroll(sidebarPage.label)
    for (const tab of sidebarPage.tabs) {
      await page.getByRole('link', { name: tab, exact: true }).click()
      await expectNotBlank(page)
      await checkNoPageScroll(`${sidebarPage.label} / ${tab}`)
    }
  }

  expect(errors, `console errors while visiting the convenor sidebar on mobile:\n${errors.join('\n')}`).toEqual([])
})

test('convenor sidebar shows People/Papers badges and hides manager-only tabs are visible for convenor', async ({ page }) => {
  await signInAsConvenor(page)
  // The convenor (unlike a manager) sees every tab, including the manager-hidden ones.
  await page.locator(SIDEBAR).getByRole('link', { name: 'People' }).click()
  await expect(page.getByRole('link', { name: 'Members and roles', exact: true })).toBeVisible()
  await page.locator(SIDEBAR).getByRole('link', { name: 'Communication', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Activity log', exact: true })).toBeVisible()
})

test('old flat convenor URLs redirect to the new tab URLs', async ({ page }) => {
  await signInAsConvenor(page)
  await page.goto('/convenor/logo')
  await expect(page).toHaveURL(/\/convenor\/setup\/branding$/)
  await page.goto('/convenor/role-requests')
  await expect(page).toHaveURL(/\/convenor\/people\/requests$/)
  await page.goto('/convenor/email-templates')
  await expect(page).toHaveURL(/\/convenor\/communication\/templates$/)
})

test('switching tabs with unsaved changes asks to discard them', async ({ page }) => {
  await signInAsConvenor(page)
  await page.locator(SIDEBAR).getByRole('link', { name: 'Conference setup' }).click()
  await expect(page).toHaveURL(/\/convenor\/setup\/details$/)
  await page.locator('#short_name').fill('An unsaved edit for the discard-changes prompt')

  // The app's own dialog (never a browser-native confirm): "Keep editing" stays put...
  await page.getByRole('link', { name: 'Location', exact: true }).click()
  const discard = page.getByRole('dialog', { name: 'Discard changes?' })
  await expect(discard).toBeVisible()
  await discard.getByRole('button', { name: 'Keep editing' }).click()
  await expect(page).toHaveURL(/\/convenor\/setup\/details$/)
  await expect(page.locator('#short_name')).toHaveValue('An unsaved edit for the discard-changes prompt')

  // ...and "Discard changes" finishes the navigation that was held back.
  await page.getByRole('link', { name: 'Location', exact: true }).click()
  await discard.getByRole('button', { name: 'Discard changes' }).click()
  await expect(page).toHaveURL(/\/convenor\/setup\/location$/)
})

test('convenor invites a reviewer by email', async ({ page }) => {
  await signInAsConvenor(page)
  await page.locator(SIDEBAR).getByRole('link', { name: 'People' }).click()
  await page.getByRole('link', { name: 'Members and roles', exact: true }).click()

  const stamp = Date.now()
  const email = `e2e-invited-reviewer-${stamp}@example.com`
  await page.getByPlaceholder('Full name').fill('Invited Reviewer')
  await page.getByPlaceholder('Email', { exact: true }).fill(email)
  await page.getByPlaceholder('Phone').fill('9877777777')
  await page.getByRole('combobox').last().selectOption('reviewer')
  await page.getByRole('button', { name: 'Send invitation' }).click()

  await expect(page.getByText(/Invitation email sent\.|Added — they already had an account\./)).toBeVisible()
  await expect(page.getByText(email)).toBeVisible()
})

test('convenor adds a committee member and it shows on the public page', async ({ page }) => {
  await signInAsConvenor(page)
  await page.locator(SIDEBAR).getByRole('link', { name: 'People' }).click()
  await page.getByRole('link', { name: 'Committees', exact: true }).click()

  const stamp = Date.now()
  const committeeName = `E2E Committee ${stamp}`
  const memberName = `E2E Committee Member ${stamp}`

  await page.getByPlaceholder('Committee name').fill(committeeName)
  await page.getByRole('button', { name: 'Add committee' }).click()
  const committeeCard = page.locator('div.rounded-lg.border.border-border.bg-surface.p-4', { hasText: committeeName })
  await expect(committeeCard).toBeVisible()

  await committeeCard.getByPlaceholder('Or type a name').fill(memberName)
  await committeeCard.getByRole('button', { name: 'Add member' }).click()
  await expect(page.getByText(memberName, { exact: false }).first()).toBeVisible()

  // Checked as a fresh visitor: the public conference response is browser-cacheable for 60 s
  // (Cache-Control in conferences/routes.ts), so the convenor's own tab may show it a minute late.
  const visitor = await page.context().browser()!.newPage()
  await visitor.goto(`${new URL(page.url()).origin}/c/${FIXTURE.conferenceSlug}#committees`)
  await expect(visitor.getByText(committeeName, { exact: true })).toBeVisible()
  await expect(visitor.getByText(memberName, { exact: false }).first()).toBeVisible()
  await visitor.close()
})

import { expect, test, type Page } from '@playwright/test'

// Mirrors server/tests/e2eSeed.ts — keep in sync if that fixture changes.
const FIXTURE = {
  conferenceSlug: 'e2e-conf',
  conferenceName: 'E2E Test Conference',
  adminEmail: 'e2e-admin@example.com',
  convenorEmail: 'e2e-convenor@example.com',
  password: 'Str0ng!Pass1',
}

async function signInAsAdmin(page: Page) {
  await page.goto('/super-admin/login')
  await page.locator('#sa-email').fill(FIXTURE.adminEmail)
  await page.locator('#sa-password').fill(FIXTURE.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/super-admin$/)
}

test('admin dashboard shows stat tiles and the system health card', async ({ page }) => {
  await signInAsAdmin(page)
  await expect(page.getByText('Total users')).toBeVisible()
  await expect(page.getByText('System health')).toBeVisible()
  await expect(page.getByText('Database')).toBeVisible()
  await expect(page.getByText('Email mode')).toBeVisible()
  await expect(page.getByText('Failed emails (24h)')).toBeVisible()
  await expect(page.getByText('Queued emails')).toBeVisible()
  await expect(page.getByText('Free disk space')).toBeVisible()
})

test('admin grants and revokes platform admin access', async ({ page }) => {
  await signInAsAdmin(page)
  await page.getByRole('button', { name: 'Admins', exact: true }).click()

  await page.locator('#grant-admin-email').fill(FIXTURE.convenorEmail)
  await page.getByRole('button', { name: 'Add admin' }).click()
  await expect(page.getByText(`${FIXTURE.convenorEmail} is now a platform administrator.`)).toBeVisible()

  const row = page.locator('li', { hasText: FIXTURE.convenorEmail })
  await expect(row).toBeVisible()

  await row.getByRole('button', { name: 'Remove' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove access' }).click()
  await expect(page.getByText(`Administrator access removed from ${FIXTURE.convenorEmail}.`)).toBeVisible()
})

test('admin edits platform settings and the home page reflects them', async ({ page }) => {
  await signInAsAdmin(page)
  await page.getByRole('button', { name: 'Platform settings', exact: true }).click()

  const stamp = Date.now()
  const headline = `E2E hero headline ${stamp}`
  await page.locator('#ps-hero-headline').fill(headline)
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByText('Saved.')).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('heading', { name: headline })).toBeVisible()
})

// The invitation email's raw set-password token is deliberately never
// exposed anywhere a browser can see it (not in this API's response, and
// the admin/convenor email log UI strips template_data before it reaches
// the frontend) — same reasoning as e2e/convenorPortal.spec.ts's "invites a
// reviewer by email" test, which also stops at the success toast. The
// token-bearing half (accept-invitation, set password, log in) is covered
// end-to-end by server/tests/convenorInvite.test.ts.
test('admin creates a conference and invites a convenor for it', async ({ page }) => {
  await signInAsAdmin(page)
  await page.getByRole('button', { name: 'Conferences', exact: true }).click()

  const stamp = Date.now()
  const name = `E2E New Conference ${stamp}`
  const code = `E2ENEW${stamp}`.toUpperCase().slice(0, 20)
  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

  await page.getByRole('button', { name: 'New conference' }).click()
  await page.locator('#new-name').fill(name)
  await page.locator('#new-short-name').fill(`E2ENew${stamp}`)
  await page.locator('#new-code').fill(code)
  await page.locator('#new-start').fill(today)
  await page.locator('#new-end').fill(tomorrow)
  await page.getByRole('button', { name: 'Create conference' }).click()
  await expect(page.getByText('Conference created with default key dates')).toBeVisible()
  await expect(page.locator('tr', { hasText: name })).toBeVisible()

  await page.getByRole('button', { name: 'Create convenor', exact: true }).click()
  const convenorEmail = `e2e-new-convenor-${stamp}@example.com`
  await page.locator('#cc-conference').selectOption({ label: `${name} (${code})` })
  await page.locator('#cc-name').fill('New Convenor')
  await page.locator('#cc-email').fill(convenorEmail)
  await page.locator('#cc-phone').fill('9811111111')
  await page.getByRole('button', { name: 'Send invitation' }).click()
  await expect(page.getByText(`Invitation sent to ${convenorEmail}.`)).toBeVisible()
})

test('view a conference as admin is read-only', async ({ page }) => {
  await signInAsAdmin(page)
  await page.getByRole('button', { name: 'Conferences', exact: true }).click()

  const row = page.locator('tr', { hasText: FIXTURE.conferenceName })
  await row.getByRole('link', { name: 'View as admin' }).click()

  await expect(page.getByText(/Viewing .* as admin — read-only\./)).toBeVisible()
  await page.locator('nav').getByRole('link', { name: 'Conference setup' }).click()
  await expect(page.getByRole('button', { name: 'Save' }).first()).toBeDisabled()

  await page.getByRole('link', { name: 'Exit' }).click()
  await expect(page).toHaveURL(/\/super-admin$/)
})

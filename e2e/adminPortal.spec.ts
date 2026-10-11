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

  page.once('dialog', (dialog) => dialog.accept())
  await row.getByRole('button', { name: 'Remove' }).click()
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

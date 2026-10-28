import { expect, test, type Page } from '@playwright/test'

// Mirrors server/tests/e2eSeed.ts — keep in sync if that fixture changes.
const FIXTURE = {
  conferenceSlug: 'e2e-conf',
  convenorEmail: 'e2e-convenor@example.com',
  adminEmail: 'e2e-admin@example.com',
  password: 'Str0ng!Pass1',
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

test('convenor sees the analytics dashboard and downloads both report formats', async ({ page }) => {
  await signIn(page, FIXTURE.convenorEmail, 'convenor')
  await expect(page).toHaveURL(/\/convenor/)
  await page.locator('nav').getByRole('link', { name: 'Communication' }).click()
  await page.getByRole('link', { name: 'Analytics', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible()
  await expect(page.getByText('Reviews overdue')).toBeVisible()
  await expect(page.getByText('Submissions per day')).toBeVisible()
  await expect(page.getByText('Acceptance rate (decided abstracts)')).toBeVisible()

  const pdfLink = page.getByRole('link', { name: 'Download PDF report' })
  const pdfHref = await pdfLink.getAttribute('href')
  const pdfRes = await page.request.get(pdfHref!)
  expect(pdfRes.status()).toBe(200)
  expect(pdfRes.headers()['content-type']).toContain('pdf')

  const xlsxLink = page.getByRole('link', { name: 'Download Excel' })
  const xlsxHref = await xlsxLink.getAttribute('href')
  const xlsxRes = await page.request.get(xlsxHref!)
  expect(xlsxRes.status()).toBe(200)
  expect(xlsxRes.headers()['content-type']).toContain('spreadsheetml')
})

test('super admin sees platform analytics', async ({ page }) => {
  await page.goto('/super-admin/login')
  await page.locator('#sa-email').fill(FIXTURE.adminEmail)
  await page.locator('#sa-password').fill(FIXTURE.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/super-admin$/)

  await page.getByRole('tab', { name: 'Analytics', exact: true }).click()
  await expect(page.getByText('Conferences by status')).toBeVisible()
  await expect(page.getByText('New users over time')).toBeVisible()
})

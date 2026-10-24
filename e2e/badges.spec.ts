import { expect, test, type Page } from '@playwright/test'

// Mirrors server/tests/e2eSeed.ts — keep in sync if that fixture changes.
const FIXTURE = {
  conferenceSlug: 'e2e-conf',
  convenorEmail: 'e2e-convenor@example.com',
  authorEmail: 'e2e-author@example.com',
  staffEmail: 'e2e-staff@example.com',
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

test('staff prints a badge from the check-in result, convenor prints a badge sheet by role filter', async ({ page }) => {
  // 1. The author registers to attend.
  await signIn(page, FIXTURE.authorEmail, 'author')
  await page.goto(`/c/${FIXTURE.conferenceSlug}`)
  await page.locator('select').filter({ hasText: 'Choose a category' }).selectOption({ label: 'General' })
  await page.getByRole('button', { name: 'Register to attend' }).click()
  await expect(page.getByText(/^E2ECONF-R\d+$/)).toBeVisible()

  // 2. Staff checks the author in, then prints a badge straight from the result panel.
  await signIn(page, FIXTURE.staffEmail, 'staff')
  await expect(page).toHaveURL(/\/portal/)
  await page.locator('nav').getByRole('link', { name: 'Check-in desk' }).click()
  await page.getByRole('tab', { name: 'Enter ticket code' }).click()
  await page.getByPlaceholder('Ticket code (e.g. A112-R0001), name or email').fill('E2E Author')
  const resultRow = page.locator('li', { hasText: 'E2E Author' })
  await expect(resultRow).toBeVisible()
  await resultRow.getByRole('button', { name: 'Select' }).click()
  await expect(page.getByRole('button', { name: 'Check in' })).toBeVisible()
  await page.getByRole('button', { name: 'Check in' }).click()
  await expect(page.getByText('This person has been checked in.')).toBeVisible()

  const staffBadgeLink = page.getByRole('link', { name: 'Print badge' })
  await expect(staffBadgeLink).toBeVisible()
  const staffHref = await staffBadgeLink.getAttribute('href')
  const staffPdf = await page.request.get(staffHref!)
  expect(staffPdf.status()).toBe(200)
  expect(staffPdf.headers()['content-type']).toContain('pdf')

  // 3. Convenor prints a badge sheet for every author from Attendance -> Print badges.
  await signIn(page, FIXTURE.convenorEmail, 'convenor')
  await expect(page).toHaveURL(/\/convenor/)
  await page.locator('nav').getByRole('link', { name: 'Event' }).click()
  await page.getByRole('link', { name: 'Attendance', exact: true }).click()
  const printBadges = page.getByTestId('print-badges')
  await printBadges.locator('select').filter({ hasText: 'Any role' }).selectOption({ label: 'Author' })
  await expect(printBadges.getByRole('cell', { name: 'E2E Author', exact: true })).toBeVisible()

  await printBadges.getByRole('button', { name: 'Select all' }).click()
  const sheetLink = printBadges.getByRole('link', { name: /Print badges \(1 selected\)/ })
  await expect(sheetLink).toBeVisible()
  const sheetHref = await sheetLink.getAttribute('href')
  const sheetPdf = await page.request.get(sheetHref!)
  expect(sheetPdf.status()).toBe(200)
  expect(sheetPdf.headers()['content-type']).toContain('pdf')
})

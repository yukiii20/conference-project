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
  // Wait for the login response itself (not just the click) — otherwise an
  // immediate page.goto right after can race the in-flight request and
  // abort it before the session cookie is ever set.
  await Promise.all([
    page.waitForResponse((res) => res.url().includes('/api/auth/login')),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ])
}

test('author registers and gets a ticket, staff checks them in, convenor issues and releases a certificate, author downloads it', async ({
  page,
}) => {
  // 1. The author registers to attend on the public conference page.
  await signIn(page, FIXTURE.authorEmail, 'author')
  await page.goto(`/c/${FIXTURE.conferenceSlug}`)
  await page.locator('select').filter({ hasText: 'Choose a category' }).selectOption({ label: 'General' })
  await page.getByRole('button', { name: 'Register to attend' }).click()

  await expect(page.getByText(/^E2ECONF-R\d+$/)).toBeVisible()
  await expect(page.getByAltText('Your check-in QR code')).toBeVisible()

  // 2. Staff signs in and checks the author in by manual search.
  await signIn(page, FIXTURE.staffEmail, 'staff')
  await expect(page).toHaveURL(/\/staff/)
  await page.getByPlaceholder('Name, email or registration number').fill('E2E Author')
  const resultRow = page.locator('li', { hasText: 'E2E Author' })
  await expect(resultRow).toBeVisible()
  await resultRow.getByRole('button', { name: 'Check in' }).click()
  await expect(page.getByText(/Checked in: E2E Author/)).toBeVisible()

  // 3. The convenor generates a participation certificate and releases it.
  await signIn(page, FIXTURE.convenorEmail, 'convenor')
  await expect(page).toHaveURL(/\/convenor/)
  await page.locator('nav').getByRole('link', { name: 'Event' }).click()
  await page.getByRole('link', { name: 'Certificates', exact: true }).click()

  await page.getByRole('button', { name: 'Generate certificates' }).click()
  await expect(page.getByText(/Issued 1/)).toBeVisible()
  await expect(page.locator('tr', { hasText: 'E2E Author' })).toBeVisible()

  await page.getByRole('button', { name: 'Release now' }).click()

  // 4. The author comes back and downloads their certificate PDF.
  await signIn(page, FIXTURE.authorEmail, 'author')
  await page.goto(`/c/${FIXTURE.conferenceSlug}`)
  const downloadLink = page.getByRole('link', { name: 'Download', exact: true })
  await expect(downloadLink).toBeVisible()
  const href = await downloadLink.getAttribute('href')
  const response = await page.request.get(href!)
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('pdf')
})

import { expect, test, type Page } from '@playwright/test'

// Mirrors server/tests/e2eSeed.ts — keep in sync if that fixture changes.
const FIXTURE = {
  conferenceSlug: 'e2e-conf',
  staffEmail: 'e2e-staff@example.com',
  password: 'Str0ng!Pass1',
}

function randomLetters(n: number): string {
  return Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')
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

async function signUpAndRegister(page: Page, fullName: string): Promise<{ email: string; registrationNumber: string }> {
  const email = `e2e-checkin-${Date.now()}-${randomLetters(4)}@example.com`

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
  await signIn(page, 'e2e-convenor@example.com', 'convenor')
  await expect(page).toHaveURL(/\/convenor/)
  await page.locator('nav').getByRole('link', { name: 'People' }).click()
  const requestRow = page.locator('li', { hasText: email })
  await expect(requestRow).toBeVisible()
  await requestRow.getByRole('button', { name: 'Approve' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click()
  await expect(requestRow).toHaveCount(0)

  await signIn(page, email, 'author')
  await expect(page).toHaveURL(/\/portal/)
  await page.locator('nav').getByRole('link', { name: 'My ticket' }).click()
  await page.locator('select').filter({ hasText: 'Choose a category' }).selectOption({ label: 'General' })
  await page.getByRole('button', { name: 'Register to attend' }).click()
  const codeLocator = page.getByText(/^E2ECONF-R\d+$/)
  await expect(codeLocator).toBeVisible()
  const registrationNumber = (await codeLocator.textContent())!.trim()

  return { email, registrationNumber }
}

test('upload QR image check-in: the downloaded ticket QR PNG checks the attendee in', async ({ page }) => {
  const fullName = `Upload QR Attendee ${randomLetters(6)}`
  await signUpAndRegister(page, fullName)

  const downloadLink = page.getByRole('link', { name: 'Download QR (PNG)' })
  await expect(downloadLink).toBeVisible()
  const href = await downloadLink.getAttribute('href')
  const response = await page.request.get(href!)
  expect(response.status()).toBe(200)
  const buffer = await response.body()

  await signIn(page, FIXTURE.staffEmail, 'staff')
  await expect(page).toHaveURL(/\/portal/)
  await page.locator('nav').getByRole('link', { name: 'Check-in desk' }).click()
  await page.getByRole('tab', { name: 'Upload QR image' }).click()

  await page.locator('input[type="file"]').setInputFiles({ name: 'ticket-qr.png', mimeType: 'image/png', buffer })

  const resultPanel = page.getByTestId('checkin-result')
  await expect(resultPanel.getByText(fullName)).toBeVisible({ timeout: 10000 })
  await expect(resultPanel.getByText('This person has been checked in.')).toBeVisible()
})

test('enter ticket code check-in: typing the exact code checks the attendee in', async ({ page }) => {
  const fullName = `Code Entry Attendee ${randomLetters(6)}`
  const { registrationNumber } = await signUpAndRegister(page, fullName)

  await signIn(page, FIXTURE.staffEmail, 'staff')
  await expect(page).toHaveURL(/\/portal/)
  await page.locator('nav').getByRole('link', { name: 'Check-in desk' }).click()
  await page.getByRole('tab', { name: 'Enter ticket code' }).click()

  // Lowercase and padded with spaces — case-insensitive, trimmed, per spec.
  await page.getByPlaceholder('Ticket code (e.g. A112-R0001), name or email').fill(`  ${registrationNumber.toLowerCase()}  `)
  await page.getByRole('button', { name: 'Look up' }).click()

  const resultPanel = page.getByTestId('checkin-result')
  await expect(resultPanel.getByText(fullName)).toBeVisible()
  await expect(resultPanel.getByRole('button', { name: 'Check in' })).toBeVisible()
  await resultPanel.getByRole('button', { name: 'Check in' }).click()
  await expect(resultPanel.getByText('This person has been checked in.')).toBeVisible()
})

test('verify only: uploading a QR image shows the result without checking the attendee in', async ({ page }) => {
  const fullName = `Verify Only Attendee ${randomLetters(6)}`
  await signUpAndRegister(page, fullName)

  const downloadLink = page.getByRole('link', { name: 'Download QR (PNG)' })
  const href = await downloadLink.getAttribute('href')
  const response = await page.request.get(href!)
  const buffer = await response.body()

  await signIn(page, FIXTURE.staffEmail, 'staff')
  await expect(page).toHaveURL(/\/portal/)
  await page.locator('nav').getByRole('link', { name: 'Check-in desk' }).click()

  const verifyOnlyCheckbox = page.getByRole('checkbox', { name: /Verify only/ })
  await verifyOnlyCheckbox.check()
  await expect(verifyOnlyCheckbox).toBeChecked()
  await page.getByRole('tab', { name: 'Upload QR image' }).click()
  await page.locator('input[type="file"]').setInputFiles({ name: 'ticket-qr.png', mimeType: 'image/png', buffer })

  const resultPanel = page.getByTestId('checkin-result')
  await expect(resultPanel.getByText(fullName)).toBeVisible({ timeout: 10000 })
  await expect(resultPanel.getByText('Ready to check in')).toBeVisible()
  await expect(resultPanel.getByText('This person has been checked in.')).not.toBeVisible()

  // Confirm nothing was actually recorded: look the same person up again by
  // ticket code and it still reports not checked in today.
  await page.getByRole('tab', { name: 'Enter ticket code' }).click()
  await page.getByPlaceholder('Ticket code (e.g. A112-R0001), name or email').fill(fullName)
  await page.locator('li', { hasText: fullName }).getByRole('button', { name: 'Select' }).click()
  await expect(resultPanel.getByText('Ready to check in')).toBeVisible()
})

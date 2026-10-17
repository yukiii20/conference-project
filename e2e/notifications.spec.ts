import { expect, test, type Page } from '@playwright/test'

// Mirrors server/tests/e2eSeed.ts.
const FIXTURE = {
  conferenceSlug: 'e2e-conf',
  adminEmail: 'e2e-admin@example.com',
  convenorEmail: 'e2e-convenor@example.com',
  password: 'Str0ng!Pass1',
}

async function signIn(page: Page, email: string, password: string, role: string) {
  await page.goto('/login')
  await page.locator('#si-email').fill(email)
  await page.locator('#si-password').fill(password)
  await page.locator('#si-role').selectOption(role)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('role approval notifies the author (bell badge + dropdown) and shows up in both email log views', async ({ page }) => {
  const stamp = Date.now()
  const authorEmail = `e2e-notif-author-${stamp}@example.com`

  // 1. Sign up a fresh author.
  await page.goto(`/signup?conference=${FIXTURE.conferenceSlug}`)
  await page.getByRole('button', { name: 'Author', exact: true }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.locator('#su-full_name').fill('Notif Author')
  await page.locator('#su-email').fill(authorEmail)
  await page.locator('#su-phone').fill('9877777777')
  await page.locator('#su-password').fill(FIXTURE.password)
  await page.locator('#su-confirm_password').fill(FIXTURE.password)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('Account created')).toBeVisible()

  // 2. Convenor approves them — this queues an email AND an in-app notification.
  await signIn(page, FIXTURE.convenorEmail, FIXTURE.password, 'convenor')
  await expect(page).toHaveURL(/\/convenor/)
  await page.locator('nav').getByRole('link', { name: 'People' }).click()
  const row = page.locator('li', { hasText: authorEmail })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Approve' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click()
  await expect(row).toHaveCount(0)

  // 3. Convenor's own "Email log" tab lists queued/sent email activity.
  await page.locator('nav').getByRole('link', { name: 'Communication and reports' }).click()
  await page.getByRole('link', { name: 'Email log', exact: true }).click()
  await expect(page.getByText('role_request_approved').first()).toBeVisible()

  // 4. The author sees an unread notification.
  await signIn(page, authorEmail, FIXTURE.password, 'author')
  await expect(page).toHaveURL(/\/portal/)
  const bellButton = page.getByRole('button', { name: /Notifications/ })
  await expect(bellButton).toBeVisible()
  await expect(bellButton.getByText('1')).toBeVisible()

  await bellButton.click()
  await expect(page.getByText('Role request approved')).toBeVisible()
  await page.getByText('Role request approved').click()

  // Clicking it marks it read and the badge clears.
  await expect(bellButton.getByText('1')).toHaveCount(0)

  // 5. The platform admin's Email log page shows the same activity.
  await page.goto('/super-admin/login')
  await page.locator('#sa-email').fill(FIXTURE.adminEmail)
  await page.locator('#sa-password').fill(FIXTURE.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/super-admin$/)
  await page.getByRole('button', { name: 'Email log' }).click()
  await expect(page.getByText(authorEmail).first()).toBeVisible()
})

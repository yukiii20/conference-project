import { expect, test, type Page } from '@playwright/test'

// Mirrors server/tests/e2eSeed.ts — keep in sync if that fixture changes.
const FIXTURE = {
  adminEmail: 'e2e-admin@example.com',
  password: 'Str0ng!Pass1',
}

async function signInAsAdmin(page: Page) {
  await page.goto('/super-admin/login')
  await page.locator('#sa-email').fill(FIXTURE.adminEmail)
  await page.locator('#sa-password').fill(FIXTURE.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/super-admin$/)
}

const OVERFLOW_TOLERANCE_PX = 1

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(
    scrollWidth - clientWidth,
    `horizontal overflow on "${label}" — scrollWidth ${scrollWidth} vs clientWidth ${clientWidth}`,
  ).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX)
}

test('visitor sends a suggestion from the home page, admin sees it and resolves it, badge count goes down', async ({
  page,
}) => {
  const stamp = Date.now()
  const message = `E2E suggestion message ${stamp} — please consider adding this.`

  await page.goto('/')
  await page.getByRole('link', { name: 'Feedback' }).click()
  await expect(page.getByRole('heading', { name: 'Help us improve' })).toBeInViewport()

  await page.getByRole('button', { name: 'Bug' }).click()
  await page.locator('#suggestion-message').fill(message)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText('Thanks — your suggestion has been sent.')).toBeVisible()

  await signInAsAdmin(page)
  const suggestionsTab = page.getByRole('tab', { name: /^Suggestions/ })
  await expect(suggestionsTab).toContainText('(1)')
  await suggestionsTab.click()

  const row = page.locator('tr', { hasText: message.slice(0, 40) })
  await expect(row).toBeVisible()
  // Scoped to <span> (the status chip), not <option> — the row's own quick-
  // status <select> also has a "New"/"Resolved" option with the same text.
  const statusChip = row.locator('span', { hasText: 'New' })
  await expect(statusChip).toBeVisible()
  await expect(row.getByText('Bug', { exact: true })).toBeVisible()
  await expect(row.getByText('Anonymous')).toBeVisible()

  await row.locator('select').first().selectOption({ label: 'Resolved' })
  await expect(row.locator('span', { hasText: 'Resolved' })).toBeVisible()
  await expect(suggestionsTab).toContainText('(0)')
})

test('home page suggestion box has no horizontal overflow at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('link', { name: 'Feedback' }).click()
  await expect(page.getByRole('heading', { name: 'Help us improve' })).toBeInViewport()

  await page.getByRole('button', { name: 'Question' }).click()
  await page.locator('#suggestion-message').fill('E2E suggestion mobile-width message for the overflow check.')
  await expectNoHorizontalOverflow(page, 'home page suggestion box @ 390px')
})

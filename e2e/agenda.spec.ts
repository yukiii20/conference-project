import { expect, test, type Page } from '@playwright/test'

// Mirrors server/tests/e2eSeed.ts — keep in sync if that fixture changes.
const FIXTURE = {
  conferenceSlug: 'e2e-conf',
  authorEmail: 'e2e-author@example.com',
  password: 'Str0ng!Pass1',
}

async function signIn(page: Page, email: string, password: string, role: string) {
  await page.goto('/login')
  await page.locator('#si-email').fill(email)
  await page.locator('#si-password').fill(password)
  await page.locator('#si-role').selectOption(role)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('my agenda: page loads, calendar link can be shown and reset', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await signIn(page, FIXTURE.authorEmail, FIXTURE.password, 'author')
  await expect(page).toHaveURL(/\/portal/)
  await page.locator('#portal-sidebar').getByRole('link', { name: 'My agenda' }).click()
  await expect(page.getByRole('heading', { name: 'My agenda' })).toBeVisible()

  await page.getByRole('button', { name: 'Show my calendar link' }).click()
  const link = page.getByLabel('Private calendar link')
  await expect(link).toHaveValue(/\/api\/calendar\/[0-9a-f]{64}\.ics$/)
  const firstUrl = await link.inputValue()

  // The feed itself is a valid calendar, reachable without a session cookie.
  const feed = await page.request.get(new URL(firstUrl).pathname)
  expect(feed.status()).toBe(200)
  expect(await feed.text()).toContain('BEGIN:VCALENDAR')

  await page.getByRole('button', { name: 'Reset link' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Reset link' }).click()
  await expect(page.getByText('New calendar link created.')).toBeVisible()
  await expect(link).not.toHaveValue(firstUrl)
  expect((await page.request.get(new URL(firstUrl).pathname)).status()).toBe(404)

  expect(consoleErrors).toEqual([])
})

test('my agenda fits a 390px phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, FIXTURE.authorEmail, FIXTURE.password, 'author')
  await expect(page).toHaveURL(/\/portal/)
  await page.goto('/portal/agenda')
  await expect(page.getByRole('heading', { name: 'My agenda' })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

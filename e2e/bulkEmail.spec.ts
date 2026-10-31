import { expect, test } from '@playwright/test'

// Mirrors server/tests/e2eSeed.ts — keep in sync if that fixture changes.
const FIXTURE = {
  convenorEmail: 'e2e-convenor@example.com',
  password: 'Str0ng!Pass1',
  conferenceSlug: 'e2e-conf',
}

test('convenor composes a bulk email, previews it, sends a test, and sends it for real (console mode)', async ({ page }) => {
  await page.goto(`/c/${FIXTURE.conferenceSlug}/login`)
  await page.locator('#si-email').fill(FIXTURE.convenorEmail)
  await page.locator('#si-password').fill(FIXTURE.password)
  await page.locator('#si-role').selectOption('convenor')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/convenor/)

  await page.locator('nav').getByRole('link', { name: 'Communication' }).click()
  await page.getByRole('link', { name: 'Bulk email', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Bulk email' })).toBeVisible()

  // The e2e fixture has exactly one accepted paper, with one author.
  await page.getByLabel('Authors with accepted papers').check()
  await expect(page.getByText(/1 person matches these groups/)).toBeVisible()

  const subjectField = page.getByPlaceholder('Subject')
  await subjectField.fill('Hello {{first_name}}')
  await page.getByPlaceholder(/Write the message/).fill('<p>Dear {{full_name}}, welcome to {{conference_name}}.</p>')

  await page.getByRole('button', { name: 'Preview with sample data' }).click()
  await expect(page.getByTitle('Bulk email preview')).toBeVisible()

  await page.getByRole('button', { name: 'Send test to me' }).click()
  await expect(page.getByText('Test email queued')).toBeVisible()

  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Send this bulk email?' })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Send' }).click()

  await expect(page.getByText(/Sent to 1 person\./)).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Hello {{first_name}}' })).toBeVisible()
})

import { expect, test, type Page } from '@playwright/test'

// Mirrors server/tests/e2eSeed.ts — keep in sync if that fixture changes.
const FIXTURE = {
  conferenceSlug: 'e2e-conf',
  convenorEmail: 'e2e-convenor@example.com',
  password: 'Str0ng!Pass1',
}

async function signIn(page: Page, email: string, password: string, role: string) {
  await page.goto(`/c/${FIXTURE.conferenceSlug}/login`)
  await page.locator('#si-email').fill(email)
  await page.locator('#si-password').fill(password)
  await page.locator('#si-role').selectOption(role)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('convenor generates the book of abstracts, downloads it, and publishes it on the conference page', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await signIn(page, FIXTURE.convenorEmail, FIXTURE.password, 'convenor')
  await expect(page).toHaveURL(/\/convenor/)
  await page.locator('nav').getByRole('link', { name: 'Event' }).click()
  await page.getByRole('link', { name: 'Book of abstracts', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Book of abstracts' })).toBeVisible()

  // The seeded accepted paper makes at least one abstract eligible.
  const generate = page.getByRole('button', { name: /^(Generate|Re-generate) book/ })
  await expect(generate).toBeEnabled()
  const wasRegenerate = (await generate.textContent())?.startsWith('Re-generate')
  await generate.click()
  if (wasRegenerate) await page.getByRole('dialog').getByRole('button', { name: 'Re-generate' }).click()
  await expect(page.getByText(/Book generated: \d+ abstracts?, \d+ pages\./)).toBeVisible()

  const download = page.getByRole('link', { name: 'Download PDF' })
  const pdf = await page.request.get((await download.getAttribute('href'))!)
  expect(pdf.status()).toBe(200)
  expect(pdf.headers()['content-type']).toContain('application/pdf')

  const publish = page.getByLabel('Publish on conference page (anyone can download it)')
  if (!(await publish.isChecked())) {
    await publish.click() // controlled: it only flips after the confirm dialog
    await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click()
    await expect(page.getByText('Anyone can now download it from the conference page.')).toBeVisible()
  }

  await page.goto(`/c/${FIXTURE.conferenceSlug}#programme`)
  const publicLink = page.getByRole('link', { name: 'Book of abstracts (PDF)' })
  await expect(publicLink).toBeVisible()
  expect((await page.request.get((await publicLink.getAttribute('href'))!)).status()).toBe(200)

  // Leave the fixture as other specs expect it: not public.
  await page.goto('/convenor/event/abstracts')
  await page.getByLabel('Publish on conference page (anyone can download it)').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByText('Removed from the conference page.')).toBeVisible()

  expect(consoleErrors).toEqual([])
})

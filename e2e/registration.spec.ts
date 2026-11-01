import { expect, test, type Page } from '@playwright/test'
import { registerOrReuseTicket } from './registrationHelpers'

// The app shell's sidebar (#portal-sidebar, #convenor-sidebar, #admin-sidebar). A bare 'nav' also matches
// the dashboard's Quick links and the breadcrumb.
const SIDEBAR = '[id$="-sidebar"]'

// Mirrors server/tests/e2eSeed.ts — keep in sync if that fixture changes.
const FIXTURE = {
  conferenceSlug: 'e2e-conf',
  convenorEmail: 'e2e-convenor@example.com',
  authorEmail: 'e2e-author@example.com',
  staffEmail: 'e2e-staff@example.com',
  password: 'Str0ng!Pass1',
}

async function signIn(page: Page, email: string, role: string) {
  await page.goto(`/c/${FIXTURE.conferenceSlug}/login`)
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
  await registerOrReuseTicket(page)

  await expect(page.getByText(/^E2ECONF-R\d+$/)).toBeVisible()
  await expect(page.getByAltText('Your check-in QR code')).toBeVisible()

  // 2. Staff signs in and checks the author in via the "Enter ticket code"
  // tab's name search (same underlying /registrations/search as before —
  // just reached through the redesigned 3-tab check-in card).
  await signIn(page, FIXTURE.staffEmail, 'staff')
  await expect(page).toHaveURL(/\/portal/)
  await page.locator(SIDEBAR).getByRole('link', { name: 'Check-in desk' }).click()
  await page.getByRole('tab', { name: 'Enter ticket code' }).click()
  await page.getByPlaceholder('Ticket code (e.g. A112-R0001), name or email').fill('E2E Author')
  const resultRow = page.locator('li', { hasText: 'E2E Author' })
  await expect(resultRow).toBeVisible()
  await resultRow.getByRole('button', { name: 'Select' }).click()
  // Other specs check the same seeded author in today, and a second same-day check-in is
  // refused by design, so either outcome proves the author is checked in.
  const checkIn = page.getByRole('button', { name: 'Check in' })
  const alreadyIn = page.getByText('Already checked in today')
  await expect(checkIn.or(alreadyIn)).toBeVisible()
  if (await checkIn.isVisible()) {
    await checkIn.click()
    await expect(page.getByText('This person has been checked in.')).toBeVisible()
  }

  // 3. The convenor generates a participation certificate and releases it.
  await signIn(page, FIXTURE.convenorEmail, 'convenor')
  await expect(page).toHaveURL(/\/convenor/)
  await page.locator(SIDEBAR).getByRole('link', { name: 'Event' }).click()
  await page.getByRole('link', { name: 'Certificates', exact: true }).click()

  await page.getByRole('button', { name: 'Generate certificates' }).click()
  // portal.spec may already have issued this author's certificate: either way it must exist.
  await expect(page.getByText(/Issued \d+, already had one: \d+\./)).toBeVisible()
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

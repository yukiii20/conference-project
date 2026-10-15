import { expect, test, type Page } from '@playwright/test'

// Mirrors server/tests/e2eSeed.ts — keep in sync if that fixture changes.
const FIXTURE = {
  conferenceSlug: 'e2e-conf',
  convenorEmail: 'e2e-convenor@example.com',
  chairEmail: 'e2e-chair@example.com',
  password: 'Str0ng!Pass1',
  acceptedSubmissionTitle: 'E2E Accepted Paper',
}

async function signIn(page: Page, email: string, role: string) {
  await page.goto('/login')
  await page.locator('#si-email').fill(email)
  await page.locator('#si-password').fill(FIXTURE.password)
  await page.locator('#si-role').selectOption(role)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

test('convenor builds a session, publishes it, it appears on the public programme; the chair marks it presented', async ({
  page,
}) => {
  const stamp = Date.now()
  const roomName = `E2E Room ${stamp}`
  const sessionTitle = `E2E Session ${stamp}`

  await signIn(page, FIXTURE.convenorEmail, 'convenor')
  await expect(page).toHaveURL(/\/convenor/)
  await page.locator('nav').getByRole('link', { name: 'Event' }).click()
  await page.getByRole('link', { name: 'Programme', exact: true }).click()

  // 1. Create a room — its create form is the one with the "Add room" submit button.
  const roomForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add room' }) })
  await roomForm.locator('input').first().fill(roomName)
  await roomForm.getByRole('button', { name: 'Add room' }).click()
  // Scoped to the rooms table cell — the same name also becomes a <option>
  // in the session form's room picker once it reloads.
  await expect(page.getByRole('cell', { name: roomName })).toBeVisible()

  // 2. Create a published session in that room, starting now, for an hour.
  // Its form is the one with the "Title" field (distinct from the time-slot form above it).
  const sessionForm = page.locator('form').filter({ has: page.getByPlaceholder('Title') })
  const starts = new Date()
  const ends = new Date(starts.getTime() + 60 * 60 * 1000)

  await sessionForm.getByPlaceholder('Title').fill(sessionTitle)
  await sessionForm.locator('select').nth(2).selectOption({ label: roomName }) // session_type, track, room, status
  await sessionForm.locator('input[type="datetime-local"]').nth(0).fill(toLocalInputValue(starts))
  await sessionForm.locator('input[type="datetime-local"]').nth(1).fill(toLocalInputValue(ends))
  await sessionForm.locator('select').nth(3).selectOption('published')
  await sessionForm.getByRole('button', { name: 'Add session' }).click()
  // Scoped to the sessions table cell — the same title can also appear in
  // the "needs attention" warnings panel (no chair yet) as plain text.
  await expect(page.getByRole('cell', { name: sessionTitle })).toBeVisible()

  // 3. Open "Manage", assign the session chair, and schedule the accepted paper into it.
  const sessionRow = page.locator('tr', { hasText: sessionTitle })
  await sessionRow.getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('combobox').filter({ hasText: 'Choose a person' }).selectOption({ label: 'E2E Chair' })
  await page.getByRole('button', { name: 'Add chair' }).click()
  await expect(page.locator('li', { hasText: 'E2E Chair' })).toBeVisible()
  await page.getByRole('combobox').filter({ hasText: 'Choose a paper' }).selectOption({ label: FIXTURE.acceptedSubmissionTitle })
  await page.getByRole('button', { name: 'Add', exact: true }).first().click()
  // Scoped to <li> — the same title also appears in the "needs attention"
  // warnings panel (as plain text) until it refreshes.
  await expect(page.locator('li', { hasText: FIXTURE.acceptedSubmissionTitle })).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()

  // 4. The public programme shows the published session and the paper.
  await page.goto(`/c/${FIXTURE.conferenceSlug}`)
  await expect(page.getByText(sessionTitle)).toBeVisible()
  await expect(page.getByText(FIXTURE.acceptedSubmissionTitle)).toBeVisible()

  // 5. The session chair signs in, finds the session, and marks it presented.
  await signIn(page, FIXTURE.chairEmail, 'session_chair')
  await expect(page).toHaveURL(/\/session-chair/)
  await expect(page.getByText(sessionTitle)).toBeVisible()
  const sessionCard = page.locator('li', { hasText: sessionTitle })
  await sessionCard.getByRole('button', { name: 'Mark attendance' }).click()
  await expect(page.getByText(FIXTURE.acceptedSubmissionTitle)).toBeVisible()
  await page.getByRole('button', { name: 'Presented' }).click()
  await expect(page.getByText('Status: presented')).toBeVisible()
})

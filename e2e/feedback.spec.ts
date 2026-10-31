import { expect, test, type Page } from '@playwright/test'

// Mirrors server/tests/e2eSeed.ts — keep in sync if that fixture changes.
const FIXTURE = {
  conferenceSlug: 'e2e-conf',
  convenorEmail: 'e2e-convenor@example.com',
  chairEmail: 'e2e-chair@example.com',
  password: 'Str0ng!Pass1',
}

const KATHMANDU_OFFSET_MS = (5 * 60 + 45) * 60 * 1000

/** A datetime-local value in Nepal time, the same shape the convenor types. */
function ktmInput(date: Date): string {
  return new Date(date.getTime() + KATHMANDU_OFFSET_MS).toISOString().slice(0, 16)
}

async function signIn(page: Page, email: string, role: string) {
  await page.goto('/login')
  await page.locator('#si-email').fill(email)
  await page.locator('#si-password').fill(FIXTURE.password)
  await page.locator('#si-role').selectOption(role)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** Makes e2e-chair eligible (chairs a session) through the convenor API; returns a cleanup. */
async function chairASession(page: Page, stamp: number): Promise<() => Promise<void>> {
  const conferenceId = (await (await page.request.get(`/api/conferences/${FIXTURE.conferenceSlug}`)).json()).conference.id as string
  const room = await page.request.post(`/api/conferences/${conferenceId}/rooms`, { data: { name: `Feedback Hall ${stamp}`, equipment: [] } })
  expect(room.status()).toBe(201)
  const startsAt = new Date(Date.now() - 2 * 60 * 60 * 1000)
  startsAt.setUTCMinutes(0, 0, 0)
  const session = await page.request.post(`/api/conferences/${conferenceId}/sessions`, {
    data: {
      title: `Feedback Session ${stamp}`,
      session_type: 'paper',
      track_id: null,
      room_id: (await room.json()).id,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + 60 * 60 * 1000).toISOString(),
      status: 'draft',
    },
  })
  expect(session.status()).toBe(201)
  const sessionId = (await session.json()).id as string
  const candidates = (await (await page.request.get(`/api/conferences/${conferenceId}/sessions/chair-candidates`)).json()).candidates as Array<{
    user_id: string
    full_name: string
  }>
  const chair = candidates.find((c) => c.full_name === 'E2E Chair')!
  expect((await page.request.post(`/api/conferences/${conferenceId}/sessions/${sessionId}/chairs`, { data: { user_id: chair.user_id } })).status()).toBe(201)
  return async () => {
    await page.request.delete(`/api/conferences/${conferenceId}/sessions/${sessionId}`)
  }
}

test('convenor builds and opens the feedback survey, a chair answers anonymously, results hide the name', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  const stamp = Date.now()

  await signIn(page, FIXTURE.convenorEmail, 'convenor')
  await expect(page).toHaveURL(/\/convenor/)
  const cleanup = await chairASession(page, stamp)

  await page.locator('nav').getByRole('link', { name: 'Event' }).click()
  await page.getByRole('link', { name: 'Feedback survey', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Feedback survey' })).toBeVisible()

  await page.getByRole('button', { name: 'Create the survey' }).click()
  await page.getByLabel('Title').fill('How was E2E?')
  await page.getByLabel('Opens (Nepal time)').fill(ktmInput(new Date(Date.now() - 60 * 60 * 1000)))
  await page.getByLabel('Closes (Nepal time)').fill(ktmInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)))
  await page.getByRole('button', { name: 'Add question' }).click()
  await page.getByLabel('Question 1').fill('Would you come again?')
  await page.getByRole('button', { name: 'Save survey' }).click()
  await expect(page.getByText('Survey saved.')).toBeVisible()

  await page.getByRole('button', { name: 'Open survey' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Open' }).click()
  await expect(page.getByText('The survey is open.')).toBeVisible()
  await expect(page.getByText('Open for answers')).toBeVisible()

  // The chair answers from their portal.
  await page.context().clearCookies()
  await signIn(page, FIXTURE.chairEmail, 'session_chair')
  await expect(page).toHaveURL(/\/portal/)
  await page.getByRole('link', { name: 'Give feedback' }).first().click()
  await expect(page.getByRole('heading', { name: 'How was E2E?' })).toBeVisible()
  await page.getByRole('radio', { name: '4 out of 5' }).first().check({ force: true })
  await page.getByLabel('Any other comments or suggestions?').fill(`Anonymous e2e comment ${stamp}`)
  await page.getByLabel("Answer anonymously (the organisers won't see your name)").check()
  await page.getByRole('button', { name: 'Send feedback' }).click()
  await expect(page.getByText('Thank you - your feedback is in.')).toBeVisible()

  // Back to the convenor: the comment is there, without the chair's name.
  await page.context().clearCookies()
  await signIn(page, FIXTURE.convenorEmail, 'convenor')
  await expect(page).toHaveURL(/\/convenor/)
  await page.goto('/convenor/event/feedback')
  const comment = page.getByText(`Anonymous e2e comment ${stamp}`)
  await expect(comment).toBeVisible()
  await expect(comment.locator('xpath=..')).toContainText('Anonymous')
  await expect(comment.locator('xpath=..')).not.toContainText('E2E Chair')
  await expect(page.getByRole('link', { name: 'Download Excel' })).toBeVisible()

  await cleanup()
  expect(consoleErrors).toEqual([])
})

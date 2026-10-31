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

/** A session with two speaker talks, built through the convenor API (the programme UI itself is covered by programme.spec.ts). */
async function createSessionWithTalks(page: Page, stamp: number): Promise<{ conferenceId: string; sessionId: string }> {
  const conf = await page.request.get(`/api/conferences/${FIXTURE.conferenceSlug}`)
  const conferenceId = (await conf.json()).conference.id as string

  const room = await page.request.post(`/api/conferences/${conferenceId}/rooms`, { data: { name: `Timer Hall ${stamp}`, equipment: [] } })
  expect(room.status()).toBe(201)
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  startsAt.setUTCMinutes(0, 0, 0)
  const session = await page.request.post(`/api/conferences/${conferenceId}/sessions`, {
    data: {
      title: `Timer Session ${stamp}`,
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

  const speaker = await page.request.post(`/api/conferences/${conferenceId}/speakers`, {
    data: { full_name: `Timer Speaker ${stamp}`, speaker_type: 'invited' },
  })
  expect(speaker.status()).toBe(201)
  const speakerId = (await speaker.json()).id as string
  for (const title of ['First timed talk', 'Second timed talk']) {
    const talk = await page.request.post(`/api/conferences/${conferenceId}/sessions/${sessionId}/presentations/speakers`, {
      data: { speaker_id: speakerId, title, duration_minutes: 20 },
    })
    expect(talk.status()).toBe(201)
  }
  return { conferenceId, sessionId }
}

test('convenor opens the session timer: start/pause, next talk, Q&A, mark presented, keyboard shortcuts', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  const stamp = Date.now()

  await signIn(page, FIXTURE.convenorEmail, FIXTURE.password, 'convenor')
  await expect(page).toHaveURL(/\/convenor/)
  const { conferenceId, sessionId } = await createSessionWithTalks(page, stamp)

  await page.goto(`/timer/${conferenceId}/${sessionId}`)
  const timer = page.getByTestId('session-timer')
  await expect(timer).toBeVisible()
  await expect(page.getByRole('heading', { name: `Timer Session ${stamp}` })).toBeVisible()
  await expect(page.getByText('First timed talk')).toBeVisible()
  await expect(page.getByRole('timer')).toHaveText('15:00')
  await expect(timer).toHaveAttribute('data-colour', 'green')
  await expect(page.getByText(`Next: Timer Speaker ${stamp}`)).toBeVisible()

  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByRole('timer')).not.toHaveText('15:00', { timeout: 5000 })
  await page.keyboard.press('Space') // pause
  await expect(page.getByText('Paused')).toBeVisible()

  await page.getByRole('button', { name: 'Start Q&A' }).click()
  await expect(page.getByText('Talk 1 of 2 · Q&A')).toBeVisible()
  await expect(page.getByRole('timer')).toHaveText('5:00')

  await page.getByRole('button', { name: 'Mark presented' }).click()
  await expect(page.getByText('Marked "First timed talk" presented.')).toBeVisible()

  await page.keyboard.press('n')
  await expect(page.getByText('Talk 2 of 2 · Talk')).toBeVisible()
  await expect(page.getByText('Second timed talk')).toBeVisible()
  await expect(page.getByText('This is the last talk of the session.')).toBeVisible()

  expect(consoleErrors).toEqual([])
})

test('the timer fits a 390px phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const stamp = Date.now()
  await signIn(page, FIXTURE.convenorEmail, FIXTURE.password, 'convenor')
  await expect(page).toHaveURL(/\/convenor/)
  const { conferenceId, sessionId } = await createSessionWithTalks(page, stamp)
  await page.goto(`/timer/${conferenceId}/${sessionId}`)
  await expect(page.getByRole('timer')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

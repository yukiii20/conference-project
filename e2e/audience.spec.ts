import { expect, test, type Page } from '@playwright/test'

// Mirrors server/tests/e2eSeed.ts — keep in sync if that fixture changes.
const FIXTURE = {
  conferenceSlug: 'e2e-conf',
  convenorEmail: 'e2e-convenor@example.com',
  password: 'Str0ng!Pass1',
}

async function signInAsConvenor(page: Page) {
  await page.goto(`/c/${FIXTURE.conferenceSlug}/login`)
  await page.locator('#si-email').fill(FIXTURE.convenorEmail)
  await page.locator('#si-password').fill(FIXTURE.password)
  await page.locator('#si-role').selectOption('convenor')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/convenor/)
}

async function expectNoSideScroll(page: Page, where: string) {
  const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(scrolls, `horizontal scroll on ${where}`).toBe(false)
}

/**
 * The Audience journey on a 390px phone: sign up as Audience (category + registration in one
 * step) -> QR ticket -> star a session -> ask a question in a live session -> the convenor sees it
 * on the live moderation page and marks it answered -> Join online -> rate the session ->
 * conference feedback -> download a material -> certificate after check-in and release ->
 * no way into the organiser pages.
 */
test('Audience: sign up, ticket, programme, Q&A with live moderation, feedback, materials, certificate', async ({ browser }) => {
  const stamp = Date.now()
  const sessionTitle = `Audience Live ${stamp}`
  const categoryName = `Audience E2E ${stamp}`
  const email = `audience-${stamp}@example.com`
  const question = `What is the main finding ${stamp}?`
  const materialTitle = `Venue map ${stamp}`
  let materialId: string | null = null

  // --- Convenor prepares: a free category, and a hybrid session that is live right now.
  const convenorCtx = await browser.newContext()
  const convenor = await convenorCtx.newPage()
  await signInAsConvenor(convenor)
  const conferenceId = (await (await convenor.request.get(`/api/conferences/${FIXTURE.conferenceSlug}`)).json()).conference.id as string
  const category = await convenor.request.post(`/api/conferences/${conferenceId}/registration-categories`, {
    data: { code: `aud_${stamp}`.slice(0, 40), name: categoryName, is_active: true, display_order: 0 },
  })
  expect(category.status()).toBe(201)
  const categoryId = (await category.json()).id as string
  const room = await convenor.request.post(`/api/conferences/${conferenceId}/rooms`, { data: { name: `Audience Hall ${stamp}`, equipment: [] } })
  expect(room.status()).toBe(201)
  const startsAt = new Date(Date.now() - 10 * 60_000)
  const session = await convenor.request.post(`/api/conferences/${conferenceId}/sessions`, {
    data: {
      title: sessionTitle,
      session_type: 'paper',
      track_id: null,
      room_id: (await room.json()).id,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + 60 * 60_000).toISOString(),
      status: 'published',
      delivery_mode: 'hybrid',
      online_url: 'https://meet.example.org/e2e-audience',
      online_instructions: 'Passcode 1234',
    },
  })
  expect(session.status()).toBe(201)
  const sessionId = (await session.json()).id as string

  const audienceCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await audienceCtx.newPage()
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  try {
    // --- 1. Sign up as Audience: role, category and registration in one step.
    await page.goto(`/c/${FIXTURE.conferenceSlug}/signup`)
    await page.getByRole('button', { name: /^Audience/ }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByLabel(new RegExp(categoryName)).check()
    await page.locator('#su-full_name').fill('Asha Audience')
    await page.locator('#su-email').fill(email)
    await page.locator('#su-phone').fill('9800000000')
    await page.locator('#su-password').fill(FIXTURE.password)
    await page.locator('#su-confirm_password').fill(FIXTURE.password)
    await page.getByLabel('I agree to the terms of use and privacy policy.').check()
    await page.getByRole('button', { name: 'Create account and register' }).click()

    // --- 2. The QR ticket.
    await expect(page).toHaveURL(new RegExp(`/c/${FIXTURE.conferenceSlug}/ticket`))
    const ticket = page.getByRole('article', { name: 'Your ticket' })
    await expect(ticket).toBeVisible()
    await expect(ticket.getByRole('img', { name: /Check-in QR code for ticket E2ECONF-R\d+/ })).toBeVisible()
    await expectNoSideScroll(page, 'ticket')

    // --- 3. Programme: star the live session; no private link on the page.
    await page.goto('/portal/programme')
    await expect(page.getByRole('heading', { name: sessionTitle })).toBeVisible()
    await page.getByRole('button', { name: `Add ${sessionTitle} to My agenda` }).click()
    await expect(page.getByRole('button', { name: `Remove ${sessionTitle} from My agenda` })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('body')).not.toContainText('meet.example.org')
    await expectNoSideScroll(page, 'programme')

    // --- 4. Q&A: ask in the live session.
    await page.goto('/portal/qa')
    const sessionPicker = page.getByRole('combobox', { name: 'Session' })
    const liveOption = sessionPicker.locator('option', { hasText: sessionTitle })
    await sessionPicker.selectOption((await liveOption.getAttribute('value'))!)
    await page.getByRole('textbox', { name: 'Your question' }).fill(question)
    await page.getByRole('button', { name: 'Post question' }).click()
    await expect(page.getByText(question)).toBeVisible()
    await expectNoSideScroll(page, 'Q&A')

    // --- 5. The convenor moderates live (phone view) and marks it answered.
    await convenor.setViewportSize({ width: 390, height: 844 })
    await convenor.goto(`/moderate/${conferenceId}/${sessionId}`)
    await expect(convenor.getByText(question)).toBeVisible()
    await convenor.getByRole('button', { name: 'Answered' }).first().click()
    await expect(convenor.getByText('Answered', { exact: true }).first()).toBeVisible()

    // --- 6. Join online: the private link opens only now (the session is live) and counts as attending.
    await audienceCtx.route('https://meet.example.org/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Meeting</title>' }))
    await page.goto('/portal/programme')
    const sessionCard = page.locator('li', { has: page.getByRole('heading', { name: sessionTitle }) })
    const [meeting] = await Promise.all([audienceCtx.waitForEvent('page'), sessionCard.getByRole('button', { name: 'Join online' }).click()])
    await expect.poll(() => meeting.url()).toContain('meet.example.org/e2e-audience')
    await meeting.close()
    await expect(sessionCard.getByText('Attended', { exact: true })).toBeVisible()
    await expect(sessionCard.getByText('Passcode 1234')).toBeVisible()

    // --- 7. Rate the session (it has started) and give conference feedback.
    await page.goto('/portal/feedback')
    const ratingRow = page.locator('li', { has: page.getByRole('heading', { name: sessionTitle }) })
    await ratingRow.getByRole('radiogroup', { name: `Your rating of ${sessionTitle}` }).getByRole('button', { name: '5 stars' }).click()
    await expect(ratingRow.getByText('Rated', { exact: true })).toBeVisible()
    await page.getByRole('radiogroup', { name: 'Your rating of the conference' }).getByRole('button', { name: '4 stars' }).click()
    await page.getByRole('textbox', { name: 'What did you like?' }).fill(`Great talks ${stamp}`)
    await page.getByRole('button', { name: /^(Send|Update) feedback$/ }).click()
    await expect(page.getByRole('status').filter({ hasText: /./ }).first()).toBeVisible()
    await expectNoSideScroll(page, 'feedback')

    // --- 8. Materials: the convenor shares a venue map, the Audience downloads it through the API.
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
    const upload = await convenor.request.post(`/api/conferences/${conferenceId}/materials`, {
      multipart: { title: materialTitle, file: { name: 'venue-map.pdf', mimeType: 'application/pdf', buffer: pdf } },
    })
    expect(upload.status()).toBe(201)
    materialId = (await upload.json()).id as string
    await page.goto('/portal/materials')
    await expect(page.getByRole('heading', { name: 'Materials' })).toBeVisible()
    const download = page.getByRole('link', { name: `Download ${materialTitle}` })
    await expect(download).toBeVisible()
    const file = await page.request.get((await download.getAttribute('href'))!)
    expect(file.status()).toBe(200)
    expect(file.headers()['content-type']).toContain('pdf')
    await expectNoSideScroll(page, 'materials')

    // --- 9. Certificate: plain-words progress first, then check-in + release -> ready.
    await page.goto('/portal/certificates')
    await expect(page.getByText(/not been checked in yet/)).toBeVisible()
    const registrationId = (await (await page.request.get(`/api/conferences/${conferenceId}/my-registration`)).json()).registration.id as string
    expect((await convenor.request.post(`/api/conferences/${conferenceId}/checkin/manual`, { data: { registration_id: registrationId } })).status()).toBe(200)
    expect((await convenor.request.post(`/api/conferences/${conferenceId}/certificates/generate`, { data: { certificate_type: 'participation' } })).status()).toBeLessThan(300)
    expect((await convenor.request.post(`/api/conferences/${conferenceId}/certificates/release-now`)).status()).toBe(200)
    await page.reload()
    await expect(page.getByText('Your certificate is ready to download.')).toBeVisible()
    await expectNoSideScroll(page, 'certificates')

    // --- 10. No way into the organiser pages, and the server says no too.
    await page.goto('/convenor')
    await expect(page).not.toHaveURL(/\/convenor/)
    expect((await page.request.get(`/api/conferences/${conferenceId}/registrations`)).status()).toBe(403)
    expect((await page.request.get(`/api/conferences/${conferenceId}/audience-feedback`)).status()).toBe(403)

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  } finally {
    if (materialId) await convenor.request.delete(`/api/conferences/${conferenceId}/materials/${materialId}`).catch(() => undefined)
    await convenor.request.delete(`/api/conferences/${conferenceId}/sessions/${sessionId}`).catch(() => undefined)
    await convenor.request.patch(`/api/conferences/${conferenceId}/registration-categories/${categoryId}`, { data: { code: `aud_${stamp}`.slice(0, 40), name: categoryName, is_active: false } }).catch(() => undefined)
    await audienceCtx.close()
    await convenorCtx.close()
  }
})

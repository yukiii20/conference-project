import { expect, test, type Page } from '@playwright/test'

// Mirrors server/tests/e2eSeed.ts — keep in sync if that fixture changes.
const FIXTURE = {
  conferenceSlug: 'e2e-conf',
  conferenceName: 'E2E Test Conference',
  adminEmail: 'e2e-admin@example.com',
  convenorEmail: 'e2e-convenor@example.com',
  password: 'Str0ng!Pass1',
}

// Chrome logs a network-level "Failed to load resource: ... 401" console
// error for ANY non-2xx fetch response, even one the app's own JS catches
// and handles correctly — and several pages (SuperAdminLoginPage,
// SuperAdminRoute, AuthProvider's initial load) deliberately call
// GET /api/auth/me to check "am I already signed in?" before the user has
// signed in, which legitimately 401s. That's expected, handled noise, not a
// bug — a real uncaught exception still surfaces via 'pageerror' or any
// other console.error call.
const EXPECTED_AUTH_PROBE_NOISE = /Failed to load resource.*\b401\b/

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !EXPECTED_AUTH_PROBE_NOISE.test(msg.text())) errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

async function expectNotBlank(page: Page) {
  const text = await page.locator('body').innerText()
  expect(text.trim().length).toBeGreaterThan(0)
}

async function signIn(page: Page, email: string, password: string, role: string) {
  await page.goto('/login')
  await page.locator('#si-email').fill(email)
  await page.locator('#si-password').fill(password)
  await page.locator('#si-role').selectOption(role)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test.describe('public pages', () => {
  test('home page loads with no console errors', async ({ page }) => {
    const errors = trackConsoleErrors(page)
    const res = await page.goto('/')
    expect(res?.status()).toBeLessThan(400)
    await expect(page.getByRole('link', { name: FIXTURE.conferenceName, exact: false })).toBeVisible()
    await expectNotBlank(page)
    expect(errors, `console errors on /:\n${errors.join('\n')}`).toEqual([])
  })

  test('conference detail page loads with no console errors', async ({ page }) => {
    const errors = trackConsoleErrors(page)
    const res = await page.goto(`/c/${FIXTURE.conferenceSlug}`)
    expect(res?.status()).toBeLessThan(400)
    await expect(page.getByText(FIXTURE.conferenceName, { exact: false }).first()).toBeVisible()
    await expectNotBlank(page)
    expect(errors, `console errors on /c/${FIXTURE.conferenceSlug}:\n${errors.join('\n')}`).toEqual([])
  })

  test('home page has a "See it in action" video section with a poster and captions', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'See it in action' })).toBeVisible()
    const video = page.locator('#demo video')
    await expect(video).toBeVisible()
    await expect(video).toHaveAttribute('poster', '/video/poster.jpg')
    await expect(video).toHaveAttribute('preload', 'none')
    const track = video.locator('track[kind="captions"]')
    await expect(track).toHaveAttribute('src', '/video/demo.vtt')
    // "Watch the demo" scrolls the section into view without expanding the page horizontally.
    await page.getByRole('button', { name: 'Watch the demo' }).click()
    await expect(video).toBeInViewport()
  })
})

test.describe('author sign-up -> convenor approval -> author login', () => {
  const authorEmail = `e2e-author-${Date.now()}@example.com`

  test('sign up as author', async ({ page }) => {
    const errors = trackConsoleErrors(page)
    await page.goto(`/signup?conference=${FIXTURE.conferenceSlug}`)

    await page.getByRole('button', { name: 'Author', exact: true }).click()
    await page.getByRole('button', { name: 'Continue' }).click()

    await page.locator('#su-full_name').fill('Test Author')
    await page.locator('#su-email').fill(authorEmail)
    await page.locator('#su-phone').fill('9833333333')
    await page.locator('#su-password').fill(FIXTURE.password)
    await page.locator('#su-confirm_password').fill(FIXTURE.password)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page.getByText('Account created')).toBeVisible()
    expect(errors, `console errors during sign-up:\n${errors.join('\n')}`).toEqual([])
  })

  test('login is blocked before approval', async ({ page }) => {
    await signIn(page, authorEmail, FIXTURE.password, 'author')
    await expect(page.getByRole('alert')).toContainText(/waiting for the convenor's approval/i)
  })

  test('convenor approves the author', async ({ page }) => {
    await signIn(page, FIXTURE.convenorEmail, FIXTURE.password, 'convenor')
    await expect(page).toHaveURL(/\/convenor/)

    await page.locator('nav').getByRole('link', { name: 'People' }).click()
    const row = page.locator('li', { hasText: authorEmail })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Approve' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click()
    await expect(row).toHaveCount(0)
  })

  test('author can log in after approval', async ({ page }) => {
    await signIn(page, authorEmail, FIXTURE.password, 'author')
    await expect(page).toHaveURL(/\/portal/)
  })
})

test.describe('convenor edits the conference', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, FIXTURE.convenorEmail, FIXTURE.password, 'convenor')
    await expect(page).toHaveURL(/\/convenor/)
  })

  test('edits conference details', async ({ page }) => {
    await page.locator('nav').getByRole('link', { name: 'Conference setup' }).click()
    await page.getByRole('link', { name: 'Logo and branding', exact: true }).click()
    await expect(page.getByRole('link', { name: 'Logo and branding', exact: true })).toHaveAttribute(
      'aria-current',
      'true',
    )
    await page.locator('#tagline').fill('Updated by Playwright')
    await page.getByRole('button', { name: 'Save' }).first().click()
    await expect(page.getByText('Saved.').first()).toBeVisible()
  })

  test('uploads a logo', async ({ page }) => {
    await page.locator('nav').getByRole('link', { name: 'Conference setup' }).click()
    await page.getByRole('link', { name: 'Logo and branding', exact: true }).click()
    const fileInput = page.locator('input[type="file"]').first()
    await fileInput.setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      // 1x1 transparent PNG
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    })
    await expect(page.getByText(/Logo updated\./)).toBeVisible()
  })

  test('saves key dates and they appear on the public home page', async ({ page }) => {
    await page.locator('nav').getByRole('link', { name: 'Dates and tracks' }).click()
    const row = page.locator('div.rounded-lg', { hasText: 'Abstract submission' })
    await expect(row).toBeVisible()

    const opens = row.locator('input[type="datetime-local"]').nth(0)
    const closes = row.locator('input[type="datetime-local"]').nth(1)
    const today = new Date()
    const nextYear = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate())
    const opensLocal = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}T00:00`
    const closesLocal = `${nextYear.getFullYear()}-${String(nextYear.getMonth() + 1).padStart(2, '0')}-${String(nextYear.getDate()).padStart(2, '0')}T00:00`

    await opens.fill(opensLocal)
    await closes.fill(closesLocal)
    await page.getByRole('button', { name: 'Save key dates' }).click()
    await expect(page.getByText('Saved.').first()).toBeVisible()

    await page.goto('/')
    await expect(page.getByText('Open for abstracts')).toBeVisible()
    const statValue = page.locator('dt', { hasText: 'Open for abstracts' }).locator('xpath=following-sibling::dd[1]')
    await expect(statValue).not.toHaveText('0')
  })
})

test.describe('authorization boundaries', () => {
  test('an author visiting /convenor is redirected away, not shown the page', async ({ page }) => {
    const authorEmail = `e2e-blocked-${Date.now()}@example.com`
    await page.goto(`/signup?conference=${FIXTURE.conferenceSlug}`)
    await page.getByRole('button', { name: 'Author', exact: true }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.locator('#su-full_name').fill('Blocked Author')
    await page.locator('#su-email').fill(authorEmail)
    await page.locator('#su-phone').fill('9844444444')
    await page.locator('#su-password').fill(FIXTURE.password)
    await page.locator('#su-confirm_password').fill(FIXTURE.password)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText('Account created')).toBeVisible()

    // Still pending (never approved) — login itself is blocked, and so is /convenor.
    await page.goto('/convenor')
    await expect(page).toHaveURL(/\/login/)
  })

  test('/super-admin is a 404 page for an anonymous visitor', async ({ page }) => {
    const res = await page.goto('/super-admin')
    expect(res?.status()).toBeLessThan(400) // the SPA shell itself always 200s
    await expect(page.getByText('404')).toBeVisible()
  })

  test('/super-admin is a 404 page for a signed-in non-admin', async ({ page }) => {
    await signIn(page, FIXTURE.convenorEmail, FIXTURE.password, 'convenor')
    await page.goto('/super-admin')
    await expect(page.getByText('404')).toBeVisible()
  })

  test('admin login works at /super-admin/login', async ({ page }) => {
    const errors = trackConsoleErrors(page)
    await page.goto('/super-admin/login')
    await page.locator('#sa-email').fill(FIXTURE.adminEmail)
    await page.locator('#sa-password').fill(FIXTURE.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/super-admin$/)
    expect(errors, `console errors during admin login:\n${errors.join('\n')}`).toEqual([])
  })
})

// The raw reset token is deliberately never exposed anywhere a browser can
// see it (not in the API response, not in the admin/convenor email log UI,
// which strips template_data — only the backend's own console/log in
// EMAIL_MODE=console carries it). So Playwright covers the two browser-only
// edges below; the full request -> reset -> old password fails round trip,
// token expiry/reuse and session revocation are covered end-to-end by
// server/tests/passwordReset.test.ts, which reads the token straight out of
// the database the same way a real email client would read it from an inbox.
test.describe('password reset', () => {
  test('forgot-password always shows the same generic confirmation', async ({ page }) => {
    const errors = trackConsoleErrors(page)
    await page.goto('/forgot-password')
    await page.locator('#email').fill('nobody-with-this-email@example.com')
    await page.getByRole('button', { name: 'Send reset link' }).click()
    await expect(page.getByText(/Check your email/i)).toBeVisible()
    await expect(
      page.getByText(/If an account exists for this email, we've sent a reset link\./),
    ).toBeVisible()
    expect(errors, `console errors on forgot-password:\n${errors.join('\n')}`).toEqual([])
  })

  test('reset-password with no token shows a dead-link message, not a crash', async ({ page }) => {
    const errors = trackConsoleErrors(page)
    await page.goto('/reset-password')
    await expect(page.getByText(/Link expired or invalid/i)).toBeVisible()
    await page.getByRole('link', { name: 'Request a new link' }).click()
    await expect(page).toHaveURL(/\/forgot-password$/)
    expect(errors, `console errors on reset-password with no token:\n${errors.join('\n')}`).toEqual([])
  })
})

test.describe('password visibility toggle', () => {
  test('typing, toggling to show/hide, and keeping the value works on the login password field', async ({ page }) => {
    const errors = trackConsoleErrors(page)
    await page.goto('/login')

    const passwordField = page.locator('#si-password')
    await passwordField.fill('Str0ng!Pass1')
    await expect(passwordField).toHaveAttribute('type', 'password')

    const toggle = page.getByRole('button', { name: 'Show password' })
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await toggle.click()

    await expect(passwordField).toHaveAttribute('type', 'text')
    await expect(passwordField).toHaveValue('Str0ng!Pass1')
    await expect(page.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page).toHaveURL(/\/login$/) // clicking the toggle must not submit the form

    await page.getByRole('button', { name: 'Hide password' }).click()
    await expect(passwordField).toHaveAttribute('type', 'password')
    await expect(passwordField).toHaveValue('Str0ng!Pass1')

    expect(errors, `console errors toggling the password field:\n${errors.join('\n')}`).toEqual([])
  })
})

test.describe('responsive', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('home page has no horizontal scroll at 390px width', async ({ page }) => {
    const errors = trackConsoleErrors(page)
    await page.goto('/')
    await expectNotBlank(page)
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
    expect(errors, `console errors at 390px:\n${errors.join('\n')}`).toEqual([])
  })

  test('conference detail page has no horizontal scroll at 390px width', async ({ page }) => {
    await page.goto(`/c/${FIXTURE.conferenceSlug}`)
    await expectNotBlank(page)
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
  })
})

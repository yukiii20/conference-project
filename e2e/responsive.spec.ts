import { expect, test, type Page } from '@playwright/test'

// Mirrors server/tests/e2eSeed.ts — keep in sync if that fixture changes.
const FIXTURE = {
  conferenceSlug: 'e2e-conf',
  adminEmail: 'e2e-admin@example.com',
  convenorEmail: 'e2e-convenor@example.com',
  authorEmail: 'e2e-author@example.com',
  reviewerEmail: 'e2e-reviewer@example.com',
  chairEmail: 'e2e-chair@example.com',
  staffEmail: 'e2e-staff@example.com',
  managerEmail: 'e2e-manager@example.com',
  password: 'Str0ng!Pass1',
}

// Per docs/responsive-ui-audit.md — the widths the task explicitly calls out
// for automated coverage. (320/375/390/430 mobile, 768/1024 tablet-ish, 1440 desktop.)
const WIDTHS = [320, 375, 390, 430, 768, 1024, 1440] as const

// A 1px tolerance for sub-pixel rounding — anything beyond that is a real,
// user-visible horizontal scrollbar.
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

async function signIn(page: Page, email: string, role: string) {
  await page.goto(`/c/${FIXTURE.conferenceSlug}/login`)
  await page.locator('#si-email').fill(email)
  await page.locator('#si-password').fill(FIXTURE.password)
  await page.locator('#si-role').selectOption(role)
  await Promise.all([
    page.waitForResponse((res) => res.url().includes('/api/auth/login')),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ])
}

async function signInAdmin(page: Page) {
  await page.goto('/super-admin/login')
  await page.locator('#sa-email').fill(FIXTURE.adminEmail)
  await page.locator('#sa-password').fill(FIXTURE.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/super-admin$/)
}

/**
 * Opens the mobile drawer if a closed "Menu"/"Open menu" toggle is visible
 * (desktop widths have none, and an already-open drawer's toggle also
 * matches a plain substring search for "menu" — e.g. "Close menu" — so this
 * checks `aria-expanded` rather than clicking blindly).
 */
async function openMobileNavIfPresent(page: Page) {
  // PortalPage's toggle is `md:hidden` (src/pages/PortalPage.tsx) - at >=768px
  // it never renders at all, so don't wait for it (the caller also runs this
  // at the 768/1024/1440px widths, where waiting out a real timeout for an
  // element that structurally never exists would blow the test timeout).
  const width = page.viewportSize()?.width ?? 0
  if (width >= 768) return

  const menuButton = page.getByRole('button', { name: 'menu' }).first()
  // Lazy-loaded routes (convenor/manager/portal/super-admin, see src/App.tsx)
  // show a brief Suspense fallback with no nav chrome at all before the real
  // page mounts - wait for the button rather than taking an instant snapshot,
  // same as a real visitor would just wait a moment before tapping it.
  await menuButton.waitFor({ state: 'visible', timeout: 10_000 })
  if ((await menuButton.getAttribute('aria-expanded')) === 'true') return
  await menuButton.click()
}

for (const width of WIDTHS) {
  test.describe(`responsive @ ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
    })

    test('public pages have no horizontal overflow', async ({ page }) => {
      await page.goto('/')
      await expectNoHorizontalOverflow(page, `home`)

      await page.goto(`/c/${FIXTURE.conferenceSlug}`)
      await expectNoHorizontalOverflow(page, `conference detail`)

      await page.goto(`/c/${FIXTURE.conferenceSlug}/login`)
      await expectNoHorizontalOverflow(page, `login`)

      await page.goto('/signup')
      await expectNoHorizontalOverflow(page, `signup`)

      await page.goto('/privacy')
      await expectNoHorizontalOverflow(page, `privacy`)

      await page.goto('/terms')
      await expectNoHorizontalOverflow(page, `terms`)

      // An unknown verification token — the page must still render a clean
      // "not valid" state, not a crash, and not overflow.
      await page.goto('/verify/this-token-does-not-exist')
      await expectNoHorizontalOverflow(page, `certificate verify (invalid token)`)
    })

    test('conference detail page: mobile menu (if present) does not overflow', async ({ page }) => {
      await page.goto(`/c/${FIXTURE.conferenceSlug}`)
      await openMobileNavIfPresent(page)
      await expectNoHorizontalOverflow(page, `conference detail with mobile menu open`)
    })

    test('convenor portal and every section have no horizontal overflow', async ({ page }) => {
      await signIn(page, FIXTURE.convenorEmail, 'convenor')
      await expect(page).toHaveURL(/\/convenor/)
      await expectNoHorizontalOverflow(page, `convenor dashboard`)

      await openMobileNavIfPresent(page)
      await expectNoHorizontalOverflow(page, `convenor dashboard with mobile menu open`)

      // The seven sections from docs/user-guide.md's Convenor walkthrough.
      for (const section of ['setup', 'schedule-basics', 'people', 'papers', 'event', 'communication']) {
        await page.goto(`/convenor/${section}`)
        await expectNoHorizontalOverflow(page, `convenor/${section}`)
      }
    })

    test('manager portal has no horizontal overflow', async ({ page }) => {
      await signIn(page, FIXTURE.managerEmail, 'manager')
      await expect(page).toHaveURL(/\/manager/)
      await expectNoHorizontalOverflow(page, `manager dashboard`)
      await openMobileNavIfPresent(page)
      await expectNoHorizontalOverflow(page, `manager dashboard with mobile menu open`)
    })

    test('super admin screens have no horizontal overflow', async ({ page }) => {
      await signInAdmin(page)
      await expectNoHorizontalOverflow(page, `super-admin dashboard`)
      for (const tab of ['Conferences', 'Users', 'Admins', 'Platform settings', 'Email log']) {
        await page.getByRole('tab', { name: tab, exact: true }).click()
        await expectNoHorizontalOverflow(page, `super-admin / ${tab}`)
      }
    })

    test('shared portal (author/reviewer/session chair/staff) has no horizontal overflow', async ({ page }) => {
      const roles: Array<{ email: string; role: string; section: string }> = [
        { email: FIXTURE.authorEmail, role: 'author', section: 'My submissions' },
        { email: FIXTURE.reviewerEmail, role: 'reviewer', section: 'My reviews' },
        { email: FIXTURE.chairEmail, role: 'session_chair', section: 'My sessions' },
        { email: FIXTURE.staffEmail, role: 'staff', section: 'Check-in desk' },
      ]
      for (const r of roles) {
        await signIn(page, r.email, r.role)
        await expect(page).toHaveURL(/\/portal/)
        await expectNoHorizontalOverflow(page, `${r.role} dashboard`)

        // Each NavLink click closes the mobile drawer again (PortalSidebar's
        // onNavigate), so it has to be reopened before every subsequent click.
        for (const sectionLabel of [r.section, 'My ticket', 'My certificates']) {
          await openMobileNavIfPresent(page)
          await page.locator('nav').getByRole('link', { name: sectionLabel }).click()
          await expectNoHorizontalOverflow(page, `${r.role} / ${sectionLabel}`)
        }
      }
    })
  })
}

import { expect, test, type Page } from '@playwright/test'
import { nepalInput, nepalMidnight } from './nepalTime'

// The app shell's sidebar (#portal-sidebar, #convenor-sidebar, #admin-sidebar). A bare 'nav' also matches
// the dashboard's Quick links and the breadcrumb.
const SIDEBAR = '[id$="-sidebar"]'

// Mirrors server/tests/e2eSeed.ts — keep in sync if that fixture changes.
const FIXTURE = {
  conferenceSlug: 'e2e-conf',
  convenorEmail: 'e2e-convenor@example.com',
  password: 'Str0ng!Pass1',
}

function randomLetters(length: number): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  return Array.from({ length }, () => letters[Math.floor(Math.random() * letters.length)]).join('')
}

async function signIn(page: Page, email: string, password: string, role: string) {
  await page.goto(`/c/${FIXTURE.conferenceSlug}/login`)
  await page.locator('#si-email').fill(email)
  await page.locator('#si-password').fill(password)
  await page.locator('#si-role').selectOption(role)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

async function signUp(page: Page, role: 'Author' | 'Reviewer', fullName: string, email: string, phone: string) {
  await page.goto(`/c/${FIXTURE.conferenceSlug}/signup`)
  await page.getByRole('button', { name: role, exact: true }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.locator('#su-full_name').fill(fullName)
  await page.locator('#su-email').fill(email)
  await page.locator('#su-phone').fill(phone)
  await page.locator('#su-password').fill(FIXTURE.password)
  await page.locator('#su-confirm_password').fill(FIXTURE.password)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('Account created')).toBeVisible()
}

async function approveRoleRequest(page: Page, email: string) {
  await signIn(page, FIXTURE.convenorEmail, FIXTURE.password, 'convenor')
  await expect(page).toHaveURL(/\/convenor/)
  await page.locator(SIDEBAR).getByRole('link', { name: 'People' }).click()
  const row = page.locator('li', { hasText: email })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Approve' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click()
  await expect(row).toHaveCount(0)
}

const fmtLocal = nepalInput

test('reviewer bidding -> auto-assign -> manual reminder', async ({ page }) => {
  const stamp = Date.now()
  const authorEmail = `e2e-bid-author-${stamp}@example.com`
  const reviewerEmail = `e2e-bid-reviewer-${stamp}@example.com`
  const reviewerName = `Bid Reviewer ${randomLetters(8)}`
  const trackName = `E2E Bid Track ${stamp}`
  const title = `Paper For Bidding ${stamp}`

  // 1. Sign up author and reviewer, convenor approves both.
  await signUp(page, 'Author', `Bid Author ${randomLetters(8)}`, authorEmail, '9855555551')
  await signUp(page, 'Reviewer', reviewerName, reviewerEmail, '9866666661')
  await approveRoleRequest(page, authorEmail)
  await approveRoleRequest(page, reviewerEmail)

  // 2. Convenor creates a track, opens the abstract window, and turns on
  // bidding + review reminders in Review settings.
  await signIn(page, FIXTURE.convenorEmail, FIXTURE.password, 'convenor')
  await expect(page).toHaveURL(/\/convenor/)
  await page.locator(SIDEBAR).getByRole('link', { name: 'Dates and tracks' }).click()
  await page.getByRole('link', { name: 'Tracks', exact: true }).click()
  await page.getByPlaceholder('Track name').fill(trackName)
  await page.getByRole('button', { name: 'Add track' }).click()
  await expect(page.getByText('No tracks yet.')).toHaveCount(0)

  await page.getByRole('link', { name: 'Key dates', exact: true }).click()
  const abstractRow = page.getByRole('group', { name: 'Abstract submission' })
  await abstractRow.locator('input[type="datetime-local"]').nth(0).fill(nepalMidnight(0))
  await abstractRow.locator('input[type="datetime-local"]').nth(1).fill(nepalMidnight(365))
  await page.getByRole('button', { name: 'Save key dates' }).click()
  await expect(page.getByText('Saved.').first()).toBeVisible()

  // A successful save clears the unsaved-changes flag, so leaving now must not ask
  // "Discard changes?" (it used to, because Key dates saves with a button, not a form).
  await page.locator(SIDEBAR).getByRole('link', { name: 'Papers' }).click()
  await expect(page.getByRole('dialog', { name: 'Discard changes?' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Review settings', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Enable a bidding period' }).check()
  const biddingStart = new Date(Date.now() - 60_000)
  const biddingEnd = new Date(Date.now() + 7 * 86_400_000)
  const biddingSection = page.locator('div.border-t', { hasText: 'Reviewer bidding' })
  await biddingSection.locator('input[type="datetime-local"]').nth(0).fill(fmtLocal(biddingStart))
  await biddingSection.locator('input[type="datetime-local"]').nth(1).fill(fmtLocal(biddingEnd))
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByText('Saved.').first()).toBeVisible()

  // 3. Author submits a paper.
  await signIn(page, authorEmail, FIXTURE.password, 'author')
  await expect(page).toHaveURL(/\/portal/)
  await page.locator(SIDEBAR).getByRole('link', { name: 'My submissions' }).click()
  await page.getByRole('tab', { name: 'New abstract' }).click()
  await page.locator('select').first().selectOption({ label: trackName })
  await page.locator('form').getByRole('textbox').nth(0).fill(title)
  await page.locator('form textarea').first().fill('This is the abstract body used for the bidding end to end test.')
  await page.getByPlaceholder('Add a keyword and press Enter').fill('bidding')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Create draft' }).click()
  await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Submit for review' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Submit for review' }).click()
  await expect(page.getByText('Submitted.')).toBeVisible()

  // 4. Reviewer bids "Want to review" on the paper - no author details shown.
  await signIn(page, reviewerEmail, FIXTURE.password, 'reviewer')
  await expect(page).toHaveURL(/\/portal/)
  await page.locator(SIDEBAR).getByRole('link', { name: 'My reviews' }).click()
  await page.getByRole('button', { name: 'Bid on papers' }).click()
  const paperCard = page.getByRole('group', { name: title })
  await expect(paperCard).toBeVisible()
  await paperCard.getByRole('button', { name: 'Want to review' }).click()
  await expect(page.getByText('Bid saved.')).toBeVisible()
  await expect(page.getByText('You have bid on 1 of 1 papers.')).toBeVisible()

  // 5. Convenor runs the auto-assign wizard - the reviewer's "want" bid wins.
  await signIn(page, FIXTURE.convenorEmail, FIXTURE.password, 'convenor')
  await page.locator(SIDEBAR).getByRole('link', { name: 'Papers' }).click()
  await page.getByRole('link', { name: 'Auto-assign', exact: true }).click()
  await page.getByRole('button', { name: 'Preview' }).click()
  const assignmentRow = page.locator('tr', { hasText: reviewerName }).first()
  await expect(assignmentRow).toBeVisible()
  await expect(assignmentRow.getByText(/wants to review/i)).toBeVisible()
  await page.getByRole('button', { name: /^Confirm \d+ assignment/ }).click()
  await expect(page.getByText(/assignment.*created/i)).toBeVisible()

  // 6. Convenor sends a manual reminder from the Reviewers tab.
  await page.getByRole('link', { name: 'Reviewers', exact: true }).click()
  const reviewerRow = page.locator('tr', { hasText: reviewerName })
  await expect(reviewerRow).toBeVisible()
  await reviewerRow.getByRole('button', { name: 'Send reminder now' }).click()
  await expect(page.getByText(/Reminder sent for/i)).toBeVisible()
})

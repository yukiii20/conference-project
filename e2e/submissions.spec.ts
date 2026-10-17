import { expect, test, type Page } from '@playwright/test'

// Mirrors server/tests/e2eSeed.ts — keep in sync if that fixture changes.
const FIXTURE = {
  conferenceSlug: 'e2e-conf',
  convenorEmail: 'e2e-convenor@example.com',
  password: 'Str0ng!Pass1',
}

const PDF_BUFFER = Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nendobj\n%%EOF')

// Full names only allow letters/spaces/'.'/hyphens (see src/lib/validation.ts
// nameSchema) — no digits — so a timestamp can't be used directly to make a
// name unique across runs. This substitutes for one.
function randomLetters(length: number): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  return Array.from({ length }, () => letters[Math.floor(Math.random() * letters.length)]).join('')
}

async function signIn(page: Page, email: string, password: string, role: string) {
  await page.goto('/login')
  await page.locator('#si-email').fill(email)
  await page.locator('#si-password').fill(password)
  await page.locator('#si-role').selectOption(role)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

async function signUp(page: Page, role: 'Author' | 'Reviewer', fullName: string, email: string, phone: string) {
  await page.goto(`/signup?conference=${FIXTURE.conferenceSlug}`)
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
  await page.locator('nav').getByRole('link', { name: 'People' }).click()
  const row = page.locator('li', { hasText: email })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Approve' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click()
  await expect(row).toHaveCount(0)
}

async function setDeadlineWindow(page: Page, rowLabel: string) {
  const row = page.locator('div.rounded-lg', { hasText: rowLabel })
  await expect(row).toBeVisible()
  const opens = row.locator('input[type="datetime-local"]').nth(0)
  const closes = row.locator('input[type="datetime-local"]').nth(1)
  const today = new Date()
  const nextYear = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate())
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T00:00`
  await opens.fill(fmt(today))
  await closes.fill(fmt(nextYear))
}

test('author submits -> convenor assigns reviewer -> reviewer reviews -> convenor accepts -> author uploads full paper', async ({
  page,
}) => {
  const stamp = Date.now()
  const authorEmail = `e2e-sub-author-${stamp}@example.com`
  const reviewerEmail = `e2e-sub-reviewer-${stamp}@example.com`
  const reviewerName = `Test Reviewer ${randomLetters(8)}`
  const trackName = `E2E Track ${stamp}`
  const title = `An End To End Submission ${stamp}`

  // 1. Sign up author and reviewer, convenor approves both. Names are unique
  // per run — this conference accumulates leftover accounts from earlier
  // runs, and a non-unique "Test Reviewer" label would match the wrong one
  // in the assign-reviewer dropdown below.
  await signUp(page, 'Author', `Test Author ${randomLetters(8)}`, authorEmail, '9855555555')
  await signUp(page, 'Reviewer', reviewerName, reviewerEmail, '9866666666')
  await approveRoleRequest(page, authorEmail)
  await approveRoleRequest(page, reviewerEmail)

  // 2. Convenor creates a track and opens the abstract + full paper windows.
  await signIn(page, FIXTURE.convenorEmail, FIXTURE.password, 'convenor')
  await expect(page).toHaveURL(/\/convenor/)
  await page.locator('nav').getByRole('link', { name: 'Dates and tracks' }).click()
  await page.getByRole('link', { name: 'Tracks', exact: true }).click()
  await page.getByPlaceholder('Track name').fill(trackName)
  await page.getByRole('button', { name: 'Add track' }).click()
  await expect(page.getByText('No tracks yet.')).toHaveCount(0)

  await page.getByRole('link', { name: 'Key dates', exact: true }).click()
  await setDeadlineWindow(page, 'Abstract submission')
  await setDeadlineWindow(page, 'Full paper submission')
  await page.getByRole('button', { name: 'Save key dates' }).click()
  await expect(page.getByText('Saved.').first()).toBeVisible()

  // 3. Author creates a draft and submits it.
  await signIn(page, authorEmail, FIXTURE.password, 'author')
  await expect(page).toHaveURL(/\/portal/)
  await page.locator('nav').getByRole('link', { name: 'My submissions' }).click()
  await page.getByRole('button', { name: 'New abstract' }).click()
  await page.locator('select').first().selectOption({ label: trackName })
  await page.locator('form').getByRole('textbox').nth(0).fill(title)
  await page.locator('form textarea').first().fill('This is the abstract body for the end to end test submission.')
  await page.getByPlaceholder('Add a keyword and press Enter').fill('e2e')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Create draft' }).click()
  await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Submit for review' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Submit for review' }).click()
  await expect(page.getByText('Submitted.')).toBeVisible()

  // 4. Convenor assigns the reviewer.
  await signIn(page, FIXTURE.convenorEmail, FIXTURE.password, 'convenor')
  await page.locator('nav').getByRole('link', { name: 'Papers' }).click()
  await page.getByText(title).click()
  const assignBox = page.locator('form', { has: page.getByRole('button', { name: 'Assign reviewer' }) })
  await assignBox.locator('select').selectOption({ label: reviewerName })
  await assignBox.getByRole('button', { name: 'Assign reviewer' }).click()
  await expect(page.getByText('Reviewer assigned.')).toBeVisible()

  // 5. Reviewer accepts the assignment and submits a review.
  await signIn(page, reviewerEmail, FIXTURE.password, 'reviewer')
  await expect(page).toHaveURL(/\/portal/)
  await page.locator('nav').getByRole('link', { name: 'My reviews' }).click()
  await page.getByRole('button', { name: 'Accept' }).click()
  await page.getByRole('button', { name: 'Write review' }).click()
  await page.locator('textarea').first().fill('Solid work overall, recommend accepting with minor edits.')
  await page.getByRole('button', { name: 'Submit review', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Submit review', exact: true }).click()
  await expect(page.getByText('submitted and can no longer be edited')).toBeVisible()

  // 6. Convenor accepts the abstract.
  await signIn(page, FIXTURE.convenorEmail, FIXTURE.password, 'convenor')
  await page.locator('nav').getByRole('link', { name: 'Papers' }).click()
  await page.getByText(title).click()
  const decisionBox = page.locator('form', { has: page.getByRole('button', { name: 'Save decision' }) })
  await decisionBox.locator('textarea').fill('Nice abstract — accepted.')
  await decisionBox.getByRole('button', { name: 'Save decision' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Save decision' }).click()
  await expect(page.getByText('Decision saved.')).toBeVisible()

  // 7. Author uploads the full paper now that the submission is accepted.
  await signIn(page, authorEmail, FIXTURE.password, 'author')
  await expect(page).toHaveURL(/\/portal/)
  await page.locator('nav').getByRole('link', { name: 'My submissions' }).click()
  await page.getByText(title).click()
  // File input order on the page: abstract (0), full paper (1), slides (2).
  await page.locator('input[type="file"]').nth(1).setInputFiles({
    name: 'paper.pdf',
    mimeType: 'application/pdf',
    buffer: PDF_BUFFER,
  })
  await expect(page.getByText('Full paper').first()).toBeVisible()
  await expect(page.getByText('paper.pdf')).toBeVisible()
})

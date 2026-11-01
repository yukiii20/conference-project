import { expect, type Page } from '@playwright/test'

/**
 * Registers the signed-in person in the seeded "General — free" category, or keeps the ticket
 * they already have. Several specs register the same seeded author and none of them cancel it,
 * so whichever runs second must reuse the existing ticket rather than look for the picker.
 */
export async function registerOrReuseTicket(page: Page): Promise<void> {
  const picker = page.getByRole('combobox', { name: 'Registration category' })
  const ticket = page.getByText(/^E2ECONF-R\d+$/).first()
  await expect(picker.or(ticket)).toBeVisible()
  if (await picker.isVisible()) {
    await picker.selectOption({ label: 'General — free' })
    await page.getByRole('button', { name: 'Register to attend' }).click()
  }
  await expect(ticket).toBeVisible()
}

import { sendDueReminders } from '../modules/reviews/reminders.js'

const CHECK_MS = 60 * 60_000 // once an hour, per the spec

let timer: ReturnType<typeof setInterval> | null = null

/**
 * Also runs once immediately on start (not just on the interval) so a
 * Render free-plan wake-from-sleep catches up right away instead of waiting
 * up to an hour - reminders can still arrive late on that plan, but never
 * later than the next request wakes the server.
 */
export function startReviewReminderJob(): void {
  if (timer) return
  sendDueReminders().catch((err) => console.error('Scheduled review reminder check failed:', err))
  timer = setInterval(() => {
    sendDueReminders().catch((err) => console.error('Scheduled review reminder check failed:', err))
  }, CHECK_MS)
}

export function stopReviewReminderJob(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

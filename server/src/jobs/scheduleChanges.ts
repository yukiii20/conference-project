import { sendScheduleChangeEmails } from '../modules/audience/scheduleChanges.js'

// Checks every 5 minutes; a change waits at least 15 minutes (SCHEDULE_EMAIL_BATCH_MINUTES) so
// several edits in a row reach each Audience member as one email.
const CHECK_MS = 5 * 60_000

let timer: ReturnType<typeof setInterval> | null = null

export function startScheduleChangeEmailJob(): void {
  if (timer) return
  const run = () => sendScheduleChangeEmails().catch((err) => console.error('Schedule-change email batch failed:', err))
  run()
  timer = setInterval(run, CHECK_MS)
}

export function stopScheduleChangeEmailJob(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

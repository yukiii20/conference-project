import { publishDueAnnouncements } from '../modules/announcements/service.js'

const CHECK_MS = 60_000

let timer: ReturnType<typeof setInterval> | null = null

export function startAnnouncementPublishJob(): void {
  if (timer) return
  publishDueAnnouncements().catch((err) => console.error('Scheduled announcement publish failed:', err))
  timer = setInterval(() => {
    publishDueAnnouncements().catch((err) => console.error('Scheduled announcement publish failed:', err))
  }, CHECK_MS)
}

export function stopAnnouncementPublishJob(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

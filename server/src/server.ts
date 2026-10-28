import { createApp } from './app.js'
import { env } from './config/env.js'
import { startEmailWorker } from './email/worker.js'
import { startAnnouncementPublishJob } from './jobs/announcements.js'
import { startSessionCleanupJob } from './jobs/cleanup.js'
import { startReviewReminderJob } from './jobs/reviewReminders.js'
import { ensureStorageDirs } from './storage/paths.js'

process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e))
process.on('uncaughtException', (e) => console.error('uncaughtException:', e))

const app = createApp()

function safeStart(name: string, fn: () => void) {
  try {
    fn()
    console.log(`${name} started`)
  } catch (err) {
    console.error(`${name} failed to start:`, err)
  }
}

ensureStorageDirs()
  .then(() => {
    app.listen(env.PORT, '0.0.0.0', () => {
      console.log(`CMS backend listening on port ${env.PORT}`)
      safeStart('email worker', startEmailWorker)
      safeStart('session cleanup job', startSessionCleanupJob)
      safeStart('announcement job', startAnnouncementPublishJob)
      safeStart('review reminder job', startReviewReminderJob)
    })
  })
  .catch((err) => {
    console.error('Could not prepare the storage directories:', err)
    process.exit(1)
  })
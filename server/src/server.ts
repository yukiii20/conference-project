import { createApp } from './app.js'
import { env } from './config/env.js'
import { startEmailWorker } from './email/worker.js'
import { startAnnouncementPublishJob } from './jobs/announcements.js'
import { startSessionCleanupJob } from './jobs/cleanup.js'
import { startReviewReminderJob } from './jobs/reviewReminders.js'
import { ensureStorageDirs } from './storage/paths.js'

const app = createApp()

ensureStorageDirs()
  .then(() => {
    app.listen(env.PORT, () => {
      console.log(`CMS backend listening on http://localhost:${env.PORT}`)
      startEmailWorker()
      startSessionCleanupJob()
      startAnnouncementPublishJob()
      startReviewReminderJob()
    })
  })
  .catch((err) => {
    console.error('Could not prepare the storage directories:', err)
    process.exit(1)
  })

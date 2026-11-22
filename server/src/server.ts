import type { Server } from 'node:http'
import { createApp } from './app.js'
import { env } from './config/env.js'
import { pool } from './db/pool.js'
import { startEmailWorker } from './email/worker.js'
import { startAnnouncementPublishJob } from './jobs/announcements.js'
import { startSessionCleanupJob } from './jobs/cleanup.js'
import { startReviewReminderJob } from './jobs/reviewReminders.js'
import { startScheduleChangeEmailJob } from './jobs/scheduleChanges.js'
import { ensureStorageDirs } from './storage/paths.js'

process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e))

const app = createApp()
let httpServer: Server | null = null
let shuttingDown = false

/**
 * Stops taking new requests, lets the ones in flight finish, closes the database pool and
 * exits. Render sends SIGTERM on every deploy; without this, requests were cut off mid-way.
 */
function shutdown(reason: string, exitCode: number) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`Shutting down (${reason})...`)
  // Never hang a deploy: force the exit if something keeps the process alive.
  setTimeout(() => process.exit(exitCode), 10_000).unref()
  const closeDb = () =>
    pool
      .end()
      .catch((err) => console.error('Could not close the database pool:', err))
      .finally(() => process.exit(exitCode))
  if (httpServer) httpServer.close(() => void closeDb())
  else void closeDb()
}

process.on('SIGTERM', () => shutdown('SIGTERM', 0))
process.on('SIGINT', () => shutdown('SIGINT', 0))
// After an uncaught exception the process state is unknown: log it and restart cleanly
// (Render and `tsx watch` start the process again) instead of carrying on half-broken.
process.on('uncaughtException', (e) => {
  console.error('uncaughtException:', e)
  shutdown('uncaught exception', 1)
})

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
    httpServer = app.listen(env.PORT, '0.0.0.0', () => {
      console.log(`CMS backend listening on port ${env.PORT}`)
      safeStart('email worker', startEmailWorker)
      safeStart('session cleanup job', startSessionCleanupJob)
      safeStart('announcement job', startAnnouncementPublishJob)
      safeStart('review reminder job', startReviewReminderJob)
      safeStart('schedule-change email job', startScheduleChangeEmailJob)
    })
  })
  .catch((err) => {
    console.error('Could not prepare the storage directories:', err)
    process.exit(1)
  })
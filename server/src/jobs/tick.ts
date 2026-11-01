import { timingSafeEqual } from 'node:crypto'
import { Router } from 'express'
import { env } from '../config/env.js'
import { recoverStuckSendingRows, runEmailWorkerOnce } from '../email/worker.js'
import { publishDueAnnouncements } from '../modules/announcements/service.js'
import { sendDueReminders } from '../modules/reviews/reminders.js'
import { runSessionCleanup } from './cleanup.js'

/**
 * One pass of every background job. The in-process timers (server.ts) do this all day on an
 * always-on server, but Render's free plan sleeps after ~15 idle minutes and the timers stop with
 * it. An external scheduler (.github/workflows/tick.yml (template: deploy/github-tick-workflow.yml)) calling POST /api/internal/tick every
 * 10 minutes both keeps the server awake and catches up anything that was missed.
 *
 * Every job is safe to run twice at once (rows are claimed atomically / INSERT IGNORE /
 * SELECT ... FOR UPDATE), so overlapping with the timers is harmless.
 */
export type TickJob = { name: string; run: () => Promise<unknown> }

export const DEFAULT_TICK_JOBS: TickJob[] = [
  { name: 'email_recover', run: recoverStuckSendingRows },
  { name: 'email', run: runEmailWorkerOnce },
  { name: 'announcements', run: publishDueAnnouncements },
  { name: 'review_reminders', run: sendDueReminders },
  { name: 'session_cleanup', run: runSessionCleanup },
]

/** Runs each job in turn; one failing never stops the others. */
export async function runTick(jobs: TickJob[] = DEFAULT_TICK_JOBS): Promise<Record<string, 'ok' | 'failed'>> {
  const result: Record<string, 'ok' | 'failed'> = {}
  for (const job of jobs) {
    try {
      await job.run()
      result[job.name] = 'ok'
    } catch (err) {
      console.error(`Tick: ${job.name} failed:`, err)
      result[job.name] = 'failed'
    }
  }
  return result
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** POST /api/internal/tick with "Authorization: Bearer <CRON_SECRET>". 404 while CRON_SECRET is unset. */
export function createTickRouter(options: { secret?: () => string | undefined; jobs?: TickJob[] } = {}) {
  const secretOf = options.secret ?? (() => env.CRON_SECRET)
  const router = Router()
  let running = false

  router.post('/tick', async (req, res, next) => {
    try {
      const secret = secretOf()
      if (!secret) {
        res.status(404).json({ message: 'Not found.' })
        return
      }
      const given = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? ''
      if (!sameSecret(given, secret)) {
        res.status(401).json({ message: 'Invalid token.' })
        return
      }
      if (running) {
        res.status(202).json({ message: 'A tick is already running.' })
        return
      }
      running = true
      try {
        res.json({ jobs: await runTick(options.jobs) })
      } finally {
        running = false
      }
    } catch (err) {
      next(err)
    }
  })

  return router
}

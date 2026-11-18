import type { NextFunction, Request, Response } from 'express'
import { pool } from '../db/pool.js'
import { assertConferenceNotEnded } from '../utils/conferenceEnded.js'

/**
 * Refuses a participant action once the conference has ended (409, code 'conference_ended').
 * Put it AFTER the auth middleware (so signed-out callers still get 401) and BEFORE any upload
 * parser (so no file is read for a refused request). When the conference can't be resolved the
 * request continues and the route's own 404 handling applies.
 */
function refuseWhenEnded(resolveConferenceId: (req: Request) => Promise<string | null>) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const conferenceId = await resolveConferenceId(req)
      if (conferenceId) await assertConferenceNotEnded(pool, conferenceId)
      next()
    } catch (err) {
      next(err)
    }
  }
}

async function single(sql: string, param: string | undefined): Promise<string | null> {
  if (!param) return null
  const [rows] = await pool.query(sql, [param])
  return (rows as Array<{ conference_id: string }>)[0]?.conference_id ?? null
}

/** Conference id in the path (`/:id/...`). */
export const refuseWhenConferenceEnded = refuseWhenEnded(async (req) => req.params.id ?? null)

/** Submission id in the path (`/:sid/...`, also the reviewer bid route). */
export const refuseWhenSubmissionConferenceEnded = refuseWhenEnded((req) =>
  single('SELECT conference_id FROM submissions WHERE id = ? LIMIT 1', req.params.sid),
)

/** Review assignment id in the path (`/assignments/:aid/...`). */
export const refuseWhenAssignmentConferenceEnded = refuseWhenEnded((req) =>
  single('SELECT conference_id FROM review_assignments WHERE id = ? LIMIT 1', req.params.aid),
)

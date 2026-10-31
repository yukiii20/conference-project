import { AsyncLocalStorage } from 'node:async_hooks'
import type { Request } from 'express'
import { ForbiddenError } from '../utils/errors.js'

/**
 * Per-request record of which conference the caller's session is bound to.
 *
 * requireAuth (middleware/auth.ts) opens this scope once the session is
 * resolved, and everything that runs for the rest of that request — route
 * handlers, services, permission checks — can read it without the value
 * having to be threaded through every function signature. That is what
 * makes the per-conference rule enforceable in ONE place: the permission
 * helpers and the shared entity loaders (submissions, review assignments,
 * ...) all consult it.
 *
 * conferenceId === null means "not bound": a platform admin session
 * (super-admin login), or code running outside any HTTP request (background
 * jobs, tests calling a service directly). Unbound callers keep the
 * behaviour they had before sessions were scoped.
 */
type SessionScope = {
  userId: string
  conferenceId: string | null
}

const storage = new AsyncLocalStorage<SessionScope>()

export const WRONG_CONFERENCE_MESSAGE =
  'You are signed in to a different conference. Sign in at this conference to continue.'
export const WRONG_CONFERENCE_CODE = 'wrong_conference'

export function runInSessionScope<T>(scope: SessionScope, fn: () => T): T {
  return storage.run(scope, fn)
}

/** The conference the current request's session is bound to, or null when unbound (admin session / no request). */
export function getSessionConferenceId(): string | null {
  return storage.getStore()?.conferenceId ?? null
}

export function wrongConferenceError(): ForbiddenError {
  const err = new ForbiddenError(WRONG_CONFERENCE_MESSAGE)
  err.code = WRONG_CONFERENCE_CODE
  return err
}

/**
 * Throws 403 when the current session is bound to a conference and
 * `conferenceId` is any other one. A no-op for unbound callers.
 */
export function assertConferenceInSession(conferenceId: string | null | undefined): void {
  const bound = getSessionConferenceId()
  if (!bound) return
  if (!conferenceId || conferenceId !== bound) {
    throw wrongConferenceError()
  }
}

/**
 * For list endpoints that accept an optional conference filter: a bound
 * session always gets its own conference (asking for another one is a 403);
 * an unbound caller gets whatever it asked for.
 */
export function effectiveConferenceFilter(requested?: string | null): string | undefined {
  const bound = getSessionConferenceId()
  if (!bound) return requested ?? undefined
  if (requested && requested !== bound) throw wrongConferenceError()
  return bound
}

/**
 * For "across all my conferences" lists (chair sessions, certificates,
 * agenda conferences, feedback surveys): a bound session keeps only rows of
 * its own conference. Unbound callers get the list unchanged.
 */
export function keepBoundConferenceRows<T>(rows: T[], conferenceIdOf: (row: T) => string | null | undefined): T[] {
  const bound = getSessionConferenceId()
  if (!bound) return rows
  return rows.filter((row) => conferenceIdOf(row) === bound)
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The conference id named in the URL of a `/api/conferences/:id/...` request
 * (every conference-scoped router is mounted there, plus agenda's
 * `/api/conferences/:id/my-agenda...`). Only UUIDs count: the public
 * `/api/conferences/:slug` and `/api/conferences/public...` routes never
 * require auth, so they never reach the guard anyway.
 */
export function conferenceIdFromPath(req: Request): string | null {
  const path = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? ''
  const match = /^\/api\/conferences\/([^/]+)/.exec(path)
  const candidate = match?.[1]
  if (!candidate || !UUID_PATTERN.test(candidate)) return null
  return candidate.toLowerCase()
}

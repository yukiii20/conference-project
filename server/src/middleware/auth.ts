import type { NextFunction, Request, Response } from 'express'
import { pool } from '../db/pool.js'
import { resolveSessionUser } from '../modules/auth/session.js'
import { getConferencePermissions, isPlatformAdmin } from '../modules/auth/service.js'
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js'
import {
  assertConferenceInSession,
  conferenceIdFromPath,
  getSessionConferenceId,
  runInSessionScope,
  wrongConferenceError,
} from './sessionScope.js'

/**
 * Resolves the session and opens the per-request session scope (see
 * sessionScope.ts). For a session bound to a conference, any request to
 * `/api/conferences/<another conference id>/...` is refused right here with
 * 403 — that single check covers every conference-scoped router, whatever
 * guard (or none) the individual route adds after this.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await resolveSessionUser(req)
    if (!user) {
      next(new UnauthorizedError('You must be signed in.'))
      return
    }
    req.user = user

    if (user.conferenceId) {
      const pathConferenceId = conferenceIdFromPath(req)
      if (pathConferenceId && pathConferenceId !== user.conferenceId) {
        next(wrongConferenceError())
        return
      }
    }

    runInSessionScope({ userId: user.id, conferenceId: user.conferenceId }, () => next())
  } catch (err) {
    next(err)
  }
}

/**
 * Platform-admin powers only ever come from an admin session (the
 * /super-admin/login sign-in, never bound to a conference). An admin account
 * that signed in at a conference's own page is treated like any other member
 * of that conference.
 */
async function hasAdminPowers(userId: string): Promise<boolean> {
  if (getSessionConferenceId()) return false
  return isPlatformAdmin(userId)
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  requireAuth(req, _res, async (err?: unknown) => {
    if (err) {
      next(err)
      return
    }
    try {
      const admin = await hasAdminPowers(req.user!.id)
      if (!admin) {
        next(new ForbiddenError('Administrator access required.'))
        return
      }
      next()
    } catch (e) {
      next(e)
    }
  })
}

/**
 * Factory: checks the caller holds `permission` in the conference identified
 * by `getConferenceId(req)` (default: req.params.id). Platform admins always
 * pass. For routes where the conference isn't known until the entity is
 * loaded (e.g. approving a role request by its own id), don't use this
 * middleware — call assertConferencePermission from the route handler once
 * the entity's conference_id is known.
 */
export function requireConferencePermission(
  permission: string,
  getConferenceId: (req: Request) => string | undefined = (req) => req.params.id,
) {
  // Named (not an arrow function) so a route-guard audit can recognise it by
  // name in a route's middleware stack — see tests/routeGuards.test.ts.
  return function conferencePermissionGuard(req: Request, _res: Response, next: NextFunction): void {
    requireAuth(req, _res, async (err?: unknown) => {
      if (err) {
        next(err)
        return
      }
      const conferenceId = getConferenceId(req)
      if (!conferenceId) {
        next(new ForbiddenError('Could not determine which conference this applies to.'))
        return
      }
      try {
        await assertConferencePermission(req.user!.id, conferenceId, permission)
        next()
      } catch (e) {
        next(e)
      }
    })
  }
}

/**
 * The one permission check every route and service uses. Refuses (403) any
 * conference other than the one the current session is bound to, before
 * looking at roles at all — so a membership elsewhere can never be used here.
 */
export async function assertConferencePermission(
  userId: string,
  conferenceId: string,
  permission: string,
): Promise<void> {
  assertConferenceInSession(conferenceId)
  if (await hasAdminPowers(userId)) return
  const permissions = await getConferencePermissions(userId, conferenceId)
  if (!permissions.has(permission)) {
    throw new ForbiddenError('You do not have permission to do this.')
  }
}

export function requireConferenceRole(
  roleCodes: string[],
  getConferenceId: (req: Request) => string | undefined = (req) => req.params.id,
) {
  // Named for the same reason as conferencePermissionGuard above.
  return function conferenceRoleGuard(req: Request, _res: Response, next: NextFunction): void {
    requireAuth(req, _res, async (err?: unknown) => {
      if (err) {
        next(err)
        return
      }
      const conferenceId = getConferenceId(req)
      if (!conferenceId) {
        next(new ForbiddenError('Could not determine which conference this applies to.'))
        return
      }
      try {
        assertConferenceInSession(conferenceId)
        if (await hasAdminPowers(req.user!.id)) {
          next()
          return
        }
        const [rows] = await pool.query(
          `SELECT 1 FROM conference_members WHERE user_id = ? AND conference_id = ? AND status = 'active' AND role_code IN (?)`,
          [req.user!.id, conferenceId, roleCodes],
        )
        if ((rows as unknown[]).length === 0) {
          next(new ForbiddenError('You do not have permission to do this.'))
          return
        }
        next()
      } catch (e) {
        next(e)
      }
    })
  }
}

import type { NextFunction, Request, Response } from 'express'
import { pool } from '../db/pool.js'
import { resolveSessionUser } from '../modules/auth/session.js'
import { getConferencePermissions, isPlatformAdmin } from '../modules/auth/service.js'
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js'

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await resolveSessionUser(req)
    if (!user) {
      next(new UnauthorizedError('You must be signed in.'))
      return
    }
    req.user = user
    next()
  } catch (err) {
    next(err)
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  requireAuth(req, _res, async (err?: unknown) => {
    if (err) {
      next(err)
      return
    }
    try {
      const admin = await isPlatformAdmin(req.user!.id)
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
  return (req: Request, _res: Response, next: NextFunction): void => {
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

export async function assertConferencePermission(
  userId: string,
  conferenceId: string,
  permission: string,
): Promise<void> {
  if (await isPlatformAdmin(userId)) return
  const permissions = await getConferencePermissions(userId, conferenceId)
  if (!permissions.has(permission)) {
    throw new ForbiddenError('You do not have permission to do this.')
  }
}

export function requireConferenceRole(
  roleCodes: string[],
  getConferenceId: (req: Request) => string | undefined = (req) => req.params.id,
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
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
        if (await isPlatformAdmin(req.user!.id)) {
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

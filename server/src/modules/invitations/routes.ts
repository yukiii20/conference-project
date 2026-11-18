import { Router } from 'express'
import { z } from 'zod'
import { withTransaction } from '../../db/withTransaction.js'
import { authRateLimit } from '../../middleware/rateLimit.js'
import { validateBody } from '../../middleware/validate.js'
import { auditContextFrom } from '../../utils/audit.js'
import { getMyRoles, getUserProfile } from '../auth/service.js'
import { createSession, resolveSessionUser } from '../auth/session.js'
import { acceptInvitationByToken, declineInvitationByToken, getInvitationByToken } from './service.js'

/**
 * Public invitation endpoints (no sign-in needed: the link's token is the proof). Mounted at
 * /api/invitations. Rate-limited like sign-in, since accepting can check a password.
 */
export const invitationsPublicRouter = Router()

// Any non-empty password here: an existing account signs in with whatever its password is. A
// brand-new account's chosen password is checked against the strength rules in the service.
const acceptSchema = z.object({ password: z.string().min(1).max(200).optional() })

invitationsPublicRouter.get('/:token', authRateLimit, async (req, res, next) => {
  try {
    res.json({ invitation: await getInvitationByToken(req.params.token!) })
  } catch (err) {
    next(err)
  }
})

invitationsPublicRouter.post('/:token/accept', authRateLimit, validateBody(acceptSchema), async (req, res, next) => {
  try {
    const session = await resolveSessionUser(req)
    const { userId, conference } = await acceptInvitationByToken(
      req.params.token!,
      { password: req.body.password, sessionUserId: session && !session.isAdminSession ? session.id : null },
      auditContextFrom(req),
    )
    // Signed in at the conference the invitation was for (a session is bound to one conference).
    await withTransaction(userId, async (conn) => {
      await createSession(conn, res, {
        userId,
        rememberMe: true,
        isAdminSession: false,
        conferenceId: conference.id,
        userAgent: req.get('user-agent') ?? null,
        ipAddress: req.ip ?? null,
      })
    })
    const [roles, profile] = await Promise.all([getMyRoles(userId, conference.id), getUserProfile(userId)])
    res.json({
      user: profile,
      roles,
      conference: { id: conference.id, slug: conference.slug, name: conference.name, logo_path: conference.logo_path, primary_color: conference.primary_color },
      signed_in: true,
    })
  } catch (err) {
    next(err)
  }
})

invitationsPublicRouter.post('/:token/decline', authRateLimit, async (req, res, next) => {
  try {
    res.json(await declineInvitationByToken(req.params.token!, auditContextFrom(req)))
  } catch (err) {
    next(err)
  }
})

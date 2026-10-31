import { Router, type Request } from 'express'
import { withTransaction } from '../../db/withTransaction.js'
import { pool } from '../../db/pool.js'
import { requireAuth } from '../../middleware/auth.js'
import { authRateLimit, forgotPasswordEmailLimit, forgotPasswordIpLimit } from '../../middleware/rateLimit.js'
import { validateBody } from '../../middleware/validate.js'
import { ForbiddenError } from '../../utils/errors.js'
import {
  acceptInvitationSchema,
  adminLoginSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  joinConferenceSchema,
  loginSchema,
  registerSchema,
  requestRoleSchema,
  resetPasswordSchema,
  switchConferenceSchema,
  updateProfileSchema,
} from './validation.js'
import {
  acceptInvitation,
  assertCanSwitchTo,
  changePassword,
  findConference,
  getMyRoles,
  getUserProfile,
  invitationSessionConference,
  isPlatformAdmin,
  joinConferenceWithExistingAccount,
  listMyConferences,
  registerUser,
  requestPasswordReset,
  requestRoleAsSignedInUser,
  resetPassword,
  updateProfile,
  verifyAdminLogin,
  verifyLogin,
  type ConferenceRef,
} from './service.js'
import { clearSessionCookie, createSession, getSessionToken, resolveSessionUser, revokeSession } from './session.js'
import { auditContextFrom, insertAuditLog } from '../../utils/audit.js'

export const authRouter = Router()

/** The public face of the conference a session is bound to — what the portal header, switcher and sign-out need. */
function sessionConferenceDto(conference: ConferenceRef | null) {
  if (!conference) return null
  return {
    id: conference.id,
    slug: conference.slug,
    name: conference.name,
    logo_path: conference.logo_path,
    primary_color: conference.primary_color,
  }
}

function sessionMeta(req: Request) {
  return { userAgent: req.get('user-agent') ?? null, ipAddress: req.ip ?? null }
}

authRouter.post('/register', authRateLimit, validateBody(registerSchema), async (req, res, next) => {
  try {
    await registerUser(req.body, auditContextFrom(req))
    res.status(201).json({
      message: "Account created. The conference's convenor must approve it before you can sign in.",
    })
  } catch (err) {
    next(err)
  }
})

/**
 * Sign-up with an email that already has an account: proven with that
 * account's current password, it only creates a pending role request at this
 * one conference — never a new user, never a change to name/phone/password.
 */
authRouter.post('/join-conference', authRateLimit, validateBody(joinConferenceSchema), async (req, res, next) => {
  try {
    const { conference } = await joinConferenceWithExistingAccount(req.body, auditContextFrom(req))
    res.status(201).json({
      message: `Request sent. You can sign in at ${conference.name} once the convenor approves it.`,
      conference: sessionConferenceDto(conference),
    })
  } catch (err) {
    next(err)
  }
})

authRouter.post('/login', authRateLimit, validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password, role, remember_me: rememberMe, conference: conferenceRef } = req.body
    const { userId, conference } = await verifyLogin(email, password, role, conferenceRef, auditContextFrom(req))

    await withTransaction(userId, async (conn) => {
      await createSession(conn, res, {
        userId,
        rememberMe,
        isAdminSession: false,
        conferenceId: conference.id,
        ...sessionMeta(req),
      })
    })

    const [roles, profile] = await Promise.all([getMyRoles(userId, conference.id), getUserProfile(userId)])
    res.json({ user: profile, roles, conference: sessionConferenceDto(conference) })
  } catch (err) {
    next(err)
  }
})

authRouter.post('/admin-login', authRateLimit, validateBody(adminLoginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body
    const { userId } = await verifyAdminLogin(email, password)

    await withTransaction(userId, async (conn) => {
      await createSession(conn, res, {
        userId,
        rememberMe: false,
        isAdminSession: true,
        conferenceId: null,
        ...sessionMeta(req),
      })
    })

    const [roles, profile] = await Promise.all([getMyRoles(userId, null), getUserProfile(userId)])
    res.json({ user: profile, roles, conference: null })
  } catch (err) {
    next(err)
  }
})

authRouter.post('/logout', async (req, res, next) => {
  try {
    let conferenceSlug: string | null = null
    if (getSessionToken(req)) {
      const user = await resolveSessionUser(req)
      if (user) {
        if (user.conferenceId) {
          conferenceSlug = (await findConference(user.conferenceId, { publishedOnly: false }))?.slug ?? null
        }
        await revokeSession(user.sessionId)
      }
    }
    clearSessionCookie(res)
    // The frontend returns the person to this conference's page after signing out.
    res.json({ message: 'Signed out.', conference_slug: conferenceSlug })
  } catch (err) {
    next(err)
  }
})

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id
    const boundConferenceId = req.user!.conferenceId
    const [profile, roles, isAdmin, conference] = await Promise.all([
      getUserProfile(userId),
      getMyRoles(userId, boundConferenceId),
      // false inside a conference-bound session (see isPlatformAdmin)
      isPlatformAdmin(userId),
      boundConferenceId ? findConference(boundConferenceId, { publishedOnly: false }) : Promise.resolve(null),
    ])
    res.json({ user: profile, roles, isAdmin, conference: sessionConferenceDto(conference) })
  } catch (err) {
    next(err)
  }
})

/**
 * The "My conferences" switcher list: conferences where the signed-in person
 * has an active role (openable) or only a pending request ("Waiting for
 * approval"). Deliberately lists the caller's OWN memberships across
 * conferences — nothing of any conference's data beyond its name and logo.
 */
authRouter.get('/my-conferences', requireAuth, async (req, res, next) => {
  try {
    const conferences = await listMyConferences(req.user!.id)
    res.json({
      current_conference_id: req.user!.conferenceId,
      conferences: conferences.map((c) => ({ ...c, is_current: c.conference_id === req.user!.conferenceId })),
    })
  } catch (err) {
    next(err)
  }
})

/**
 * Ends the current session and starts a new one bound to another conference
 * where the person has an active role — no password needed, they're already
 * authenticated. Only from inside an existing conference session.
 */
authRouter.post('/switch-conference', requireAuth, validateBody(switchConferenceSchema), async (req, res, next) => {
  try {
    const current = req.user!
    if (current.isAdminSession) {
      throw new ForbiddenError('Administrator sessions open conferences with "View as admin".')
    }
    const { conference, roles } = await assertCanSwitchTo(current.id, req.body.conference_id)

    const [sessionRows] = await pool.query('SELECT remember_me FROM auth_sessions WHERE id = ? LIMIT 1', [current.sessionId])
    const rememberMe = Boolean((sessionRows as Array<{ remember_me: number }>)[0]?.remember_me)

    await withTransaction(current.id, async (conn) => {
      await conn.query('UPDATE auth_sessions SET revoked_at = NOW(3) WHERE id = ? AND revoked_at IS NULL', [current.sessionId])
      await createSession(conn, res, {
        userId: current.id,
        rememberMe,
        isAdminSession: false,
        conferenceId: conference.id,
        ...sessionMeta(req),
      })
      await insertAuditLog(conn, {
        actorUserId: current.id,
        conferenceId: conference.id,
        action: 'auth.switch_conference',
        entityType: 'auth_sessions',
        entityId: current.sessionId,
        oldValues: { conference_id: current.conferenceId },
        newValues: { conference_id: conference.id, roles },
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      })
    })

    const [rolesRows, profile] = await Promise.all([getMyRoles(current.id, conference.id), getUserProfile(current.id)])
    res.json({ user: profile, roles: rolesRows, conference: sessionConferenceDto(conference) })
  } catch (err) {
    next(err)
  }
})

/**
 * A signed-in person (at any conference) asking for a role at another one.
 * The one allowed exception to session scoping: it can only ever create a
 * pending request for the caller themself (published conference, a
 * self-service role, no duplicate pending/active role) — it never grants
 * access to anything.
 */
authRouter.post('/request-role', requireAuth, authRateLimit, validateBody(requestRoleSchema), async (req, res, next) => {
  try {
    const { conference } = await requestRoleAsSignedInUser(
      req.user!.id,
      req.body.conference,
      req.body.requested_role,
      auditContextFrom(req),
    )
    res.status(201).json({
      message: `Request sent. You can sign in at ${conference.name} once the convenor approves it.`,
      conference: sessionConferenceDto(conference),
    })
  } catch (err) {
    next(err)
  }
})

authRouter.patch('/profile', requireAuth, validateBody(updateProfileSchema), async (req, res, next) => {
  try {
    await updateProfile(req.user!.id, req.body)
    const profile = await getUserProfile(req.user!.id)
    res.json({ user: profile })
  } catch (err) {
    next(err)
  }
})

authRouter.post('/change-password', requireAuth, validateBody(changePasswordSchema), async (req, res, next) => {
  try {
    await changePassword(
      req.user!.id,
      req.body.current_password,
      req.body.new_password,
      req.user!.sessionId,
      auditContextFrom(req),
    )
    res.json({ message: 'Password updated.' })
  } catch (err) {
    next(err)
  }
})

authRouter.post(
  '/forgot-password',
  forgotPasswordIpLimit,
  forgotPasswordEmailLimit,
  validateBody(forgotPasswordSchema),
  async (req, res, next) => {
    try {
      await requestPasswordReset(req.body.email, req.body.conference ?? null)
      res.json({ message: "If an account exists for this email, we've sent a reset link." })
    } catch (err) {
      next(err)
    }
  },
)

authRouter.post('/reset-password', authRateLimit, validateBody(resetPasswordSchema), async (req, res, next) => {
  try {
    await resetPassword(req.body.token, req.body.password, auditContextFrom(req))
    res.json({ message: 'Password updated. You can now sign in.' })
  } catch (err) {
    next(err)
  }
})

/**
 * Sets the invited person's password. They're signed straight in only when
 * the invitation link names a conference where they hold an active role —
 * the session is bound to it. Otherwise no session is created and they sign
 * in at their conference's own page.
 */
authRouter.post('/accept-invitation', authRateLimit, validateBody(acceptInvitationSchema), async (req, res, next) => {
  try {
    const { userId } = await acceptInvitation(req.body.token, req.body.password, auditContextFrom(req))
    const conference = await invitationSessionConference(userId, req.body.conference)

    if (!conference) {
      res.json({ user: null, roles: [], conference: null, signed_in: false })
      return
    }

    await withTransaction(userId, async (conn) => {
      await createSession(conn, res, {
        userId,
        rememberMe: true,
        isAdminSession: false,
        conferenceId: conference.id,
        ...sessionMeta(req),
      })
    })

    const [roles, profile] = await Promise.all([getMyRoles(userId, conference.id), getUserProfile(userId)])
    res.json({ user: profile, roles, conference: sessionConferenceDto(conference), signed_in: true })
  } catch (err) {
    next(err)
  }
})

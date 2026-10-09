import { Router } from 'express'
import { withTransaction } from '../../db/withTransaction.js'
import { requireAuth } from '../../middleware/auth.js'
import { authRateLimit, forgotPasswordEmailLimit, forgotPasswordIpLimit } from '../../middleware/rateLimit.js'
import { validateBody } from '../../middleware/validate.js'
import {
  acceptInvitationSchema,
  adminLoginSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from './validation.js'
import {
  acceptInvitation,
  changePassword,
  getMyRoles,
  getUserProfile,
  isPlatformAdmin,
  registerUser,
  requestPasswordReset,
  resetPassword,
  updateProfile,
  verifyAdminLogin,
  verifyLogin,
} from './service.js'
import { clearSessionCookie, createSession, getSessionToken, resolveSessionUser, revokeSession } from './session.js'

export const authRouter = Router()

authRouter.post('/register', authRateLimit, validateBody(registerSchema), async (req, res, next) => {
  try {
    await registerUser(req.body)
    res.status(201).json({
      message: "Account created. The conference's convenor must approve it before you can sign in.",
    })
  } catch (err) {
    next(err)
  }
})

authRouter.post('/login', authRateLimit, validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password, role, remember_me: rememberMe } = req.body
    const { userId } = await verifyLogin(email, password, role)

    await withTransaction(userId, async (conn) => {
      await createSession(conn, res, {
        userId,
        rememberMe,
        isAdminSession: false,
        userAgent: req.get('user-agent') ?? null,
        ipAddress: req.ip ?? null,
      })
    })

    const [roles, profile] = await Promise.all([getMyRoles(userId), getUserProfile(userId)])
    res.json({ user: profile, roles })
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
        userAgent: req.get('user-agent') ?? null,
        ipAddress: req.ip ?? null,
      })
    })

    const [roles, profile] = await Promise.all([getMyRoles(userId), getUserProfile(userId)])
    res.json({ user: profile, roles })
  } catch (err) {
    next(err)
  }
})

authRouter.post('/logout', async (req, res, next) => {
  try {
    if (getSessionToken(req)) {
      const user = await resolveSessionUser(req)
      if (user) await revokeSession(user.sessionId)
    }
    clearSessionCookie(res)
    res.json({ message: 'Signed out.' })
  } catch (err) {
    next(err)
  }
})

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id
    const [profile, roles, isAdmin] = await Promise.all([
      getUserProfile(userId),
      getMyRoles(userId),
      isPlatformAdmin(userId),
    ])
    res.json({ user: profile, roles, isAdmin })
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
    await changePassword(req.user!.id, req.body.current_password, req.body.new_password, req.user!.sessionId)
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
      await requestPasswordReset(req.body.email)
      res.json({ message: "If an account exists for this email, we've sent a reset link." })
    } catch (err) {
      next(err)
    }
  },
)

authRouter.post('/reset-password', authRateLimit, validateBody(resetPasswordSchema), async (req, res, next) => {
  try {
    await resetPassword(req.body.token, req.body.password)
    res.json({ message: 'Password updated. You can now sign in.' })
  } catch (err) {
    next(err)
  }
})

authRouter.post('/accept-invitation', authRateLimit, validateBody(acceptInvitationSchema), async (req, res, next) => {
  try {
    const { userId } = await acceptInvitation(req.body.token, req.body.password)

    await withTransaction(userId, async (conn) => {
      await createSession(conn, res, {
        userId,
        rememberMe: true,
        isAdminSession: false,
        userAgent: req.get('user-agent') ?? null,
        ipAddress: req.ip ?? null,
      })
    })

    const [roles, profile] = await Promise.all([getMyRoles(userId), getUserProfile(userId)])
    res.json({ user: profile, roles })
  } catch (err) {
    next(err)
  }
})

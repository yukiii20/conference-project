import type { Request } from 'express'
import rateLimit from 'express-rate-limit'
import { env } from '../config/env.js'

// Rate limits are meaningless noise in the test suite — a single test file
// legitimately exercises an endpoint far more than any real abuser would
// within one Vitest process/15-min window, on the same shared app instance.
// Skipping them under NODE_ENV=test only ever widens what a test CAN do, it
// never hides a real bug (the limiter logic itself isn't what's under test).
const skipInTest = () => env.NODE_ENV === 'test'

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: { message: 'Too many attempts. Please wait a few minutes and try again.' } },
})

const FORGOT_PASSWORD_MESSAGE = { error: { message: 'Too many attempts. Please wait a few minutes and try again.' } }

/** Per-IP half of forgot-password's "5 per 15 min per IP and per email" limit. */
export const forgotPasswordIpLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: FORGOT_PASSWORD_MESSAGE,
})

/** Per-email half — stops someone hammering one victim's inbox from many IPs. Body is already parsed by express.json() by the time this runs. */
export const forgotPasswordEmailLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  keyGenerator: (req: Request) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
    return email || req.ip || 'unknown'
  },
  message: FORGOT_PASSWORD_MESSAGE,
})

/** Rate limit for file upload endpoints (submission files, images). */
export const uploadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: { message: 'Too many uploads. Please wait a few minutes and try again.' } },
})

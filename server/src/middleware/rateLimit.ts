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

const SUGGESTION_TOO_MANY_MESSAGE = {
  error: { message: 'Too many suggestions from this address. Please try again later.' },
}

// Exported as plain data (not just baked into the middleware below) so a
// test can assert on the actual policy without needing NODE_ENV!=='test' —
// rateLimit()'s returned middleware exposes none of its options back out.
export const SUGGESTION_IP_RATE_LIMIT_CONFIG = { windowMs: 10 * 60 * 1000, limit: 3 }
export const SUGGESTION_DAILY_RATE_LIMIT_CONFIG = { windowMs: 24 * 60 * 60 * 1000, limit: 20 }

/** Public home-page suggestion box, per IP: 3 per 10 minutes — stops a single burst/script. */
export const suggestionIpRateLimit = rateLimit({
  ...SUGGESTION_IP_RATE_LIMIT_CONFIG,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: SUGGESTION_TOO_MANY_MESSAGE,
})

/** Same endpoint, per IP: 20 per day — stops a slow drip from the same source across many 10-minute windows. */
export const suggestionDailyRateLimit = rateLimit({
  ...SUGGESTION_DAILY_RATE_LIMIT_CONFIG,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: SUGGESTION_TOO_MANY_MESSAGE,
})

/**
 * Machine endpoints (/api/webhooks, /api/internal): already protected by a long shared secret;
 * this only caps noise from anyone guessing. Brevo and the 10-minute tick stay far below it.
 */
export const MACHINE_ENDPOINT_RATE_LIMIT_CONFIG = { windowMs: 60 * 1000, limit: 60 }
export const machineEndpointRateLimit = rateLimit({
  ...MACHINE_ENDPOINT_RATE_LIMIT_CONFIG,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: { message: 'Too many requests.' } },
})

/**
 * Endpoints that make the server send email on a signed-in user's behalf (member and convenor
 * invites, bulk-email test/send). Keyed per user, so one misused account can't burn the Brevo
 * daily quota for every conference. Must run after requireAuth/permission guards.
 */
export const EMAIL_TRIGGER_RATE_LIMIT_CONFIG = { windowMs: 15 * 60 * 1000, limit: 30 }
export const emailTriggerRateLimit = rateLimit({
  ...EMAIL_TRIGGER_RATE_LIMIT_CONFIG,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  keyGenerator: (req: Request) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip ?? 'unknown'}`),
  message: { error: { message: 'Too many emails sent in a short time. Please wait a few minutes and try again.' } },
})

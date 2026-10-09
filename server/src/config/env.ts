import 'dotenv/config'
import { z } from 'zod'

// 'true'/'false' strings from .env — NOT z.coerce.boolean(), which treats any
// non-empty string (including the literal text "false") as truthy.
const boolFromString = z
  .string()
  .optional()
  .transform((v) => v === 'true')

const WEAK_SESSION_SECRETS = new Set(['changeme', 'change-me', 'secret', 'dev-secret', 'development'])

const envSchema = z
  .object({
    DB_HOST: z.string().min(1),
    DB_PORT: z.coerce.number().int().positive().default(3306),
    DB_USER: z.string().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_NAME: z.string().min(1),
    SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters.'),
    CLIENT_ORIGIN: z.string().url(),
    PORT: z.coerce.number().int().positive().default(4000),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // Express 'trust proxy' setting when running behind Nginx — e.g. "1" (one
    // hop), "loopback", or "true". Left unset, Express trusts no proxy.
    TRUST_PROXY: z.string().optional(),

    EMAIL_MODE: z.enum(['console', 'smtp']).default('console'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_SECURE: boolFromString,
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM: z.string().optional(),
    // Used to build links in emails (reset-password, invitations, ...) — never hard-code localhost elsewhere.
    APP_URL: z.string().url().default('http://localhost:5173'),
  })
  .superRefine((data, ctx) => {
    if (data.EMAIL_MODE === 'smtp') {
      if (!data.SMTP_HOST) {
        ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'SMTP_HOST is required when EMAIL_MODE=smtp.' })
      }
      if (!data.SMTP_USER) {
        ctx.addIssue({ code: 'custom', path: ['SMTP_USER'], message: 'SMTP_USER is required when EMAIL_MODE=smtp.' })
      }
      if (!data.SMTP_PASS) {
        ctx.addIssue({ code: 'custom', path: ['SMTP_PASS'], message: 'SMTP_PASS is required when EMAIL_MODE=smtp.' })
      }
      if (!data.MAIL_FROM) {
        ctx.addIssue({ code: 'custom', path: ['MAIL_FROM'], message: 'MAIL_FROM is required when EMAIL_MODE=smtp.' })
      }
    }

    // Production hardening: refuse to start with a weak/placeholder secret,
    // an insecure client origin, or a non-https link base — see docs/deploy.md.
    if (data.NODE_ENV === 'production') {
      if (data.SESSION_SECRET.length < 32 || WEAK_SESSION_SECRETS.has(data.SESSION_SECRET.toLowerCase())) {
        ctx.addIssue({
          code: 'custom',
          path: ['SESSION_SECRET'],
          message: 'SESSION_SECRET must be a strong, unique value (32+ characters) in production.',
        })
      }
      if (!data.CLIENT_ORIGIN.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['CLIENT_ORIGIN'], message: 'CLIENT_ORIGIN must use https:// in production.' })
      }
      if (!data.APP_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'APP_URL must use https:// in production.' })
      }
    }
  })

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment configuration:')
  for (const issue of parsed.error.issues) {
    // Never includes SMTP_PASS's value — zod issues only ever carry the path/message, not the input.
    console.error(`  ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

export const env = parsed.data
export const isProduction = env.NODE_ENV === 'production'

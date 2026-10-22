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
    // mysql2's own default (10) queues every request past that count instead
    // of erroring, which is safe but means an undersized pool shows up as
    // creeping latency, not an obvious crash - see load/README.md's load-test
    // numbers for exactly how badly 10 queues under concurrent load. 20 is a
    // safer default for real traffic while staying well under MySQL's own
    // max_connections (150 by default) even with a few other clients
    // connected at once. Aiven's free MySQL plan caps the whole service at 76
    // connections total (all clients combined), so keep this well under that
    // if pointing at Aiven - see docs/aiven-mysql-setup.md.
    DB_POOL_SIZE: z.coerce.number().int().positive().default(20),
    // Off by default (plain local MySQL). Aiven requires SSL - set DB_SSL=true
    // and provide the CA certificate via DB_SSL_CA (its text, e.g. pasted into
    // a Render env var) or DB_SSL_CA_PATH (a file on disk). rejectUnauthorized
    // stays true whenever SSL is on - see server/src/db/pool.ts.
    DB_SSL: boolFromString,
    DB_SSL_CA: z.string().optional(),
    DB_SSL_CA_PATH: z.string().optional(),
    SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters.'),
    CLIENT_ORIGIN: z.string().url(),
    PORT: z.coerce.number().int().positive().default(4000),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // Express 'trust proxy' setting when running behind Nginx — e.g. "1" (one
    // hop), "loopback", or "true". Left unset, Express trusts no proxy.
    TRUST_PROXY: z.string().optional(),

    // smtp needs an SMTP-capable host - Render's FREE web services block the
    // outbound SMTP ports (25/465/587), so brevo (Brevo's transactional email
    // HTTP API, plain HTTPS - not blocked) is the option that works there.
    EMAIL_MODE: z.enum(['console', 'smtp', 'brevo']).default('console'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_SECURE: boolFromString,
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM: z.string().optional(),
    BREVO_API_KEY: z.string().optional(),
    // Used to build links in emails (reset-password, invitations, ...) — never hard-code localhost elsewhere.
    APP_URL: z.string().url().default('http://localhost:5173'),
    // Where uploaded files (logos, banners, photos, certificates) are read
    // from and written to. Defaults to server/storage, same as always. On
    // Render, point this at the mounted persistent disk (e.g.
    // /var/data/storage) - Render's normal filesystem is wiped on every
    // deploy/restart, so anything written outside the disk is lost. See
    // server/src/storage/paths.ts.
    STORAGE_DIR: z.string().optional(),
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

    if (data.EMAIL_MODE === 'brevo') {
      if (!data.BREVO_API_KEY) {
        ctx.addIssue({ code: 'custom', path: ['BREVO_API_KEY'], message: 'BREVO_API_KEY is required when EMAIL_MODE=brevo.' })
      }
      if (!data.MAIL_FROM) {
        ctx.addIssue({ code: 'custom', path: ['MAIL_FROM'], message: 'MAIL_FROM is required when EMAIL_MODE=brevo (must be a Brevo-verified sender).' })
      }
    }

    if (data.DB_SSL && !data.DB_SSL_CA && !data.DB_SSL_CA_PATH) {
      ctx.addIssue({
        code: 'custom',
        path: ['DB_SSL_CA'],
        message: 'DB_SSL_CA (or DB_SSL_CA_PATH) is required when DB_SSL=true.',
      })
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

// Not a hard refusal (unlike the checks above) — a production deployment that
// hasn't configured SMTP yet still needs to boot to be configured, but this
// must not go unnoticed: in console mode, password resets, invitations, and
// every other email this app sends only ever get logged to this process's
// own stdout, not delivered to anyone.
if (isProduction && env.EMAIL_MODE === 'console') {
  console.warn(
    '*** WARNING: EMAIL_MODE=console in production. No real emails will be sent ' +
      '(password resets, invitations, notifications all just log to this console). ' +
      'Set EMAIL_MODE=smtp with SMTP_HOST/SMTP_USER/SMTP_PASS/MAIL_FROM before going live. ***',
  )
}

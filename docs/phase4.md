PHASE 4 — Real email via SMTP (Gmail for now), password reset, in-app notifications,
final Supabase cleanup, security hardening.

Do this only after Phase 3 is finished and its tests pass. Work through it without stopping
to ask me unless a database schema change is needed.

GROUND RULES (same as before)
- Do NOT change the database schema and do NOT run SQL yourself. Tables already exist:
  auth_tokens (purpose password_reset), notifications, email_logs, audit_logs. If a schema
  change is truly needed, stop and show me a new database/04_*.sql file first.
- Same module pattern, zod, withTransaction, middleware/auth.ts guards, utils/audit.ts.
- No secrets in code, tests, logs, docs or chat. Read them only from server/.env.
- This is a REAL application that will go live, so treat security as production-grade.

1. REAL EMAIL VIA SMTP (nodemailer; Gmail now, a domain provider later)
- npm i nodemailer (+ @types/nodemailer) in server/.
- New env vars, validated in src/config/env.ts, added to server/.env.example with EMPTY values:
  EMAIL_MODE=console|smtp (default console)
  SMTP_HOST=smtp.gmail.com  SMTP_PORT=465  SMTP_SECURE=true  SMTP_USER=  SMTP_PASS=
  MAIL_FROM="Conference CMS <address>"  APP_URL=http://localhost:5173
  If EMAIL_MODE=smtp and SMTP_USER/SMTP_PASS are missing, fail fast at startup with a clear
  message. Never log SMTP_PASS. Tell me which lines to fill in server/.env myself.
- Put sending behind one provider interface sendMail({to, subject, html, text}) with a
  console provider and an smtp provider, so another provider (e.g. Resend) can be added later
  by changing only server/.env.
- Keep utils/email.ts queueEmail as the ONLY way callers send; it inserts email_logs 'queued'.
- Email worker (server/src/email/worker.ts) started with the server:
  * every 10 s pick up to 20 rows: status 'queued', or 'failed' with attempts < 5 and last try
    older than 2^attempts minutes; use SELECT ... FOR UPDATE SKIP LOCKED; set 'sending'
  * render subject + body from email_templates: conference-specific template first, else the
    platform default (conference_id IS NULL); HTML-escape every placeholder value
  * wrap in one clean, simple HTML layout (platform name, content, footer) + plain-text version
  * success -> 'sent', sent_at, provider_message_id; error -> 'failed', attempts + 1,
    short error_message without secrets
  * worker must survive SMTP errors and never crash the server; on startup reset rows stuck in
    'sending' for more than 10 minutes back to 'queued'
- Secret links: the worker needs the link to send, so keep it until sent, then REDACT keys
  ending in _url / _link / token (invite_url, reset_url, accept_url ...) to "[redacted]" in
  email_logs.template_data. Rows that end 'failed' after 5 attempts are redacted too.
- Console mode: print the email (with link) only when NODE_ENV is not production.
- Every link uses APP_URL (never hard-coded localhost). Check every existing flow queues the
  right template: convenor_invitation, invitation, account_created, role_request_approved,
  role_request_rejected, submission_received, review_assigned, decision_accepted,
  decision_rejected, decision_revision_required, password_reset.
- Admin "Email log" page (admin only) and convenor "Emails" tab (permission email.read):
  recipient, template, subject, status, attempts, time, error, "Retry" button for failed rows.
  Never show template_data.
- Tests use a mocked transport, never real Gmail.

2. PASSWORD RESET (backend, no Supabase)
- POST /api/auth/forgot-password {email}: always the same answer ("If an account exists,
  we sent a reset link") whether or not the email exists; rate limited (5 per 15 min per IP
  and per email). If the user exists: create auth_tokens row (purpose password_reset, store
  only SHA-256 of a random 32-byte token, expires in 60 minutes, single use, previous unused
  reset tokens of that user invalidated) and queue 'password_reset' with
  reset_url = APP_URL/reset-password?token=...  (add APP_URL to env, default
  http://localhost:5173; never hard-code localhost elsewhere).
- POST /api/auth/reset-password {token, password}: same password rules as sign-up, token
  marked used, new bcrypt hash, ALL existing sessions of that user revoked, lockout reset,
  audit log entry.
- POST /api/auth/change-password {current_password, new_password} (logged in): verify
  current password, revoke other sessions, keep the current one.
- Wire ForgotPasswordPage.tsx, ResetPasswordPage.tsx and ChangePasswordPage.tsx to these
  endpoints. Remove any Supabase leftovers in them.
- Admin: "Reset password" action on a user in the super-admin users list that sends the
  same reset link (never shows or sets a password itself).

3. IN-APP NOTIFICATIONS
- One helper notifyUser(conn, {userId, type, title, body, linkPath}) that inserts into
  notifications. Call it everywhere an email is queued for a known user (role request
  approved/rejected, invitation accepted, submission received, reviewer assigned, review
  submitted -> convenor, decision made -> author).
- GET /api/me/notifications?unread=1 (latest 50), POST /api/me/notifications/:id/read,
  POST /api/me/notifications/read-all. Users only ever see/change their own (404 otherwise).
- Frontend: bell icon in PortalHeader with unread count (poll every 60 s, pause when the
  tab is hidden), dropdown list, click opens linkPath and marks it read, "Mark all read".
  Works for every role, also on mobile width.

4. FINAL SUPABASE CLEANUP
- grep the whole frontend and server for "supabase" (case-insensitive). Remove every
  remaining import, helper, env usage (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY), Supabase
  type file (src/lib/database.types.ts if only Supabase uses it) and the
  @supabase/supabase-js package.
- Remove Supabase keys from .env.example. Tell me to delete them from .env.local myself.
- Do NOT delete the supabase/ and database_supabase/ folders; list them so I can archive them.

5. SECURITY HARDENING (production-grade; fix what you find, report the rest)
- npm audit in both projects; fix high/critical where it does not break things.
- Cookies: httpOnly, SameSite=Lax, Secure when NODE_ENV=production. Add `trust proxy`
  setting from env (TRUST_PROXY) for running behind Nginx.
- CSRF: all state-changing requests must be JSON with Content-Type application/json or
  multipart from CLIENT_ORIGIN; reject requests whose Origin header is not CLIENT_ORIGIN.
- helmet with a sensible Content-Security-Policy for the built frontend; CORS only
  CLIENT_ORIGIN; rate limits on login, sign-up, forgot-password, uploads.
- Every non-public route has an auth/permission guard: write a test that lists all Express
  routes and fails if a non-public route has no guard.
- Private files never served statically; download endpoint checks permission every time.
- Errors: never send stack traces or SQL messages to the client in production; log them
  server-side with a request id.
- Env validation: in production refuse to start if SESSION_SECRET is short/default,
  DB password is empty, or CLIENT_ORIGIN/APP_URL are not https.
- .gitignore covers server/.env, .env.local, server/storage, test-results,
  playwright-report, dist. Check git history does not contain .env files and tell me if it does.
- Session cleanup: delete expired auth_sessions and used/expired auth_tokens daily
  (simple interval job in the server).

6. PRODUCTION READINESS (prepare, do not deploy)
- npm run build for server produces dist/; `npm start` runs it with NODE_ENV=production.
- Frontend production build served by Nginx; API under /api and /files/public proxied to
  Node. Write docs/deploy.md with: Ubuntu VPS setup, MySQL install and secure user,
  running the SQL files, creating the admin, PM2 (or systemd) for the backend, Nginx config,
  HTTPS with Let's Encrypt, daily backup script for MySQL (mysqldump) AND server/storage
  with 14-day rotation, and how to restore. Plain simple English.
- Add a GET /api/health endpoint (DB ping, no secrets) for monitoring.

7. README + TESTS + FINISH
- Update README.md: install, MySQL setup (database/01..03 + test-setup.sql), create admin
  (npm run create-admin), fill server/.env (list every variable with a short explanation),
  run backend + frontend, run tests, where uploads are stored. Plain simple English.
- Tests: forgot-password same response for unknown email; reset token single use, expired
  rejected, sessions revoked after reset; change-password; notifications owner-only;
  route-guard test; Origin check; health endpoint; email worker: console mode marks sent,
  smtp mode with mocked transport, failure retries with backoff and stops after 5, secrets
  redacted after send, HTML in a user name is escaped, stuck 'sending' rows recovered.
- npx tsc --noEmit, npm run build, npm test (server) and npx playwright test all pass,
  including everything from Phases 1-3.
- grep -ri supabase src server/src -> empty.
- Write docs/phase4-test-steps.md and docs/final-test-report.md (table: area, test, result).
- Make sure the backend is running on port 4000 when you finish, and give me a short list
  of what to click to test.

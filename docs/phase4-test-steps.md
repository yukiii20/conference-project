# Phase 4 manual test steps

Real email (SMTP), password reset, in-app notifications, final Supabase cleanup,
and security hardening. Pair this with `npm test` (server and repo root),
`npx tsc --noEmit` (both), `npm run build` (both) and the Playwright suite below,
which already cover this ground automatically.

## Before you start

Same prerequisites as `docs/phase3-test-steps.md` (MySQL loaded, an approved
convenor/author/reviewer in one conference), plus:

1. Backend `.env` has `EMAIL_MODE=console` for local testing (the default) —
   emails print to the backend terminal instead of sending for real.
2. `cd server && npm run dev` (port 4000), `npm run dev` at the repo root
   (port 5173).

---

## Part A — Email (console mode)

| # | Click path | Expected result |
|---|---|---|
| A1 | As a convenor, approve a pending role request (Role requests tab) | Within ~10 s the backend terminal prints a rendered email ("account_created" or "role_request_approved" template) with a plain-text body and a link built from `APP_URL` — never `localhost` hard-coded anywhere else. |
| A2 | Admin → Email log page | A row for that email: recipient, template, subject, status **sent**, timestamp. Click a row — no raw link/token is shown (`template_data` is never rendered in the UI). |
| A3 | Convenor → Emails tab (same conference) | The same row, scoped to this conference only; filter by status works. |
| A4 | Force a send to fail (e.g. temporarily stop MySQL *after* the email_logs row is queued — or just trust the retry test in `emailWorker.test.ts`) | Not required manually — covered by automated tests; skip unless you want to see it live. |

## Part A — Email (real SMTP, optional — uses your own Gmail)

| # | Click path | Expected result |
|---|---|---|
| A5 | Set `EMAIL_MODE=smtp`, `SMTP_USER`, `SMTP_PASS` (a Gmail **App Password**, not your real password), `MAIL_FROM` in `server/.env`, restart the backend | Backend starts normally. If you leave `SMTP_USER`/`SMTP_PASS` empty with `EMAIL_MODE=smtp`, the backend refuses to start with a clear message instead of silently failing later. |
| A6 | Trigger any email (e.g. forgot-password, below) | A real email arrives in the target inbox within ~10 s, nicely formatted (HTML + plain-text fallback), from the `MAIL_FROM` address. |
| A7 | Email log for that row | Status **sent**, a `provider_message_id` is recorded (not shown in the UI, but present — ask a developer to check the DB if curious). |

Switch back to `EMAIL_MODE=console` afterwards for day-to-day local dev.

---

## Part B — Password reset

| # | Click path | Expected result |
|---|---|---|
| B1 | Sign out → `/forgot-password` → enter a real account's email → submit | "If an account exists, we sent a reset link." (same message either way) |
| B2 | Same form with an email that has no account | Identical message — no way to tell accounts apart from the response. |
| B3 | Submit the form 6 times quickly for the same email | After the 5th, you're rate-limited: "Too many attempts..." |
| B4 | Check the backend terminal (console mode) or inbox (SMTP mode) for the `password_reset` email → open the reset link | `/reset-password?token=...` loads a form asking for a new password. |
| B5 | Submit a new password that meets the sign-up rules | "Password reset." You're asked to sign in again. |
| B6 | Try the same reset link a second time | Rejected — the token is single-use. |
| B7 | Wait past the link's validity (or ask a developer to test this via the automated test) | Rejected as expired — covered by `passwordReset.test.ts`, not practical to wait out manually. |
| B8 | Sign in on a second browser/device *before* resetting, then complete a reset on the first | The second browser's session is signed out next time it calls the API — resetting a password revokes every existing session. |
| B9 | Signed in → Profile → "Change password" → enter your current password and a new one | "Password changed." Your current session stays signed in; any other open session is revoked. |
| B10 | Wrong current password on the change-password form | Rejected, current session untouched. |
| B11 | As an admin, open a user in the Users list → "Reset password" | A reset email is queued to that user (same as B1) — the admin never sees or sets the password directly. |

---

## Part C — In-app notifications

| # | Click path | Expected result |
|---|---|---|
| C1 | As an author, have a convenor approve your role request | Within ~60 s (or immediately on next poll) the bell icon in the header shows an unread badge. |
| C2 | Click the bell | A dropdown lists the notification ("Your request was approved", etc.) with a timestamp. |
| C3 | Click the notification | Navigates to the relevant page (e.g. `/author`) and the badge count decreases — it's marked read. |
| C4 | "Mark all read" | Badge disappears; reopening the dropdown shows everything as read. |
| C5 | Switch to a different browser tab for a while, then come back | The bell did not poll while the tab was hidden (check Network tab if curious) — it resumes polling once visible again. |
| C6 | As a different user, try `POST /api/me/notifications/<someone else's id>/read` directly (e.g. via browser devtools) | 404 — notifications are strictly per-user. |
| C7 | Resize the browser to a phone width | The bell and its dropdown are still usable — no overflow or clipped dropdown. |
| C8 | Repeat for reviewer and convenor roles (new review assignment, review submitted, decision made) | Each produces both an email (Part A) and a matching notification. |

---

## Part D — Final Supabase cleanup

| # | Click path | Expected result |
|---|---|---|
| D1 | `grep -ri supabase src server/src` from the repo root | No output. |
| D2 | Check `package.json` / `server/package.json` | No `@supabase/supabase-js` dependency anywhere. |
| D3 | Check `.env.example` / `server/.env.example` | No `VITE_SUPABASE_*` or Supabase keys. |
| D4 | `supabase/` and `database_supabase/` folders | Still present on disk — archive or delete them yourself when ready; the app does not read them. |

---

## Part E — Security checks

| # | Click path | Expected result |
|---|---|---|
| E1 | Open devtools → Application/Storage → cookies | The session cookie is `HttpOnly` (not readable from `document.cookie`) and `SameSite=Lax`. |
| E2 | From a different origin (e.g. open the browser console on `https://example.com` and try to `fetch('http://localhost:4000/api/me', {credentials:'include'})`) | Blocked by CORS — only `CLIENT_ORIGIN` is allowed. |
| E3 | Use curl/Postman to POST to any state-changing endpoint with `Content-Type: text/plain` or a mismatched `Origin` header | Rejected before it reaches business logic. |
| E4 | Try to fetch a private submission file's `storage_path` directly (if you can find it) | 404 — `server/storage/private` is never served statically. |
| E5 | Trigger a server-side error (e.g. malformed request body) with `NODE_ENV=production` | The client sees a generic error message, never a stack trace or raw SQL error. The backend terminal logs the full detail with a request id. |
| E6 | `GET /api/health` | `{"status":"ok", ...}` — no secrets, confirms DB connectivity. |
| E7 | Try starting the backend with `NODE_ENV=production` and a short `SESSION_SECRET` (e.g. `"secret"`) | Refuses to start with a clear message. |

---

## Automated coverage (run these instead of clicking through everything above)

```bash
cd server && npm test        # includes emailWorker, notifications, passwordReset, routeGuards, security
npm test                     # frontend unit tests, repo root
npx tsc --noEmit              # both projects
npm run build                 # both projects
npx playwright test           # full end-to-end suite, see below
```

### Running the Playwright suite

The e2e suite runs against **throwaway** backend/frontend instances, never
your real dev servers on 4000/5173, and never your real database.

1. Seed fixture data into the test database (idempotent, safe to re-run):
   ```bash
   cd server
   npx tsx tests/e2eSeed.ts
   ```
2. Start a second backend instance on port 4100, pointed at the test database
   and a disposable storage folder, with rate limits relaxed the same way the
   unit tests are:
   ```bash
   cd server
   DB_NAME=conference_cms_test NODE_ENV=test STORAGE_ROOT=storage-test-e2e \
     CLIENT_ORIGIN=http://localhost:5273 PORT=4100 npm run dev
   ```
3. Start a second frontend instance on port 5273, proxying to that backend:
   ```bash
   VITE_API_PROXY_TARGET=http://localhost:4100 npx vite --port 5273
   ```
4. From the repo root:
   ```bash
   npx playwright test
   ```
   (`playwright.config.ts` already points `baseURL` at `http://localhost:5273`.)

All 17 tests (`e2e/main.spec.ts`, `e2e/notifications.spec.ts`,
`e2e/submissions.spec.ts`) pass — see `docs/final-test-report.md`.

---

## Cleanup check

- `grep -ri supabase src server/src` from the repo root should print nothing.
- `npm audit` in both the repo root and `server/` reports 0 vulnerabilities.
- `git log --all -- "*.env" ".env.local" "server/.env"` should print nothing —
  no `.env` file has ever been committed.

# Implementation progress

One entry per phase of `REFACTORING_PLAN.md`. A feature is only reported as done with evidence
(tests run, output inspected), never just because its interface exists.

---

## Phase 0 — Full audit · 1 November 2026 · status: DONE, waiting for approval

**Work completed**
- Read the whole repository and traced the main workflows from the UI through the API to the
  database.
- Walked the import graph for dead files, checked every dependency was used, and scanned all
  273 API routes for auth guards.
- Scanned for SQL-injection patterns, upload and download access, timezone bugs, the email
  lifecycle, background jobs, design tokens, and repository size.

**Files created** (documentation only — no code changed in this phase)
- `docs/PROJECT_AUDIT.md`
- `docs/FEATURE_COMPLETION_MATRIX.md`
- `docs/ARCHITECTURE.md`
- `docs/REFACTORING_PLAN.md`
- `docs/IMPLEMENTATION_PROGRESS.md`

**Files removed:** none.

**Bugs discovered** (details in the audit)
- **C1:** production uploads are wiped on each Render deploy.
- **C2:** Aiven SQL status unconfirmed.
- **H1:** reviewer downloads keep the author's filename and PDF metadata.
- **H2:** scheduled jobs pause while Render sleeps.
- **H3:** registration categories, fees and payments exist as tables only.
- **H4:** no ESLint.
- **M1–M8 and L1–L6:** listed in the audit.

**Bugs fixed:** none in this phase. It's audit-only by design.

**Tests executed in this phase**

| Check | Result |
|---|---|
| `tsc` frontend | pass |
| `tsc` server | pass |
| `vite build` | pass |
| Frontend Vitest | 75/75 pass |
| Server Vitest without a database | 308 pass; 366 not runnable (`ECONNREFUSED` — no MySQL on this machine) |
| Playwright, k6, Lighthouse | not run (they need a database or a deployed site) |

**Remaining issues:** everything in the audit, plus decisions D1–D7 in the plan.

**Next phase:** Phase 1 (critical fixes), after the owner answers D1–D7.

---

## Before Phase 0 (same day, for the record)

These were already pushed to `main` earlier on 1 November. Details are in `docs/progress.md`.

- UI spacing fixes and slim scrollbars.
- Certificate redesign, then the fully editable certificate template with live preview.
- Email `{{conference_code}}` placeholder fix.
- Portal chunk prefetch.
- `npm audit fix`: frontend now clean; the server's remaining 9 moderate issues are all
  inside `exceljs`.
- Dated SQL run folder `database/2026-11-01/`.
- Stray zip files removed from the working tree.

---

## Phase 1, item C1: Cloudflare R2 file storage · 1 November 2026 · status: CODE DONE, needs owner setup

The owner chose R2 for **D1**. The database stays on Aiven MySQL.

**Work completed**
- Storage driver interface with two drivers:
  - `local`: today's behaviour, used by default and always in tests
  - `r2`: Cloudflare R2 through its S3 API
- Every save, read, delete and download now goes through it:
  - logos and photos
  - submission files
  - certificate PDFs and their images
  - abstract books
  - badge logos
- Downloads are streamed, and a missing file returns a clean 404 ("upload it again") instead of
  an error page.
- With R2 on, `/files/public/*` is served from R2 at the same URLs.
- `npm run r2 -- check | upload` checks the R2 settings and copies local files into the bucket.

**Files**
- New:
  - `server/src/storage/driver.ts`
  - `server/src/storage/send.ts`
  - `server/src/scripts/r2.ts`
  - `server/tests/storage.test.ts`
  - `docs/cloudflare-r2-setup.md`
- Changed:
  - storage helpers
  - 4 download routes and 3 services
  - `app.ts`
  - `utils/health.ts` (health now reports `storage`)
  - `config/env.ts`
  - `tests/setup.ts`
  - `.env.example`
  - `render.yaml`
- New dependency: `@aws-sdk/client-s3` (the official S3 client). `npm audit` reports nothing
  new.

**Bug found and fixed while testing:** the R2 public-file handler read the full URL instead of
the wildcard part, so every public file would have returned 404. Caught by
`storage.test.ts` before release.

**Tests**
- `tsc` clean.
- `storage.test.ts`: 22/22 pass. It covers both drivers (R2 mocked, no network), path-escape
  rejection, streaming, filename encoding, and 404s.
- Full server suite without a database: 331 pass, and the same 366 still need MySQL. No new
  failures.

**Not verified yet:** a real R2 bucket. That needs the owner's Cloudflare account (setup guide
step 3: `npm run r2 -- check`).

**Remaining:** files lost on Render before this change can't be recovered; they need to be
re-uploaded. See the guide's step 5.

---

## Phase 1, item H1: double-blind file anonymisation · 1 November 2026 · status: DONE

See commit 95d0f79. Reviewers get neutral file names (`S-0012-full_paper-v2.pdf`), and author
metadata is stripped from PDF/DOCX/PPTX on upload. `tests/anonymize.test.ts`: 5/5 pass.

## Phase 1, item M1: Nepal-time dates · 1 November 2026 · status: DONE

**Problem:** "today" was the UTC date, so between 00:00 and 05:45 Nepal time, analytics ranges,
default review due dates and dashboard day keys were one day behind. Several lists showed times in
the browser's own timezone, and certificates printed the UTC issue date.

**Fixed**
- Server:
  - Analytics default range uses the conference timezone.
  - Platform charts bucket users, emails and suggestions by Nepal day and week.
  - Certificate "Issued" date is in Nepal time.
  - New helpers in `utils/timezone.ts`: `PLATFORM_TIMEZONE`, `addDaysToDateKey`, `weekStartKey`.
- Client:
  - New `kathmanduToday()` in `src/lib/datetime.ts`, used by the analytics presets, dashboard, and
    the auto-assign and assignment due dates.
  - Email log, submission history, announcements, members, role requests, decisions and reviewer
    due dates now use `formatKathmandu`.
- Left alone on purpose: DATE-column (`YYYY-MM-DD`) formatting, which carries no timezone.

**Tests:** new `server/tests/timezone.test.ts` (5) and `kathmanduToday` tests (2), both covering
20:30 UTC = next day in Nepal.
- Frontend 77/77.
- Server 341 pass; 366 need MySQL (`ECONNREFUSED`), same as before.
- `tsc` and `vite build` clean.

## Phase 1, items M8 + M3: logo and frontend security headers · 1 November 2026 · status: DONE (headers need a live check)

- **M8:** `public/logo.png` is already 25 KB (384×256, palette PNG). Nothing to do.
- **M3:** `vercel.json` now sends these headers on every response:
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `X-Frame-Options: SAMEORIGIN`
  - a CSP limited to `frame-ancestors 'self'; base-uri 'self'; object-src 'none'`, which blocks
    clickjacking without restricting scripts, fonts, video or images
  - `Permissions-Policy`: camera allowed for the check-in scanner; microphone, location, payment
    and USB off
  - HSTS
- A full script/style CSP is deferred: it needs testing against the live homepage video,
  Google Fonts, map embeds and blob: PDF previews.
- **Verify after the Vercel deploy:**
  - `curl -I https://<site>/` shows the headers.
  - Homepage, venue map, certificate preview and the check-in camera all still work.

## Phase 1, items H4 + L1: ESLint and dead code · 1 November 2026 · status: DONE

- **Setup:** ESLint 9 flat config in both packages (`eslint.config.js`, `server/eslint.config.js`),
  with `npm run lint` in each.
  - Rules: recommended JS and TypeScript, plus react-hooks on the frontend.
  - Dev dependencies: `eslint`, `@eslint/js`, `typescript-eslint`, `globals`, and
    `eslint-plugin-react-hooks` (frontend only).
- **Findings fixed:**
  - 13 unused imports and variables
  - 2 `any` types (the session row is now typed)
  - 1 `prefer-const`
  - 2 disable comments naming a rule that doesn't exist
  - 5 stale disable comments
  - `SessionTimerPage`'s timer config is now memoised; it used to re-run its effect on every
    render
- **L1:** deleted `src/components/LinkifiedText.tsx` (imported nowhere).
- **Result:**
  - `npm run lint` clean in both packages; `tsc` clean.
  - Frontend 77/77.
  - Server 341 pass; 366 need MySQL, unchanged.
  - `vite build` OK.
- **Known and accepted:** `npm audit` now also lists `minimatch` < 11.0.1 (a moderate ReDoS in
  glob parsing) inside ESLint's own dependencies. This is dev-only and never shipped. No ESLint 9
  release avoids it, and npm's only suggested "fix" is a downgrade to ESLint 4.

## Phase 1, item L-docs: documentation tidy-up · 1 November 2026 · status: DONE

- Moved 31 historical docs (build prompts, phase specs, one-off audits, test reports) to
  `docs/archive/`.
- Rewrote all 21 references to them in code comments, READMEs and docs. The diff changes paths
  only.
- New `docs/README.md` index.
- Deploy guides:
  - `deploy-guide.md` is the canonical guide for the live Vercel/Render/Aiven setup.
  - `deploy.md` stays as the VPS alternative (a different target, so it isn't merged).
  - The third file was only a prompt spec, so it was archived.

## D3 / M2: Brevo delivery webhook · 1 November 2026 · status: CODE DONE, owner switches it on

**What it does:** `POST /api/webhooks/brevo` changes an email log row from `sent` to
`delivered`, or to `bounced`.
- Bounce events: hard bounce, invalid email, blocked and error. The bounce reason is saved.
- Soft bounces, opens and clicks are ignored.
- Every update is guarded: `delivered` only upgrades a `sent` row, and a bounce is final.
  Events that arrive late, twice or out of order can't regress a status.
- **Authentication:** a shared secret (`BREVO_WEBHOOK_SECRET`, 24+ characters) sent as a bearer
  token or `?token=`, compared in constant time. With the secret unset, the endpoint returns 404.
- Batched (array) payloads are supported.

**Files**
- New:
  - `server/src/modules/emailWebhooks/{service,routes}.ts`
  - `tests/brevoWebhook.test.ts`
  - `tests/brevoWebhookDb.test.ts`
- Changed:
  - `app.ts`, `config/env.ts`
  - `.env.example`, `render.yaml`
  - `EmailLogTab.tsx` (one-line status legend)
  - `docs/deploy-guide.md` (setup steps)

**Tests**
- `brevoWebhook.test.ts`: 7/7 pass (classification, 404 when off, 401 for a wrong or missing
  token, bearer and query tokens, batches).
- `brevoWebhookDb.test.ts`: 3 tests (real row transitions). Not run yet: no MySQL here.
- Lint and `tsc` clean.

**Owner step:** follow "Optional: delivery and bounce tracking" in `docs/deploy-guide.md`.

## H2: background jobs while Render sleeps · 1 November 2026 · status: CODE DONE, owner adds 3 secrets

- **Endpoint:** `POST /api/internal/tick` runs one pass of every job:
  - email stuck-row recovery and one email batch
  - scheduled announcements
  - review reminders
  - session cleanup
- **Safety:**
  - Protected by `CRON_SECRET` (bearer token, constant-time compare); returns 404 while it's
    unset.
  - One failing job doesn't stop the others.
  - A second tick while one is running gets 202.
  - All jobs were already safe to repeat: atomic email claim, `INSERT IGNORE` reminders,
    `FOR UPDATE` announcements.
- **Scheduler:** `.github/workflows/tick.yml (template: deploy/github-tick-workflow.yml)` calls it every 10 minutes. It skips until the
  `TICK_URL` and `CRON_SECRET` repository secrets exist. This also keeps the free Render
  instance awake.
- **Files:**
  - `server/src/jobs/tick.ts`
  - `tests/tick.test.ts`
  - `app.ts`, `config/env.ts`, `.env.example`, `render.yaml`
  - `docs/deploy-guide.md` ("Keep background jobs running")
- **Tests:**
  - `tick.test.ts` 5/5.
  - Server 353 pass; 369 need MySQL.
  - Lint and `tsc` clean.

## D2a / H3: registration prices and manual payments · 1 November 2026 · status: CODE DONE, DB tests pending MySQL

**No SQL needed.** It uses the existing `registration_fees`, `registrations.fee_id/amount_due/waiver_*`
and `payments` tables, the `fees_overlap_*` trigger, and the `payment.manage` / `payment.read_all`
permissions. That makes it safe to auto-deploy before any Aiven change.

**Behaviour**
- **Prices:**
  - Per category, each with a validity window entered in Nepal time.
  - Overlapping active prices are rejected by the database trigger, shown as a readable 409.
  - Deleting a price someone registered under switches it off instead of deleting it.
- **Registering:**
  - The current price is copied onto the registration (`fee_id`, `amount_due`, `currency`).
  - A paid category starts `pending`.
  - A free category is `confirmed` unless "registration requires payment" is on (unchanged
    behaviour).
  - A priced category with no price covering today is refused with a clear message instead of
    silently becoming free.
- **Payments:**
  - Staff record cash, bank transfer, eSewa, Khalti, Fonepay or other payments, with an optional
    reference.
  - The payment that covers the balance auto-confirms the registration and queues the existing
    `payment_received` email plus an in-app notification.
  - Mistakes are voided with a reason, never deleted.
  - The fee can be waived with a reason (records `waived_by`).
- **Lists and export:** the registration list and CSV export show amount paid. The CSV now also
  neutralises spreadsheet-formula cells (`=`, `+`, `-`, `@`).
- **Screens:**
  - Convenor Attendance tab: a "Price now" column, a Prices editor, and a Payments column with a
    payments dialog.
  - Attendee: prices appear in the category picker, and the ticket shows the fee and what's still
    owed.
- **New endpoints:**
  - `GET /registration-fees`
  - `POST /registration-categories/:categoryId/fees`
  - `PATCH` and `DELETE /registration-fees/:feeId`
  - `GET` and `POST /registrations/:id/payments`
  - `POST /registrations/:id/payments/:paymentId/void`
  - `POST /registrations/:id/waive`

**Tests**
- `registrationFeesValidation.test.ts` 6/6 and `money.test.ts` 3/3 pass.
- `registrationFees.test.ts`: 14 end-to-end API tests (overlap trigger, permissions, part
  payments, auto-confirm, void, waive, attendee view). **Not run yet: no MySQL here.**
- Frontend 80/80.
- Server 367 pass; all 383 failures are `ECONNREFUSED` (checked from the JSON report: 0
  non-database failures).
- Lint, `tsc` and build clean.
- **Not done:** an online payment gateway (D2b, which needs a merchant account) and a visual
  check against a running backend.

## D4 / M7: super administrator role · 1 November 2026 · status: CODE DONE, owner runs one SQL file

**What changed**
- New platform role `super_admin`, held on top of `admin`.
- **Only a super admin can:**
  - add or remove administrators
  - change platform settings
  - suspend or deactivate another admin account
  - grant or remove super admin
- Ordinary admins keep everything else (conferences, users, audit log, email log…).
- **Fallback:** until anyone holds `super_admin`, every admin counts as one (the old behaviour).
  The code is therefore safe to auto-deploy before the SQL runs.
- **First grant:** it also makes the granting admin a super admin, so nobody locks themselves
  out.
- **Protections:**
  - The last active super admin can't be removed, suspended or deactivated.
  - Nobody can remove their own super access.
  - Removing admin access also removes super access.
- **UI:**
  - `/api/auth/me` returns `isSuperAdmin`.
  - Super admin → Admins shows a "Super admin" badge and Make/Remove super admin buttons, and
    hides the add/remove controls for ordinary admins.
  - Platform settings are read-only for ordinary admins.
- **Also:** the new-conference date picker's "today" now uses Nepal time (`todayDateString`).

**SQL (new files only):**
- `database/07_super_admin.sql`: one `roles` row, no table changes, idempotent.
- Run folder `database/2026-11-01-part-2/` (LOCAL, AIVEN, CHECK, README).
- Appended to the generated `test-setup.sql`.
- Nobody is granted the role by SQL; the owner picks super admins in the app.

**Tests**
- `tests/superAdmin.test.ts`: 6 API tests (fallback, first grant, 403s for ordinary admins,
  last-super protection, cascade on revoke, admin-only targets). **Not run yet: no MySQL here.**
- `routeGuards.test.ts`:
  - It caught the new guard name; `requireSuperAdmin` was added to the recognised guards.
  - It now also covers the webhook and tick routers, listed as public because they check their
    own token.
  - Result: 291/291.
- Server: 371 pass, 389 need MySQL, 0 failures from other causes.
- Frontend 80/80.
- Lint, `tsc` and build clean.

## M4, certificate PDF test, L4–L6 · 1 November 2026 · status: DONE

- **M4: schema parity.** New `server/tests/schemaParity.test.ts` runs the same sample payloads
  through each client/server schema pair: name, email, phone, password, login, forgot password,
  registration category, keywords, invite member. They must agree.
  - **Drift found and fixed:** the client registration-category form rejected a missing
    `description` that the server accepts.
  - **Documented exception:** keywords. The abstract form requires one or more keywords on
    purpose, while the API accepts keyword-less drafts (many existing tests rely on that). The
    test allows the client to be stricter, never looser.
- **Certificate PDF test** (`server/tests/certificatePdf.test.ts`, no database). It parses the
  PDF back and checks:
  - a single A4 landscape page
  - the name, conference, number and Nepal issue date are present
  - `{conference}` placeholders are filled
  - hidden parts don't render
  - a very long name, conference or signatory set never spills onto a second page
  - 5/5 pass.
- **L4:** removed the `dangerouslySetInnerHTML` HTML-comment hack from the Privacy and Terms
  pages. The source-level "template, not reviewed by a lawyer" notice stays. **The owner still
  needs a lawyer to review both pages before launch.**
- **L5:** `playwright.config.ts` no longer hard-codes `C:\Users\ADMIN\...`. It uses
  `PLAYWRIGHT_CHROMIUM_PATH` if set, otherwise the newest Playwright-installed full chromium for
  the current user (sorted numerically), otherwise the default.
- **L6:** every intentional `.catch(() => {})` now has a one-line reason (the forgot-password
  page already had one).
- **Result:** frontend 80/80, lint and `tsc` clean.

## Phase 9 (part): rate-limit review · 1 November 2026 · status: DONE

- **Already limited:** sign-in, sign-up, join, forgot/reset password, role requests, uploads,
  suggestions, certificate verification.
- **Added:**
  - `machineEndpointRateLimit` on `/api/webhooks` and `/api/internal`: 60 per minute per IP.
    These are already secret-protected; the limit only caps guessing noise.
  - `emailTriggerRateLimit` on member invites, convenor invites and bulk-email test/send: 30 per
    15 minutes per signed-in user, so one misused account can't burn the shared Brevo daily
    quota.
- Both are skipped under `NODE_ENV=test`, like the existing limits.
- **Route-guard test:** now lists the new public `/public-stats` homepage endpoint (totals only,
  added by a parallel homepage session) with its reason.
- **Result:** 291/291 route-guard tests; full server suite has 0 failures other than missing
  MySQL.

## Phase 11: deployment checklist · 1 November 2026 · status: DONE (owner runs it)

- New `docs/DEPLOYMENT_CHECKLIST.md`, linked from `docs/README.md`. It covers:
  - SQL run order: `2026-11-01/`, then `2026-11-01-part-2/`; local first, then Aiven.
  - Optional env vars (`CRON_SECRET`, `BREVO_WEBHOOK_SECRET`, R2), with what each turns on.
  - The manual GitHub workflow step.
  - A post-deploy check list and rollback steps.
- No production change was made. Every item is for the owner to run.

## Phase 10 (part): role matrix + report export tests, CSV injection fix · 1 November 2026 · status: DONE (DB tests need MySQL)

- **Role matrix:** new `server/tests/roleMatrix.test.ts` (13 tests, need DB).
  - Checks that the role_permissions seed matches the documented matrix.
  - Checks each role against 19 guarded endpoints (allowed vs 403).
  - Also covers: outsider 403, other conference's convenor 403, signed-out 401, platform admin
    allowed everywhere, settings convenor-only.
- **Security fix:** report, audit-log and suggestion CSV exports did not neutralise formula cells.
  A public suggestion or a name like `=HYPERLINK(...)` would run as a formula in Excel.
  - New shared `server/src/utils/csv.ts` (`csvCell`) is now used by all four CSV exporters.
  - Dates are now written as ISO in every export.
- **Tests:**
  - `tests/csv.test.ts`: 5 pass.
  - New export test in `reports.test.ts` (needs DB): CSV is neutralised, XLSX stores plain text
    and no formulas.
- tsc and eslint are clean. The full suite was not finished before this push.

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

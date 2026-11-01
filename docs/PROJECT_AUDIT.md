# Project audit — Phase 0

**Date:** 1 November 2026 · **Commit audited:** `cc7e74b` (main) · **Scope:** whole repository

## How this audit was done (and its limits)

Everything below comes from reading the code, tracing routes from the UI to the API and the
database, running scripts over the source tree, and running every test that works without a
database. Nothing here is copied from older docs without checking.

**Limits that matter:**

- This machine has **no MySQL and no `server/.env`**. So the 45 database-backed server test
  files, all 20 Playwright specs, k6 and Lighthouse **could not be run in this audit**.
- **Test results from this audit:**
  - TypeScript: clean for both frontend and server.
  - Production build: succeeds.
  - Frontend unit tests: 75/75 pass.
  - Server tests: 308 pass. The rest fail only with `ECONNREFUSED`, meaning they had no
    database to connect to.
- The live deployment (Vercel, Render, Aiven) was **not** tested from here.

Anything that depends on the things above is marked **Not verifiable** in
`FEATURE_COMPLETION_MATRIX.md`. It is not marked "working".

---

## 1. Size and shape

| | Frontend (`src/`) | Backend (`server/src/`) |
|---|---|---|
| Lines of TypeScript | ~33,900 | ~22,300 |
| Structure | `pages/` (by role), `components/` (incl. `ui/` design system, 23 files), `lib/` (33 files) | 31 feature modules under `modules/`, plus `db`, `email`, `jobs`, `storage`, `middleware`, `utils` |
| API routes | — | **273** |
| Tests | 9 unit-test files (75 cases) | 52 test files (674 cases) + 20 Playwright specs (67 `test()` blocks; earlier runs reported 111 cases because of parametrised viewports) |

The test counts in the brief (570 / 31 / 110) are out of date. The real numbers are above.

## 2. Strengths, confirmed by inspection

These are solid and should be **kept**, not rewritten:

- **Strict TypeScript everywhere.** Only 3 uses of `any`, and no `@ts-ignore`,
  `@ts-expect-error` or `@ts-nocheck`.
- **No dead code worth mentioning.** An import-graph walk from `main.tsx` / `server.ts` finds
  exactly **one** unreachable frontend file (`src/components/LinkifiedText.tsx`) and **zero**
  unreachable backend files. Every dependency in both `package.json` files is used.
- **SQL injection: none found.**
  - Every query uses `?` placeholders.
  - The dynamic `UPDATE … SET ${assignments}` builders (auth, conferences, committees,
    speakers, announcements) only take column names from hard-coded lists.
- **Authorisation is consistently applied.**
  - All 273 routes were scanned. The 21 without an auth guard are all meant to be public:
    login and reset, the public programme / ICS / PDF, certificate verification, the public
    abstract book, platform settings, and the suggestion box.
  - Each public endpoint was checked: it only returns published or released data.
- **Defences against a cross-site request forgery (CSRF):**
  - The session cookie is `SameSite=Lax`, `httpOnly`, and `secure` in production.
  - A global `Origin` check rejects cross-origin writes.
  - "View-as" mode is read-only, and the server enforces that.
- **Uploads are checked by their content.** `file-type` reads the file's actual bytes rather
  than trusting the extension. Images are re-encoded with `sharp`, which also strips EXIF data.
  Size limits are enforced by `multer`.
- **Private files are only served through authorised routes.** Submission files go through an
  author / `submission.read_all` / assigned-reviewer check. Certificates and abstract books also
  have guarded download routes.
- **Database integrity is enforced in MySQL itself.**
  - Triggers stop room, presenter and chair double-booking and overlapping talks.
  - CHECK constraints, unique keys and foreign keys back this up.
  - 153 code paths use `withTransaction`.
  - 141 code paths write to the audit log, and the audit log is append-only (triggers block
    changes to it).
- **The email pipeline is robust.**
  - Emails move through `queued → sending → sent / failed`.
  - Failures retry up to 5 times with exponential backoff.
  - Emails stuck in "sending" are recovered.
  - The Brevo daily quota is respected.
- **Conference isolation.** Since `53af871`, every sign-in session is bound to one conference.
  A central guard returns 403 for requests about another conference's data.

---

## 3. Findings

Severity: **Critical** = data loss or a security/privacy breach in production. **High** = a
broken promise to users, or a likely incident. **Medium** = a correctness or maintainability
problem. **Low** = tidy-up.

### Critical

**C1. Every uploaded file on the live site is deleted on each deploy or restart.**
- **Cause:** `render.yaml` uses `plan: free` with `STORAGE_DIR: ""`. Render's free plan has no
  persistent disk, so `server/storage/` is wiped every time the service redeploys or restarts.
- **What's affected:** conference logos and banners, submission PDFs (private), certificate
  PDFs, signature images, certificate backgrounds and abstract books.
- **Consequence:** the database still points at files that no longer exist, so downloads 404.
  Pushes to `main` redeploy automatically, so **files uploaded before the last few deploys are
  very likely already gone.**
- **Fix:** see `REFACTORING_PLAN.md`, decision D1.

**C2. The live database may be behind the live code.**
- `main` contains per-conference sign-in, which needs `auth_sessions.conference_id`, and the
  batch-3 features, which need their tables.
- If `database/2026-11-01/2-AIVEN-run-this.sql` hasn't been run on Aiven, live sign-in and
  those features fail.
- I can't check this from here. **The owner needs to confirm it.**

### High

**H1. Double-blind review can leak author identity through files.**
- `getDownloadableFile` (`server/src/modules/submissions/files.service.ts:171`) gives reviewers
  the paper under its **original filename**, which is often something like
  `Sharma_final_paper.pdf`.
- The author fields inside PDF/DOCX files are **not removed** either.
- Reviewers should get a neutral filename such as `S-0123-paper.pdf`. Stripping the document
  metadata should also be considered.

**H2. Scheduled work stops while the server sleeps.**
- The email worker, scheduled announcements, review reminders and session cleanup run as
  in-process timers (`server/src/server.ts`).
- On Render's free plan the service sleeps after about 15 minutes without traffic. While it's
  asleep, scheduled announcements aren't published and reminders aren't sent.
- This is fixed by the same decision as C1 (an always-on instance, or an external cron ping).

**H3. Two features have database tables but no code at all.**
- `registration_categories` / `registration_fees` (including a fee-window overlap trigger) and
  `payments` / `payment_webhook_events` exist in `01_schema.sql`.
- No server or client code uses them. The only reference is the table list in
  `scripts/doctor.ts`.
- Registration currently has no categories or fees, and payment is a manual "confirm" step.
  The brief lists "Registration categories" as required.

**H4. No ESLint at all.**
- There's no ESLint config in either package, yet the code contains 22 `eslint-disable`
  comments.
- Unused imports, hook-dependency mistakes and similar problems are only caught by `tsc`, which
  misses most of them.

### Medium

**M1. Timezone handling is inconsistent.**
- Storage is correct (UTC, with `timezone: 'Z'` and `SET time_zone = '+00:00'`), and
  conferences have a `timezone` column.
- But "today" is calculated in UTC in about 10 places:
  - analytics date ranges (client and server)
  - dashboard due-date ranges
  - `AutoAssignTab`, `SubmissionDetailPanel`
  - the certificate and abstract-book issue dates (`timeZone: 'UTC'`)
- Between 00:00 and 05:45 Nepal time these show **yesterday's date**.
- About 6 screens show times in the browser's local timezone (`toLocaleString()` with no time
  zone) instead of Asia/Kathmandu: the email log, the announcements schedule, submission
  history, and others. A helper (`formatKathmandu`) already exists but isn't used
  consistently.

**M2. Email delivery confirmation doesn't exist.**
- `email_logs.status` allows `delivered` and `bounced`, but nothing ever sets them because
  there's no Brevo webhook.
- The interface correctly says "sent", not "delivered". But the brief asks to distinguish
  provider-confirmed delivery, and that isn't possible today.

**M3. The frontend has no security headers.**
- `vercel.json` sets no Content-Security-Policy, `X-Frame-Options`/`frame-ancestors`,
  `Referrer-Policy` or `Permissions-Policy` for the app's HTML.
- Helmet's strict CSP only covers API responses.

**M4. Validation is written twice.**
- `src/lib/validation.ts` (814 lines) re-implements the server's Zod schemas by hand. Phone
  normalisation, colour, layout and other rules exist in both places and drift apart over
  time.
- The server stays authoritative, so this is a maintainability problem, not a security one.

**M5. Some files are very large.** They mix layout, data loading and several sub-features in
one file:

| File | Lines |
|---|---|
| `SuperAdminPage.tsx` | 1,875 |
| `ProgrammeTab.tsx` | 1,419 |
| `HomePage.tsx` | 998 (but the homepage must not change) |
| `SubmissionDetail.tsx` | 921 |
| `CertificatesTab.tsx` | 866 |
| `schedule/service.ts` | 1,273 |
| `reviews/service.ts` | 1,164 |
| `admin/service.ts` | 986 |

**M6. Design tokens have duplicates and an extra font.**
- `index.css` has two names for the same thing in several places: `ink`/`text`,
  `background`/`page-bg`, `line`/`border`.
- The button indigo is `#4F5FC0` while the brand indigo is `#5969C9`.
- A third font, **IBM Plex Sans**, is loaded and used by some legacy classes, alongside Inter
  and Source Serif 4.

**M7. The platform role model is thinner than the brief.**
- Platform roles are `admin` and `organizer`. Nothing uses `organizer` except the seed data.
- There's no separate "super admin" versus "platform admin" distinction. The brief asks for
  both, so this needs a decision (D4).

**M8. `public/logo.png` is 1.4 MB.**
- The image is only 384×256 pixels and appears in the header of every page.
- It's the easiest fix for the signed-in LCP problem (2.78 s against a 2.5 s target).
- `public/video/product-video-web.mp4` (5.8 MB) is fine, provided it stays lazy-loaded.

### Low

**L1. One unused component.** `src/components/LinkifiedText.tsx` has no imports or
references anywhere.

**L2. Repository history holds 41 MB of zip files.**
- `server.zip` (41 MB) and two other zips are deleted from the working tree but still in git
  history, which makes `.git` 50 MB.
- Removing them means rewriting history and force-pushing, so it **needs owner approval**.
  It's optional.

**L3. Docs sprawl.**
- `docs/` holds 39 files.
- About 20 of them are old task prompts or per-phase notes (`finish-*`, `phase*`,
  `features-batch-*`, `convenor-a-portal (1).md`).
- There are **three** overlapping deployment guides (`deploy.md`, `deploy-guide.md`,
  `deploy-render-vercel-aiven.md`).

**L4. Placeholder HTML comments in the legal pages.**
- `PrivacyPage` and `TermsPage` inject an HTML comment through `dangerouslySetInnerHTML`.
  It's harmless, but a plain JSX comment would do.
- Both pages are templates that **haven't been reviewed by a lawyer**.

**L5. Machine-specific path in the Playwright config.** `playwright.config.ts` hard-codes
`C:\Users\ADMIN\...\chrome.exe`. It's harmless (only used if that file exists), but it's
machine-specific.

**L6. Silently ignored errors.**
- Seven `.catch(() => {})` calls ignore errors.
- They're all non-critical (mark as read, fullscreen, wake-lock, suggestion refresh), and
  `ForgotPasswordPage` does it on purpose to avoid revealing which emails exist.
- Acceptable, but each one should have a short comment explaining why.

---

## 4. Brief checklist (20 items)

| # | Item | Result |
|---|---|---|
| 1 | Duplicated code | Client/server validation (M4); a few per-tab fetch patterns. No large copy-paste. |
| 2 | Unused components | 1 (L1) |
| 3 | Dead routes | None found. All 25 frontend routes and 273 API routes are reachable. |
| 4 | Unused dependencies | None |
| 5 | Conflicting implementations | Duplicate design tokens and a third font (M6) |
| 6 | Inconsistent naming | Minor (token aliases). Module naming is consistent. |
| 7 | Unnecessary abstractions | None significant |
| 8 | Overly large components | M5 |
| 9 | Repeated API logic | Low. `src/lib/api.ts` centralises fetch, errors, caching and slow-request tracking. |
| 10 | Broken state management | None found by inspection. Not runtime-verified. |
| 11 | Inconsistent validation | M4 |
| 12 | Security weaknesses | H1, M3. C1 is a data-loss weakness. |
| 13 | Incomplete features | H3 (registration categories/fees, payments), M2 (delivery status) |
| 14 | Non-functional buttons | Not verifiable without a running app. Will be checked in Phase 10. |
| 15 | Incorrect permissions | None found statically. `routeGuards.test.ts` and `security.test.ts` exist but need a database. |
| 16 | Poor error handling | Central `next(err)` → error middleware; `ApiError` on the client. L6 is minor. |
| 17 | Unnecessary files | L1, L2, L3 |
| 18 | Performance bottlenecks | M8 (logo). The scheduled-job design (H2). |
| 19 | Inconsistent UI patterns | Older one-off controls not yet moved to `components/ui` (documented in Step 7) |
| 20 | Missing tests | Frontend component tests are thin (9 files). No automated test checks PDF layout. |

## 5. Things the owner must decide or do (cannot be done from code)

1. **D1 — persistent file storage** (C1). See the plan.
2. Confirm the Aiven SQL has been run (C2).
3. Provide `server/.env` and a local MySQL, so the database tests and end-to-end tests can run.
4. A real backup → restore drill, a real Brevo email test, production secrets, and
   UptimeRobot. These are carried over from `production-readiness.md`.

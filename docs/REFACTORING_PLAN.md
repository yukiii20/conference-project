# Refactoring and transformation plan

**Status: proposal — waiting for owner approval.** Nothing in this plan has been started.
It's based on `PROJECT_AUDIT.md`. Finding IDs (C1, H1, M4 …) refer to that file.

## Guiding principles

1. **Fix what loses data or breaks trust before anything cosmetic.**
2. **Small, reviewable steps.**
   - One commit per logical change, pushed to `main`.
   - Each phase ends with typecheck, build and tests, and an entry in
     `IMPLEMENTATION_PROGRESS.md`.
3. **No rewrite for its own sake.** The codebase is already well organised (see the audit's
   "Strengths"). We split files only where they're genuinely too big, and add libraries only
   with a stated reason.
4. **Never:**
   - edit historical SQL
   - touch production data
   - redesign the homepage
   - weaken a test

   Every schema change is a new, re-runnable SQL file in a dated folder, with verification
   queries and rollback notes.
5. **Every claim of "done" has evidence attached.**

---

## Decisions needed from the owner before or during Phase 1

| # | Decision | Options | My recommendation |
|---|---|---|---|
| **D1** | Where uploaded files live in production (audit C1) | **(a)** Render Starter plan + persistent disk: no code change, and it also keeps the server awake (fixes H2). About US$7/month + US$0.25/GB. **(b)** Cloudflare R2 (S3-compatible, 10 GB free): new `@aws-sdk/client-s3` dependency, plus a storage adapter, plus a migration. Keeps Render free, but H2 still needs a cron. **(c)** Cloudinary: images only, doesn't suit private PDFs. | **(a)** if a small monthly cost is fine: simplest and safest. Otherwise **(b)**. |
| **D2** | Registration categories, fees and online payment (audit H3) | **(a)** Build categories and fees (tables already exist) with manual payment confirmation. **(b)** Also add an online payment gateway (eSewa / Khalti / Stripe): a large piece of work that needs merchant accounts. **(c)** Leave them out and drop the unused tables from the docs. | **(a)** now. **(b)** only if you have a merchant account. |
| **D3** | Provider-confirmed email delivery (audit M2) | Add a Brevo webhook endpoint (signed) that sets `delivered` / `bounced`, or keep "sent" as the final state | Add the webhook. It's small, and needs one setting in the Brevo dashboard. |
| **D4** | Super admin vs platform admin (audit M7) | **(a)** Add a `super_admin` platform role (only a super admin can create or remove platform admins and change platform settings). **(b)** Keep one admin level. | **(a)**. It needs a new SQL file (role + permissions seed). |
| **D5** | Remove the 41 MB zip from git history (audit L2) | Rewrite history + force-push (everyone re-clones), or leave it | Leave it unless repo size bothers you. It's harmless now. |
| **D6** | ESLint (audit H4) | Add ESLint (typescript-eslint + react-hooks) to both packages | Yes. It's development-only and catches real bugs. |
| **D7** | Old docs (audit L3) | Move about 20 old prompt/phase docs to `docs/archive/`, and merge the three deploy guides into one | Yes. Archive them, don't delete. |

---

## Phase 1 — Critical fixes and cleanup

**Goal:** stop data loss and the privacy leak, and remove verified clutter. No visual changes.

1. **C1 storage**, according to D1.
   - (a): update `render.yaml` and the deploy guide, and set `STORAGE_DIR` to the disk mount.
   - (b): build a storage adapter (local + S3), with tests for both paths and a one-off upload
     script.
   - Either way, add a health-check line that reports where storage lives.
2. **H1 double-blind.**
   - Reviewer downloads get a neutral filename (`<submission_code>-<kind>.<ext>`).
   - Strip the author fields from PDF metadata (the `Info` dictionary) when serving to
     reviewers.
   - Add a server test that fails if a reviewer download contains the original filename.
3. **H2 jobs.** Either the D1(a) always-on instance, or a protected `/api/internal/tick` and a
   free external cron. Document it.
4. **M1 time zone.**
   - Add a `todayIn(tz)` helper (client and server).
   - Replace the ~10 UTC "today" calculations.
   - Route every visible date/time through `formatKathmandu` (or the conference time zone).
   - Certificate and abstract-book dates use the conference time zone.
   - Add unit tests at 23:59 UTC (05:44 the next day in Nepal).
5. **M8** — recompress `public/logo.png`: same pixels, about 20 KB. Re-measure portal LCP.
6. **L1** — delete `LinkifiedText.tsx` (verified unreferenced).
7. **M3** — add security headers for the SPA in `vercel.json`: CSP, `frame-ancestors`,
   Referrer-Policy and Permissions-Policy. Test it against the homepage, the video, Google
   Fonts and the certificate preview (`blob:` iframe).
8. **D6 / D7** if approved: ESLint config (fix or justify what it finds), and archive the old
   docs.

**Done when:**
- Every reviewer download is anonymised (test).
- Dates are correct around midnight Nepal time (tests).
- Storage survives a Render redeploy (manual check on the live site).
- Typecheck, build and all available tests pass.

## Phase 2 — Shared systems and architecture

- **M4** — add a schema-parity test (the client and server schemas accept and reject the same
  sample payloads).
- **M6** — merge the duplicate design tokens into one set:
  - ink/text, background/page-bg, line/border
  - one indigo (`#5969C9` brand; a darker shade for button hover/active)
  - remove IBM Plex Sans

  Visual check before/after on every portal. **The homepage must look identical.**
- **M5** — split the oversized files into `features/…` (see `ARCHITECTURE.md` B1):
  `SuperAdminPage`, `ProgrammeTab`, `SubmissionDetail`, `CertificatesTab`, and the server
  services `schedule` / `reviews` / `admin`. Pure moves first (no behaviour change, tests
  green), then any improvements.
- Fill the gaps in the component system: date picker, drawer, status timeline, activity feed.
  Only where a screen actually needs one, and reusing `components/ui`.

## Phase 3 — Authentication and permissions (needs a database)

- Run the whole server suite and Playwright with a database. Record the real numbers.
- Build a role × action matrix test. `docs/role-matrix.md` exists, so turn it into tests: each
  role is allowed what it should be and gets 403 on what it shouldn't, through the API.
- D4 super admin role, if approved (new SQL file + seed + tests).

## Phase 4 — Public pages and conference integrity

- The homepage stays visually unchanged. Verify every link, the conference page, the
  per-conference sign-in, public programme, verification page, and SEO meta.
- Legal pages: replace the HTML-comment hack (L4). Flag again that they need a lawyer's
  review.

## Phase 5 — Academic workflow

- One end-to-end test for the whole journey in brief §28, steps 1–12 (register → … →
  camera-ready).
- Check every submission status transition against the triggers, with a test for each
  forbidden transition.
- Auto-assign: confirm that conflicts, capacity and bids are respected, and that the
  explanation text is shown (tests exist; extend them).

## Phase 6 — Conference operations

- D2(a): registration categories and fees (UI + API + tests, using the existing tables and
  trigger).
- End-to-end test for §28 steps 13–19 (programme publish → ticket → QR check-in → certificate
  → public verification), including "revoked shows invalid".
- An automated certificate PDF test: page size A4 landscape, name text present, nothing drawn
  outside the frame (parse the PDF).

## Phase 7 — Communication and analytics

- D3: Brevo webhook (signature-verified) → `delivered` / `bounced`. The email log interface
  shows the four states clearly.
- Check that report exports match their filters (tests). Empty and error states on every
  chart.

## Phase 8 — Premium UI/UX across the portals

This is the largest phase. It's done **screen by screen**, each with:

- a one-line statement of the user's goal and primary action
- before/after screenshots at 375 px and 1440 px
- no fake buttons, and no decorative cards without a purpose

Order:

1. Convenor dashboard and Papers (most used)
2. Reviewer
3. Author
4. Staff check-in
5. Session chair
6. Manager
7. Super admin
8. Shared portal

Design direction:

- the existing palette (navy `#101C32`, ivory `#F7F5F0`, indigo `#5969C9`, gold `#D9B982`)
- Inter for the interface, Source Serif 4 for editorial headings
- information hierarchy influenced by Linear and Stripe, but **not copied**

## Phase 9 — Security and performance

- Re-run `npm audit` (9 moderate issues remain, all inside `exceljs`; see
  `IMPLEMENTATION_PROGRESS.md`).
- Run Lighthouse on the live domain and the k6 load test. Fix regressions.
- Review rate limits on every write route that doesn't have one.

## Phase 10 — Full QA

- All suites green, or pre-existing failures documented with their cause.
- A manual pass of every screen at 320, 375, 390, 768, 1024, 1280 and 1440 px.
- Keyboard-only pass and a screen-reader spot check.

## Phase 11 — Production readiness and handover

- One deployment guide (merging the three), a deploy checklist, the SQL run order, and a
  backup + restore drill (with the owner, using real credentials).
- **No production deploy or production data change without explicit approval at that
  moment.**

---

## What I need to continue

1. Answers to **D1–D7** (a short reply is enough, e.g. "D1 a, D2 a, D3 yes …").
2. Confirmation that `database/2026-11-01/2-AIVEN-run-this.sql` has been run on Aiven.
3. A local MySQL + `server/.env` (from `server/.env.example`). Without them, Phases 3, 5, 6 and
   10 can't be verified.

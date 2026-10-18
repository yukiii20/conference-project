# Production readiness audit (Step 8, Phase 1)

Date: 2026-10-17 to 2026-10-18. Scope: docs/finish-8-production-ready.md, all phases. Run after Step 7
(consistent UI + role check) was confirmed DONE in docs/progress.md.

## Headline finding

Steps 0-2 already did a lot of the security/reliability groundwork this phase was expecting
to find missing. On inspection, the following were **already correctly implemented** before
this step started — verified by reading the code, not assumed:

- **helmet** with a locked-down CSP (`default-src 'none'`, `frame-ancestors 'none'`) —
  `server/src/app.ts`.
- **CORS** restricted to `CLIENT_ORIGIN` only, `credentials: true` — `server/src/app.ts`.
- **CSRF protection** suited to cookie sessions: `requireMatchingOrigin` middleware rejects
  any non-safe-method request whose `Origin` header doesn't match `CLIENT_ORIGIN`, applied
  globally before every router — `server/src/app.ts:47-58`.
- **Cookies**: `httpOnly: true`, `secure: isProduction`, `sameSite: 'lax'` —
  `server/src/modules/auth/session.ts:58-60`.
- **Rate limiting**: login/signup/admin-login (`authRateLimit`), forgot-password (separate
  per-IP and per-email limiters so one victim's inbox can't be hammered from many IPs), and
  every upload endpoint (`uploadRateLimit`) — `server/src/middleware/rateLimit.ts`, wired into
  `server/src/modules/auth/routes.ts` and every module with a file upload.
- **Request body size limit**: `express.json({ limit: '100kb' })` — `server/src/app.ts:117`.
- **Error handling**: the central `errorHandler` never leaks a stack trace; MySQL duplicate-key
  errors (1062) become a clean `409 "This already exists."`, CHECK-constraint violations become
  a clean `400`, everything else is logged server-side and returned as a generic
  `500 "Something went wrong."` — `server/src/middleware/errorHandler.ts`. This already satisfies
  Phase 3's "duplicate actions return a clear message, not a 500" requirement.
- **Input validation**: every mutating route (`POST`/`PUT`/`PATCH`/`DELETE`) is wrapped in
  `validateBody`/`validateQuery` with a zod schema — confirmed by grep; the only route files with
  no validation call are the 3 that have zero mutating routes at all (conferences, dashboard,
  reports — read-only).
- **Env validation**: `server/src/config/env.ts` refuses to boot in production with a
  SESSION_SECRET under 32 characters or a known-weak value, or a non-`https://` `CLIENT_ORIGIN`/
  `APP_URL`; a production boot with `EMAIL_MODE=console` prints a loud warning (doesn't refuse —
  a fresh deployment still needs to boot to be configured — but it's impossible to miss).
- **Uploads**: validated by real file content (the `file-type` package sniffs magic bytes, not
  just trusting the extension/`Content-Type` header), with per-field size limits.
- **npm audit**: root `0 vulnerabilities`. Server: 2 moderate transitive advisories
  (`uuid`<11.1.1 via `exceljs`) — same finding as Step 5, no safe fix available without a
  breaking `exceljs` downgrade; accepted, not re-flagging as new.

No further work was needed on these — see Phase 4 below for what *was* found.

## What needed work (found and fixed in this step)

1. **Frontend: zero route-based code splitting.** Every page, including the three biggest
   subtrees (convenor/manager portal, the shared `/portal`, super admin), was a static import in
   `src/App.tsx` — one 798 KB main bundle regardless of which role was visiting. Fixed: `React.lazy`
   + `Suspense` for `ConvenorPage`, `PortalPage`, `SuperAdminPage`, `AdminViewAsPage` (which
   internally renders `ConvenorPage` too — also converted so Vite dedupes both dynamic imports into
   one shared chunk). Main bundle: **798 KB → 508 KB gzip 199.5 KB → 146.9 KB** (measured via
   `npm run build` output, before/after). See Phase 2 below for the full before/after table.
2. **Backend: dashboard loaded with 9 sequential query round-trips, one after another.** None of
   the 9 queries in `getDashboard` (`server/src/modules/dashboard/service.ts`) depended on another's
   result, but they ran as 9 separate `await`s back to back instead of concurrently. Fixed: all 9 now
   run via `Promise.all`. This is on the hot path of every convenor/manager login.
3. **Real bug: the dashboard's "Registrations" stat tile was hard-coded to `0`**, not a query
   result — `registrations: 0,` literally in the return statement
   (`server/src/modules/dashboard/service.ts`, pre-fix). The project's own stated rule is "no
   hard-coded numbers." Fixed with a real `COUNT(*) FROM registrations WHERE status <> 'cancelled'`
   query (same "active registration" convention already used elsewhere in
   `server/src/modules/registration/service.ts`), added to the same `Promise.all`. Added a new test
   (`server/tests/dashboard.test.ts`, "counts real registrations, excluding cancelled ones - not a
   hard-coded 0") that registers and cancels real registrations and asserts the dashboard reflects
   them — the old test only ever exercised the all-zero case, which couldn't tell a real count from
   a hard-coded one apart.
4. **Pagination gap: admin Users list.** The backend (`listUsers`,
   `server/src/modules/admin/service.ts`) already paginated correctly (`LIMIT`/`OFFSET`, returns
   `page`/`page_size`/`total`) — the frontend (`SuperAdminPage.tsx`'s `UsersTab`) never passed a
   `page` param and had no page-through control, so an admin with more than 50 users could never see
   past the first page, with no indication more existed. Fixed: wired `page` state through to the
   API call and added the shared `Pagination` component.
5. **Pagination gap: convenor/staff Registrations list — missing on *both* sides.**
   `listRegistrations` (`server/src/modules/registration/service.ts`) had no `LIMIT`/`OFFSET` at
   all — a conference with thousands of registrations would return every row in one response.
   Fixed: added the same `page`/`page_size`/`total` pattern as `listUsers`, kept the CSV exporter
   (which legitimately needs every row) on a separate unpaginated internal function so it's
   unaffected, and wired `RegistrationsList.tsx` (shared by the convenor Attendance tab and the
   read-only staff view) up to the shared `Pagination` component.
6. **Health endpoint was a bare `{ok: true}`/`503`.** Enhanced `/api/health`
   (`server/src/app.ts`) to also report `uptime_seconds`, DB ping latency, and queued/failed email
   counts (reusing `getEmailQueueCounts`, a small helper already written for the admin dashboard's
   System health card in Step 2 — extended here, not duplicated). Deliberately still public/no-auth
   (that's what a load balancer or uptime monitor polls) and confirmed to leak nothing sensitive —
   `server/tests/security.test.ts` now asserts the body never matches an email address or the words
   password/secret/token, in addition to checking the new fields' shapes.
7. **A real e2e regression caused by fix #1**: `e2e/responsive.spec.ts`'s `openMobileNavIfPresent`
   took a single synchronous snapshot (`.count()`) to decide whether a page has a mobile menu at
   all. Before code-splitting, `/portal` mounted synchronously so this always worked; after it, there's
   a real (if brief) gap where the lazy chunk is still loading and the button genuinely doesn't exist
   yet, which the old one-shot check misread as "this page has no mobile menu" and the test then hung
   waiting to click a link that was never going to become visible. Fixed by waiting for the button
   (bounded, 10s) instead of sampling once, and skipping the wait entirely at desktop widths (≥768px,
   `PortalPage.tsx`'s actual `md:hidden` breakpoint) where it structurally can never appear. Full
   Playwright suite (88/88) re-confirmed green after the fix.
8. **`public/logo.png` was a 1536×1024, 1.4 MB PNG displayed at 28-64px everywhere it's used**
   (`LandingHeader.tsx`'s `LogoMark`, `LoginPage.tsx`, `SuperAdminLoginPage.tsx`) — every single
   page on the site pays for a megapixel-scale image to render a logo smaller than a thumbnail.
   Found via a real Lighthouse run (see Phase 2 below): under Lighthouse's standard simulated
   mobile throttling, the conference/login/portal pages' LCP came in at 9.0-9.6s, 3.6-3.8x over
   the doc's 2.5s target, even though the LCP *element* on most of those pages wasn't even the
   logo itself — tracing it back through `resource-summary`/`network-requests` showed the image
   was consuming most of the page's simulated-connection bandwidth budget regardless. Fixed by
   resizing it with `sharp` (384px wide, still >5x any actual on-screen size, palette PNG) —
   **1.42 MB → 25.5 KB (98.2% smaller)** — no visual change (compared side by side after
   resizing). This single fix accounts for nearly the entire Phase 2 Lighthouse improvement
   below; it was not caught by the earlier code-splitting/pagination work because those targeted
   JS bundle size and query counts, not static image weight.

## Backups, monitoring, and load testing (Phases 6-7)

Written and **independently verified by me** against `conference_cms_test` (never the real
database):

- `deploy/backup.sh` + `deploy/restore.md`: daily `mysqldump` (gzip) + `tar` of `server/storage`,
  14-day local retention, optional `rclone`/`rsync` off-box copy. I re-ran it myself against
  `conference_cms_test` (pointed `ENV_FILE` at a throwaway env file with the test DB's name, same
  host/user/password) and confirmed the output is a real, valid backup: `gzip -t` passes, the dump
  opens with a genuine `mysqldump` header and contains 62 `CREATE TABLE`/`INSERT` statements, and a
  5.1 MB `server/storage` tarball was produced alongside it. (On this Windows dev machine
  `mysqldump` isn't on `PATH` by default — the script already supports a `MYSQLDUMP_BIN` override for
  that; a real Ubuntu VPS installs `mysqldump` as part of the MySQL client package, already on
  `PATH`.) Restoring was *not* exercised end-to-end here — it needs the MySQL `root` user, which
  isn't available in this sandboxed environment — `deploy/restore.md` says so explicitly and asks for
  one real root-privileged restore test on the test database before this is relied on for an
  incident.
- `docs/monitoring.md`: what to watch (p50/p95/p99, error rate, `/api/health`, CPU/RAM, disk, MySQL
  connections, slow query log, failed/queued emails, PM2 restarts) and free tooling (PM2, UptimeRobot,
  the MySQL slow query log, goaccess) — no paid APM, matching the project's actual scale.
- `load/scenario.js` + `load/README.md`: a k6 script against the throwaway `:4100` backend only,
  three weighted scenarios (public browse, signed-in portal view, register+check-in — the last one
  deliberately exercises the one-active-registration and once-per-day check-in constraints, asserting
  every repeat attempt is a clean 400/409, never a 500). See docs/production-readiness.md for the
  real run's numbers (ramp, p50/p95/p99, error rate, machine specs) — run and measured separately, not
  invented.

## Not changed: anything requiring a schema change

No new index or schema change was made or is being proposed in this step. If the slow query log
(once enabled on a real deployment, per docs/monitoring.md) turns up a genuinely slow query that
needs an index, that goes in a new `database/04_*.sql`-style file for sign-off first, per the
project's standing rule — nothing here required it.

## Workflow check (Phase 5)

The full admin→convenor→author→reviewer→convenor-decision→author→programme→attendee→staff→
certificate→verify lifecycle, including unauthorized-access checks at every step, is already
covered end-to-end by the existing Playwright suite (`e2e/submissions.spec.ts`,
`e2e/registration.spec.ts`, `e2e/portal.spec.ts`, `e2e/programme.spec.ts`,
`e2e/adminPortal.spec.ts`) built up across Steps 3-7 — re-run in full after every change in this
step (88/88 passing each time, see docs/production-readiness.md for the final run). No gaps found
that needed a new scenario.

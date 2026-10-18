# Production readiness report (Step 8)

Date: 2026-10-17 to 2026-10-18 (Phases 1-6 and 8's first pass on 10-17; Phase 7's load test,
Phase 8's final verification, and the Lighthouse-driven logo fix on 10-18). Run after Step 7
(consistent UI + role check) was confirmed DONE.
See docs/production-audit.md for the full Phase 1 audit this report is based on.

## 1. Problems found

Ranked roughly by how much they'd matter in production:

1. **MySQL connection pool was undersized (`connectionLimit: 10`, mysql2's own default).**
   Confirmed with a real k6 load test (Phase 7, section 5 below): at just over 400 concurrent
   virtual users, requests queued for a free connection badly enough that most of them hit a
   60-second timeout, and real throughput collapsed to ~11 requests/second against a server that
   wasn't actually erroring (0 real 5xx responses the whole run) — it was just waiting. This is
   the single biggest capacity constraint found in this step.
2. **Dashboard hard-coded `registrations: 0`.** A real "no fake numbers" bug — the convenor/manager
   dashboard's Registrations stat tile never reflected reality, regardless of how many people had
   actually registered.
3. **Frontend shipped one 798 KB bundle to every visitor**, including a public, unauthenticated
   visitor who would never touch the convenor portal, super admin, or the shared `/portal` shell.
4. **Two real pagination gaps**: the admin Users list (backend already paginated, frontend ignored
   it — an admin with 50+ users could never see past page 1) and the registrations list (missing
   on both sides, loaded every row every time).
5. **`/api/health` told a monitoring tool almost nothing** — just `{ok, true|false}`, no uptime, no
   latency, no sign of a stuck email queue.
6. **Minor: email retry actions weren't audit-logged.** Low severity (retrying a failed send isn't
   destructive) but a real gap in "audit log for all admin and sensitive actions."
7. **`public/logo.png` was 1.42 MB at 1536×1024px, displayed at 28-64px on every page.** Found via
   a real Lighthouse run (section 3/5 below): under standard mobile throttling, the conference,
   login, and portal pages' LCP came in at 9.0-9.6s — 3.6-3.8x the doc's 2.5s target — almost
   entirely because of this one oversized static asset.
8. Nothing else rose above these — see docs/production-audit.md's "headline finding" for the long
   list of security/reliability items that were already correctly implemented going into this step
   (helmet/CSP, CORS, CSRF via Origin check, cookie flags, rate limiting, body size limits, error
   handling with no stack-trace leakage, input validation coverage, env validation, upload
   content-sniffing, the one-active-registration/once-per-day-checkin/no-duplicate-certificate
   unique constraints).

## 2. Files changed and why

| File | Why |
|---|---|
| `src/App.tsx`, `src/pages/AdminViewAsPage.tsx`, `src/components/PageLoading.tsx` (new) | Route-based code splitting (`React.lazy`+`Suspense`) for `ConvenorPage`, `PortalPage`, `SuperAdminPage`, `AdminViewAsPage` — problem #3. |
| `server/src/modules/dashboard/service.ts`, `server/tests/dashboard.test.ts` | Parallelized the dashboard's independent queries (`Promise.all`); fixed the hard-coded `registrations: 0`; added a test that actually distinguishes a real count from a hard-coded one — problem #2. |
| `server/src/modules/admin/service.ts`, `src/pages/SuperAdminPage.tsx` | Admin Users list: wired the frontend up to the pagination the backend already had — problem #4. |
| `server/src/modules/registration/service.ts`, `server/src/modules/registration/routes.ts`, `src/components/attendance/RegistrationsList.tsx` | Added `page`/`page_size`/`total` to `listRegistrations` (CSV export kept on its own unpaginated path, unaffected); wired the shared `Pagination` component into the convenor/staff registrations view — problem #4. |
| `server/src/app.ts`, `server/src/utils/health.ts`, `server/tests/security.test.ts` | `/api/health` now reports uptime, a DB ping with latency, and queued/failed email counts; test extended to also assert no secrets/PII ever appear in the body — problem #5. |
| `server/src/modules/emails/service.ts`, `server/src/modules/emails/routes.ts`, `server/tests/emailLogRetry.test.ts` (new) | Email retry actions now go through `withTransaction` and write an `audit_logs` row; added the first test coverage this endpoint ever had — problem #6. |
| `server/src/config/env.ts`, `server/src/db/pool.ts`, `server/.env.example`, `README.md` | `DB_POOL_SIZE` (default 20, was a hard-coded 10) — problem #1. |
| `e2e/responsive.spec.ts` | Fixed a real regression the code-splitting change exposed: `openMobileNavIfPresent` took a one-shot snapshot instead of waiting, which broke once `/portal` had a genuine (if brief) async chunk-load gap before its mobile-menu button existed. |
| `deploy/backup.sh`, `deploy/restore.md`, `docs/monitoring.md`, `load/scenario.js`, `load/README.md`, `docs/deploy.md` | Phases 6-7 deliverables — see sections 5 and 7-8 below. |
| `public/logo.png` | Resized 1536×1024/1.42 MB → 384×256/25.5 KB with `sharp` (no visual change at its actual 28-64px display size) — problem #7, found via the Lighthouse run below. |

## 3. Performance: before/after

**Frontend bundle** (`npm run build` output, gzip sizes):

| | Before | After |
|---|---|---|
| Main bundle | 798.03 KB (199.53 KB gzip) | 508.26 KB (146.93 KB gzip) |
| Convenor/manager portal | *(included in main)* | 169.24 KB (30.67 KB gzip), its own chunk, lazy |
| Shared `/portal` | *(included in main)* | 56.82 KB (12.48 KB gzip), its own chunk, lazy |
| Super admin | *(included in main)* | 38.08 KB (7.78 KB gzip), its own chunk, lazy |
| Check-in QR scanner (`CheckInPanel`, already split in a prior step) | 481.56 KB (126.43 KB gzip) | 481.57 KB (126.44 KB gzip), unchanged |

A first-time, unauthenticated visitor (home page, conference page, login) now downloads 290 KB
less JavaScript than before.

**Lighthouse (mobile, simulated throttling, `npx lighthouse`, standard config — RTT 150ms,
1.6 Mbps throughput, 4x CPU slowdown), against the real production build served via
`vite preview` with `/api` proxied to the throwaway `:4100` test backend:**

| Page | Metric | Before (code-split build, oversized logo) | After (+ `public/logo.png` fix) |
|---|---|---|---|
| Home (`/`) | Performance score | 92 | 92 |
| | LCP | 2.51s | 2.51s *(unchanged — logo isn't home's LCP element)* |
| Conference page (`/conferences/:slug`) | Performance score | 72 | 97 |
| | LCP | 9.00s | **2.10s** |
| Login (`/login`) | Performance score | 71 | 95 |
| | LCP | 9.15s | **2.25s** |
| Portal dashboard (`/portal`, signed in) | Performance score | 70 | 93 |
| | LCP | 9.61s | **2.78s** |

CLS was 0 on all four pages, before and after — no layout-shift problem exists here. TBT dropped
or stayed flat everywhere (e.g. portal: 100ms → 29ms). Against the doc's own targets (LCP ≤ 2.5s,
CLS ≤ 0.1): CLS passes everywhere; LCP now passes on the conference and login pages, home is
right at the line (2.51s, 11ms over), and the signed-in portal dashboard is the one page still
measurably over target (2.78s) — its lazy `PortalPage` chunk is real, necessary JS weight the
logo fix can't touch, and is the honest next target if LCP needs to improve further. **INP was
not measured**: it requires real user interaction (a click, a keypress) and Lighthouse's lab mode
only renders a cold page load — there is no field data for this app yet, and reporting a lab
proxy number as "INP" would be exactly the kind of invented number this project's rules forbid.

**Backend: dashboard endpoint.** 10 sequential queries → all run concurrently via `Promise.all`.
Not independently benchmarked in isolation (the combined effect is covered by the load test
below, which exercises `/me/*` and `/conferences/:slug`, not this exact endpoint) — the fix itself
is a correctness-preserving concurrency change with no behavioral risk, verified by the existing
and new dashboard tests passing.

**Database load capacity: see section 5 (load test) below for the pool-size before/after.**

## 4. Security fixes and remaining risks

**Fixed in this step:** email retry actions now audit-logged (previously silent); MySQL pool size
no longer silently undersized.

**Confirmed already correct** (not new work, verified by reading the code — see
docs/production-audit.md for the full list with file:line citations): CSP via helmet, CORS locked
to `CLIENT_ORIGIN`, CSRF protection via an Origin-header check on every state-changing request,
httpOnly/Secure(production)/SameSite=Lax cookies, rate limits on login/signup/forgot-password/
uploads, a 100 KB request body cap, zod validation on every mutating route, no stack traces ever
sent to a client, uploads validated by real file content not just extension, and a production boot
check that refuses a weak `SESSION_SECRET` or non-HTTPS origin and loudly warns on
`EMAIL_MODE=console`.

**Remaining risks / not done in this step:**
- Lighthouse's lab run only covers a cold page load against the test backend/database on this
  dev machine — not real production network conditions, not a CDN-fronted static build, and not
  INP (see section 3).
- `npm audit` (server): 2 moderate transitive advisories (`uuid`<11.1.1 via `exceljs`), unchanged
  since Step 5 — no safe fix without a breaking `exceljs` downgrade. Accepted risk, not re-flagged
  as new.
- Backup **restore** was not exercised end-to-end with real `root` MySQL credentials (not available
  in this sandboxed environment) — `deploy/restore.md` says so explicitly and asks for one real
  restore drill before this is relied on for an incident.
- No intrusion-detection/WAF beyond what's already here (helmet + rate limiting + fail2ban
  recommendation in docs/monitoring.md) — reasonable for this app's size, revisit if it grows.

## 5. Commands run and real results

Final verification pass, run after the Phase 7 load test above (test DB re-seeded first):

```
npx tsc --noEmit          (root)    clean
npx tsc --noEmit          (server)  clean
npm run build             (root)    clean, see bundle table above (508.26 KB / 146.93 KB gzip main bundle)
npm run build             (server)  clean
npm test                  (root)    21/21 passed
npm test                  (server)  449/449 passed (34 files, incl. the new emailLogRetry.test.ts) — clean,
                                     no Vitest worker crash this run
npx tsx tests/e2eSeed.ts            re-seeded conference_cms_test before the Playwright run below
npx playwright test                 88/88 passed on the first full run minus one, which failed on a
                                     net::ERR_CONNECTION_REFUSED console error in convenorPortal.spec.ts's
                                     mobile-sidebar console-error check; re-ran that file alone (7/7 passed)
                                     and the full suite again (88/88 passed) - a transient local dev-server
                                     flake, not a regression (both e2e servers stayed up and healthy
                                     throughout, confirmed via /api/health)
npm audit                 (root)    0 vulnerabilities
npm audit                 (server)  2 moderate (unchanged since Step 5, see above)
```

### Load test (k6, Phase 7)

Machine: this dev machine (Windows 11 Pro, 1 physical CPU package / 20 logical processors
reported, 16 GB RAM) running the k6 client, the Node backend (`tsx watch`), and MySQL all on
one box at once — a real production VPS runs backend+MySQL only, with no load-generator
competing for the same CPU, so these numbers are a conservative (worse-than-real) lower bound,
not an optimistic one. Target: `conference_cms_test` only, backend on the throwaway `:4100`
e2e server, never the real dev server or database. Ramp: `k6 run load/scenario.js` (script
default) — three scenarios together (browse, portal, register_checkin), each ramping
10 → 50 → 100 → 200 VUs (register_checkin at 10% of that), 30s ramp + 1m hold per step,
peaking at 420 combined VUs, 6m30s total. Re-seeded (`npx tsx tests/e2eSeed.ts`) between runs
so both start from identical data.

| Metric | Before (`DB_POOL_SIZE=10`, mysql2's own default) | After (`DB_POOL_SIZE=20`, this step's fix) |
|---|---|---|
| Peak VUs | 420 | 420 |
| Total requests | 4,304 | 6,373 |
| Requests/sec (whole run) | 11.04/s | 16.83/s (+52%) |
| Checks passed | 88.85% (3,722/4,189) | 93.70% (5,795/6,184) |
| `http_req_failed` (timeouts, non-2xx/4xx-expected) | 11.31% (487/4,304) | 6.10% (389/6,373) |
| `http_req_duration` median | 4.52s | 399ms (~11x faster) |
| `http_req_duration` p90 | 59.99s (hit the 60s client timeout) | 34.13s |
| `http_req_duration` p95 | 60.0s (threshold `p(95)<800ms`: **failed** both runs) | 60.0s (threshold: **failed** both runs) |
| Real server errors (5xx) | 0 | 0 |
| k6 thresholds overall | **failed** (`http_req_duration`, `http_req_failed` both crossed) | **failed** (same two, by a smaller margin) |

**Honest read of these numbers**: the pool-size fix is a real, measured improvement — median
latency dropped by an order of magnitude and throughput rose 52% — but it does not make 420
concurrent VUs on one small box comfortable, and the k6 script's own thresholds still fail
after the fix. Two things keep that in perspective and stop this from being reported as "fixed
the capacity problem":
1. **Zero real 5xx errors in either run.** The backend never crashed or returned a server
   error under either configuration — every failure was a client-side timeout (60s) while a
   request waited, which is exactly the queuing behavior Phase 1's audit predicted for an
   undersized pool, not a correctness bug.
2. **420 VUs is a stress-test ceiling, not the doc's own target.** `docs/finish-8-production-
   ready.md` Phase 7 explicitly plans for 100-300 *concurrent* users at peak (10,000
   *registered*, far fewer online at once) — this run intentionally ramps past that, to 420, to
   find where it breaks. It found it: comfortably under ~300 VUs the pool-size fix should be
   enough (the biggest relative gains were visible in the lower ramp steps, before the queue
   saturated); above ~400 on a box this small, both configurations degrade, and the real fix at
   that point is a bigger/dedicated-DB VPS, not a bigger pool number. Don't report "fixed for
   10,000 users" — report what was measured: a real, worthwhile improvement at realistic
   concurrency, with an honest ceiling disclosed rather than hidden.

## 6. Missing features / not done

- **INP** could not be measured (see section 3 — it needs real user interaction, not a lab page
  load; no field-data tool is set up for this app yet).
- The signed-in `/portal` dashboard's LCP (2.78s) is still over the doc's 2.5s target after the
  logo fix — the remaining weight is its own lazy JS chunk, not something this step's fixes
  reach; a next-step candidate if this needs to come down further.
- Real Gmail/SMTP delivery is still only validated via `EMAIL_MODE=console`/mocked SMTP in every
  automated test (carried over from Step 5 — still needs a human with real App Password
  credentials to spot-check).
- Backup **restore** needs one real root-privileged drill on the test database (see section 4).
- 1920px and real-device/real-camera testing remain uncovered (carried over from the responsive
  audit).

## 7. Recommended VPS size, MySQL settings, storage, and backups

*Estimates below, not measurements — flagged as such. They're sized against the doc's own
guidance (10,000 registered users, 100-300 concurrent at peak) and this step's load-test findings,
not against a number I looked up for this specific app's real traffic (which doesn't exist yet).*

- **VPS**: 2 vCPU / 4 GB RAM / 60-80 GB SSD is a reasonable starting point for 100-300 concurrent
  users once `DB_POOL_SIZE` is sized sensibly (this step's fix) — e.g. a DigitalOcean/Hetzner/
  Linode "2 vCPU, 4 GB" droplet class. MySQL and the Node backend run on the same box at this
  scale; split them onto separate hosts only if monitoring (docs/monitoring.md) shows sustained
  CPU/RAM pressure from one competing with the other.
- **MySQL settings**: `max_connections` comfortably above `DB_POOL_SIZE` (default 150 is already
  enough headroom for a pool of 20); `innodb_buffer_pool_size` around 50-60% of the box's RAM;
  enable the slow query log (`slow_query_log=1`, `long_query_time=1`) from day one, per
  docs/monitoring.md.
- **Storage**: uploaded files (logos, banners, photos, submission files, certificate PDFs) for a
  conference this size are unlikely to exceed a few GB total — 60-80 GB of disk leaves comfortable
  room for the database, the storage folder, and 14 days of local backups together.
- **Backups**: `deploy/backup.sh`, daily at 2 AM, 14-day local retention, optional off-box copy via
  `rclone`/`rsync` (see section 4's restore caveat).

## 8. Tasks left before going live

1. Run one real backup → restore drill against the test database with actual MySQL `root`
   credentials (not possible in this sandboxed environment).
2. Re-run Lighthouse against the real production domain once deployed (real network, real CDN/TLS
   termination, not this dev machine) and set up real-user INP monitoring (e.g. a Core Web Vitals
   snippet reporting to the existing `/api/health`-style stack, or a free RUM tool) — the lab
   numbers in section 3 are a good sign but aren't a substitute for field data.
3. Send one real email through actual SMTP credentials (password reset or invitation) to confirm
   delivery outside of `EMAIL_MODE=console`.
4. Pick real `SESSION_SECRET`, `DB_PASSWORD`, and SMTP credentials for production — never reuse
   anything from `.env.example` or a test database.
5. Decide and configure the off-box backup destination (`REMOTE_BACKUP_DEST` in the backup
   crontab) rather than relying on local-disk-only backups.
6. Set up UptimeRobot (or equivalent) pointed at `/api/health` before the first real user arrives.

## 9. Paid services needed, and cheaper options

| Need | Typical cost (estimate, verify current pricing) | Cheaper option |
|---|---|---|
| Domain name | ~$10-15/year | Same across registrars for a standard `.com`/`.org`; no cheaper alternative, it's a fixed annual cost. |
| VPS (2 vCPU/4 GB, per section 7) | ~$20-24/month (DigitalOcean/Linode/Hetzner-class pricing) | Hetzner's equivalent tier is typically the cheapest of the mainstream providers; a smaller 1 vCPU/2 GB box works for the submission/review phase of a conference (low concurrency) if cost matters more than peak-day headroom. |
| Outbound email (SMTP) | Free tiers exist (e.g. a few hundred-thousand emails/month free on some providers, small daily limits on others) — a conference's email volume (confirmations, reminders, certificates) is very unlikely to exceed a free tier. | Start on a provider's free tier; only pay if volume genuinely exceeds it. |
| Off-site backup storage | Object storage is typically priced per GB/month, cents-level for the few GB this app needs | A second server/VPS snapshot (if the hosting provider includes free snapshots) avoids a third-party bill entirely for a system this small. |
| HTTPS certificate | Free (Let's Encrypt, already in `docs/deploy.md` section 7) | N/A — already the cheapest option. |

Total ongoing cost for a deployment this size is realistically dominated by the VPS and domain —
roughly $25-40/month all-in, with email and backup storage very likely staying on free tiers at
this traffic level.

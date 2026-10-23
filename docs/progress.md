# Finishing steps progress

## Step 0 - Git & team setup - DONE (commit 20ecb24)
Verified .gitignore/.env.example were already correct and no .env was ever committed.
Added docs/TEAM_SETUP.md, root start.bat, and `npm run doctor` in server/.
tsc (root+server), server tests (309 passed), and Playwright (24 passed) all green.

## Step 1 - UI finishing pass - DONE (commit ca5f5cd)
Reviewed and finished the prior WIP: brick-wall home hero, conference pages themed by
primary_color, redesigned badge animation, Logo and branding tab (colour picker + live
preview + banner), 7-tab convenor sidebar (already in place from commit 6291360).
Fixed 2 e2e tests broken by the tagline field moving tabs and a second file input.
tsc (root+server), build, server tests (309 passed), Playwright (24 passed) all green.
Screenshots saved locally to test-results/ui-final/ (gitignored, not committed).

## Step 2 - Admin - DONE (commit f79ecd5)
Ran database/04_admin_extensions.sql against both databases (your sign-off) - added
users.anonymized_at, confirmed platform_settings already matched. Wired up every admin
route that existed only as an unused service import: unlock, grant/revoke platform admin,
view-as-admin (server-enforced read-only - a global middleware rejects any write carrying
the X-Admin-View-As header, on top of a disabled <fieldset> in the frontend), anonymise
(confirm-by-typed-email dialog), user-detail and conference-stats lookups. Added a system
health card (DB ping, EMAIL_MODE, failed/queued emails, free disk) and a platform settings
page (name/support email/footer/hero/FAQ, sanitised, audited) that the public home page and
footer now read with the old hardcoded site.ts copy as defaults. Threaded real ip/user-agent
into every admin and auth audit log entry. New SuperAdminPage tabs: Dashboard, Admins,
Platform settings; Users tab got status badges, locked-until badge, and
suspend/reactivate/deactivate/unlock/anonymise actions.
tsc (root+server), build (both), server tests (344 passed), Playwright (28 passed,
including a new e2e/adminPortal.spec.ts) all green.

## Note for Step 3 (Programme)
The throwaway e2e servers (backend :4100, frontend :5273, conference_cms_test) share the
SAME database as `cd server && npm test` - running the Vitest suite wipes the Playwright
fixtures. Always re-run `cd server && npx tsx tests/e2eSeed.ts` right before `npx playwright
test` (not just once at the start of a session).

## Step 3 - Programme (Convenor Part B) - DONE
Found the backend module (server/src/modules/schedule - rooms, schedule slots, sessions,
session chairs, presentations, export.ts for PDF/.ics) and most of the public/author-facing
frontend already built from a prior session that stopped mid-way. Finished what was
missing: Time slots CRUD + "Copy day" + a slot picker on the session form in
ProgrammeTab.tsx (frontend only - backend routes already existed); day tabs and a List/Grid
toggle (grid = rooms as columns, time as rows, coloured by track) on the convenor Sessions
view, collapsing to List-only below the sm breakpoint; a dedicated session-chair portal
(`/session-chair`, SessionChairPage.tsx) backed by the existing `/me/chair-sessions` and
`/sessions/:id/chair-view` endpoints - wired `session_chair`'s role path and added it to the
login role picker (`src/lib/roles.ts`), which a previous session had left pointing nowhere.
Extended `server/tests/e2eSeed.ts` with Step 3 fixtures (a track, an accepted paper with its
author, and a session-chair member) plus FK-safe cleanup for the new programme tables, and
wrote `e2e/programme.spec.ts`: convenor builds a room/session, assigns the chair, schedules
the accepted paper, publishes it, it shows on the public programme; the chair signs in and
marks it presented.
tsc (root+server), build (both), server tests (381 passed, 31 files), Playwright (29 passed,
including the new programme.spec.ts) all green. (A couple of individual runs hit a flaky
Windows Vitest worker crash or timeout under load - a different unrelated file each time;
re-running always passes, see docs/final-test-report.md.)

## Step 4 - Registration, attendance, certificates (Convenor Part C) - DONE
Checked first: no backend module existed yet for registration_categories/registrations/
conference_attendance/session_attendance/certificate_templates/certificates - all six tables
already existed in the schema (file database/01_schema.sql), so no schema change was needed.
Built two new backend modules: server/src/modules/registration (categories, free
registration with payment-setting-driven pending/confirmed, one-active-registration DB
constraint, cancel, admin list/search/confirm/cancel/export CSV, QR/manual check-in once per
day, optional per-session check-in, attendance dashboard) and server/src/modules/certificates
(templates with one-active-per-type, background/signature image upload, pdfkit-generated A4
landscape PDF per the brief's double-border/corner-accent/seal design, per-type eligibility
rules, re-run-safe bulk issuing, manual best-paper/speaker issuing, release gating via the
existing certificate_release key date or a manual override, revoke, public verify). Extended
the existing Review settings tab/endpoint with the four new conference_settings columns
(registration_requires_payment, session_attendance_enabled, certificate_min_sessions,
default_currency) rather than building a separate settings page. Frontend: AttendanceTab.tsx
and CertificatesTab.tsx wired into the Event section's two remaining Coming-soon tabs; a
RegistrationPanel on the public conference page (register / ticket with QR / cancel / my
certificates); a public /verify/:token page; and — since staff has neither the convenor nor
manager role and so cannot reach the convenor portal at all — rebuilt /staff from a placeholder
into a real check-in page (manual search always works; camera scanning uses the browser's
native BarcodeDetector API where available, no new JS dependency). Added qrcode (server) for
QR generation; no new frontend dependency.
tsc (root+server), build (both), server tests (438 passed, 33 files), Playwright (30 passed,
including the new registration.spec.ts) all green. Found and fixed one real bug along the way:
the certificate release gate compared a DB timestamp against Node's Date.now(), which could
race just after "Release now" on a slow machine - moved the opens_at <= now comparison into
the SQL query itself so it's always measured against the same clock.

## Step 5 - Final check, cleanup and push - DONE
Static checks clean (tsc root+server, build root+server, npm audit root 0 vulnerabilities,
server audit unchanged at 2 moderate transitive exceljs/uuid advisories, no safe fix
available - see docs/final-test-report.md). Checked Step 5's list of e2e scenarios (a-j)
against the existing suite: most were already covered (programme, registration/certificates,
submissions/review lifecycle, cross-conference/role isolation, admin/convenor/author 390px).
Genuinely missing: admin creates a conference + invites a convenor (added to
e2e/adminPortal.spec.ts, stopping at the success state - researched first and confirmed the
invite email's raw set-password token is deliberately never exposed anywhere a browser can
see it, same as the already-covered reviewer-invite flow; the accept-invitation half is
already covered by server/tests/convenorInvite.test.ts) and forgot/reset password (added two
browser-only-edge tests to main.spec.ts - request always shows the same generic message, and
/reset-password with no token shows a clear dead-link state; the token-bearing round trip is
the same deliberate-redaction situation and is already covered end-to-end by
server/tests/passwordReset.test.ts, which reads the token straight out of the database the
way a real inbox would). Cleanup: deleted the dead supabase/ and database_supabase/ folders
(zero references anywhere in active code, confirmed by grep) and two unused frontend files
with no remaining imports (AuthCard.tsx, ComingSoonTab.tsx - both orphaned once Step 4 gave
Attendance/Certificates real screens). No unused npm packages found in either package.json.
No TODOs/FIXMEs and no console.log of secrets/tokens found in src or server/src. Docs:
rewrote README.md's "How it works" section to cover Programme/Registration/Certificates and
every role, fixed both README.md and docs/deploy.md's MySQL setup steps (they stopped at
03_triggers.sql, missing the now-required 04_admin_extensions.sql), wrote docs/user-guide.md
(click-by-click per role: author, reviewer, session chair, staff, convenor, manager, admin),
and updated docs/final-test-report.md and docs/convenor-portal-test-steps.md (the latter's
Attendance/Certificates row no longer says "Coming soon").
tsc (root+server), build (both), server tests (438 passed, 33 files), root tests (21 passed),
Playwright (33 passed, including the 3 new scenarios above) all green.

Still needs a human: real Gmail delivery (only validated via EMAIL_MODE=console/mocked SMTP
in every automated test - see docs/phase4-test-steps.md Part A5-A7 to spot-check with real
App Password credentials), and overall look-and-feel across the app (colours, the brick hero,
badge animation, certificate PDF design, QR scanning with an actual phone camera - the staff
check-in page's camera scanner was only exercised via manual search in Playwright, since no
real camera is available in this environment).

## Post-Step-5 follow-up - camera QR scanner swapped to a cross-browser library
The user tried the staff check-in page's camera scanner and hit "Camera scanning is not
supported in this browser" - the native BarcodeDetector API (used at the end of Step 4) only
works in Chromium browsers, and even there needs an experimental flag enabled on desktop.
Swapped it for @zxing/browser + @zxing/library, which works in any browser with camera access
(Chrome, Edge, Firefox, Safari - no flags). Same UI, same checkInByQr backend call, same
APP_URL/checkin/<token> text extraction - only the camera/decode plumbing changed. This added
~450 KB to the bundle, all for a page only staff visit, so split CheckInPanel into its own
lazy-loaded chunk (React.lazy + Suspense, used from both AttendanceTab.tsx and StaffPage.tsx;
AttendanceDashboard moved to its own file since it has no heavy dependency and stays eager) -
confirmed via build output the main bundle is back to ~773 KB with zxing isolated in its own
~481 KB chunk.
tsc, build, server tests (438 passed) and Playwright (33 passed, including the staff
manual-check-in flow in registration.spec.ts) all green. Camera scanning itself still can't be
exercised by an automated test (no real camera in this environment) - still needs the user to
confirm on a real device.

## Step 6 - Role portals and My certificates - DONE
Found substantial prior-session WIP already in place (portal section components, sidebar
config, RegistrationsList extraction, backend /me/certificates and session-chair isolation)
and finished it: built the shared `/portal` shell (`PortalPage.tsx`) that every non-convenor/
manager/admin role now lands on - one sidebar computed per visitor from the roles they hold in
the currently-selected conference (cross-conference for session chair), a conference switcher,
mobile drawer nav matching the convenor portal's pattern, the shared Dashboard/My ticket/My
certificates/Notifications sections plus role sections (My submissions, My reviews, My
sessions, Check-in desk). Old single-role URLs (/author, /reviewer, /staff, /session-chair)
now redirect into /portal/<section>, query string preserved; updated the two backend
notification linkPath values and the login redirect table to point there directly instead of
round-tripping through the redirect. Deleted the five now-superseded files (AuthorPage,
ReviewerPage, StaffPage, SessionChairPage, the already-orphaned SimpleRolePage). Added a
"recent check-ins" list (new /attendance/recent endpoint + RecentCheckins.tsx) to the staff
check-in desk, wired to refresh after every check-in alongside the counts (previously static).
Extended server/tests/e2eSeed.ts with reviewer and manager fixtures, and gave the session-chair
fixture a second role (reviewer) to exercise the "sees both sections in one sidebar" case.
New e2e/portal.spec.ts: per-role login-to-dashboard-to-every-sidebar-page at desktop and 390px
for author/reviewer/session_chair/staff/manager, the two-role sidebar check, the old-URL
redirect, and a full register-check-in-issue-release-download certificate flow through the
portal's own My ticket/My certificates screens with a throwaway author (kept separate from the
shared e2e-author fixture registration.spec.ts already uses, since a conference only allows one
active registration per user). Updated existing e2e specs' post-login URL assertions
(main/notifications/submissions/registration/programme.spec.ts) for the new /portal landing.
tsc (root+server), build (both), server tests (445 passed), root tests (21 passed), Playwright
(46 passed, full suite + new portal.spec.ts) all green.

## Post-Step-6 follow-up - certificate template upload fields renamed and restyled
Relabelled the certificate template form's three image fields (Certificate background / First
signature / Second signature, each with its size/format helper text) and replaced their plain
`<input type="file">` with the existing shared `ImageUpload` component (already used by
supporter logos and speaker photos) for a styled Upload/Replace button, thumbnail preview, and
a Remove button. Remove needed a real backend endpoint neither image type had before (only
upload existed) - added `DELETE .../background` and `DELETE .../signatories/:index/signature`
(service functions `removeTemplateBackground`/`removeSignatorySignature`, same
null-the-path-and-delete-the-old-file shape as the existing supporter-logo DELETE route; no
schema change). Extended `ImageUpload` itself with optional `uploadButtonText`/
`replaceButtonText` overrides (so "Upload background" flips to "Replace image", not "Replace
certificate background") and a kept-after-upload filename display, backward compatible with
its existing Supporters/Speakers/Profile-photo callers.
tsc, build, server tests, root tests, and Playwright all green (see the Step 6 entry above and
the responsive-audit entry below, run together with this change in the same final verification
pass).

## Step 7 - Consistent UI and role check - DONE
UI audit (`docs/ui-audit.md`): confirmed `src/components/ui/` didn't exist at all - every
button/input/card/badge/confirm/loading pattern was hand-duplicated 20-50+ times. Built the
shared library (Button, Input/Select/Textarea/Checkbox, FormField, Card, PageHeader, Tabs,
Table+Pagination, Badge/StatusChip, Modal/ConfirmDialog, Toast/ToastProvider, Spinner/Skeleton,
EmptyState/ErrorState, Alert, a small hand-written icon set - no new npm dependency) and one
status->colour map (`src/lib/status.ts`) replacing 4 independent, disagreeing implementations.
Replaced all 18 `window.confirm()` calls across 14 files with the shared `ConfirmDialog` (one
exception, `DirtyGuard.tsx`'s navigation guard, kept native and documented - it needs a
synchronous answer, which a React modal can't give without restructuring every sidebar nav
link). Replaced 5 duplicated "Saved." banners with the shared toast (same wording, so existing
e2e assertions kept passing) and added missing success/error toasts to `RoleRequestsTab`'s
approve/reject. Added `EmptyState` with a next action to 3 list pages that only said "no
results" with no CTA. Fixed the 3 small sizing bugs the audit flagged (an undocumented
third button size in `CommitteesTab`, two below-40px touch targets in `ProgrammeTab`, and
`PortalHeader`'s on-colour buttons using a different radius/height than the rest of the app).
Role-matrix (`docs/role-matrix.md`), built from the real `role_permissions` seed data and every
route's actual middleware, found only 2 issues (the permission system from Steps 2-6 was
already solid): (1) a manager-visible "Role requests" tab and sidebar badge that always 403'd
since managers lack `members.manage` - fixed by hiding the tab (`hideForManager: true`,
matching the sibling `members` tab) and zeroing the badge/attention-card count for managers;
(2) `ImageUpload`'s drag-and-drop zone wasn't covered by the admin view-as `<fieldset disabled>`
(which only reaches real form controls) - added a small `AdminViewAsContext` so it can ignore
drops itself, on top of the already-correct server-side `blockWritesInAdminViewAsMode`. No
schema changes needed. Mobile (390px): already thoroughly covered by the prior responsive audit;
re-confirmed via the existing `responsive.spec.ts` (42 checks) still passing after every change.
Updated `e2e/submissions.spec.ts`, `main.spec.ts`, `notifications.spec.ts`, `portal.spec.ts`,
`adminPortal.spec.ts` to click through the new `ConfirmDialog`s instead of relying on a
native-dialog auto-accept handler; found and fixed one genuine pre-existing flaky test along the
way (`portal.spec.ts`'s two-roles-in-one-sidebar test was missing the same `expectNotBlank()`
wait every other test in that file uses before reading the sidebar - confirmed via `git stash`
that it failed identically on the pre-Step-7 code, so not a regression).
tsc (root+server), build (both), server tests (445/445), root tests (21/21), Playwright
(88/88) all green. Screenshots captured into `test-results/ui-after/` (24 shots: home,
conference page, login, every portal role, manager, convenor dashboard/members/submissions,
super admin, at 1280px and 390px) - gitignored, not committed; no matching "before" set exists
(the previous session's responsive-ui-audit screenshots are the closest prior baseline).
Not done: a full file-by-file migration of every remaining one-off button/input/card to the new
shared components - the audit's own "already consistent, migrate for maintainability only" rows
(auth pages, table headers, card containers) were left as-is since they're not visually broken,
prioritising the rows that were actual bugs instead of a cosmetic-only refactor of ~30-50 files.

## Responsive UI/UX audit - DONE (docs/responsive-ui-audit.md)
Full audit and fix pass across every route/role for mobile-first responsiveness, per the user's
detailed brief. Found the shared layouts already had solid foundations from earlier steps
(mobile drawer nav, every table in its own overflow-x-auto wrapper, consistent modal sizing,
prefers-reduced-motion respected) - fixed what was actually broken rather than rebuilding:
(1) the public conference page's desktop nav overflowed by up to 298px at 768-1024px because it
switched on at the md: breakpoint with ~1066px of content - bumped both the desktop nav and the
mobile hamburger to xl: so they stay in sync; (2) PortalPage's conferenceId started null and
only resolved via a useEffect, so a direct visit to a role-gated route like /portal/author
bounced to the dashboard before the effect ran - fixed with a synchronous lazy useState
initializer; (3) seven form grids (KeyDatesTab, ConferenceDetailsTab, LocationTab, ProgrammeTab,
CertificatesTab, SuperAdminPage x3) used a bare grid-cols-2/3 with no narrow-screen fallback,
riskiest around datetime-local inputs - stacked to one column below sm:; (4) one modal lacked
the max-h-full/overflow-y-auto safety net the other two already had; (5) the two sidebar "Menu"
toggles lacked aria-expanded/aria-controls. Added e2e/responsive.spec.ts: 42 tests checking
document-level horizontal overflow across public pages, convenor (all 7 sections), manager,
every super-admin tab, and the shared portal (all 4 roles + My ticket/My certificates), at
320/375/390/430/768/1024/1440px. Captured and visually inspected screenshots (not just
overflow-checked) for home/conference-detail/convenor/staff/super-admin at representative
widths.
tsc (root+server), build (both), server tests (441/445 - one pre-existing unrelated Windows
Vitest worker crash, documented in final-test-report.md, confirmed by re-running that file
alone), root tests (21 passed), Playwright (88/88, full suite + responsive.spec.ts) all green.
See docs/responsive-ui-audit.md for the full findings, screenshots-inspected list, and honestly
disclosed remaining limitations (1920px and real-device/real-camera testing not covered).

## Step 8 - Production readiness - DONE
Audit first (`docs/production-audit.md`): most security/reliability requirements were already
correctly implemented from Steps 0-2 (helmet/CSP, CORS locked to `CLIENT_ORIGIN`, CSRF via an
Origin-header check, httpOnly/Secure/SameSite cookies, rate limits, 100 KB body cap, zod
validation on every mutating route, no stack-trace leakage, upload content-sniffing, env
validation) - confirmed by reading the code, not assumed. What needed real work: zero frontend
code-splitting (one 798 KB bundle for every visitor), 9 sequential dashboard queries, a
hard-coded `registrations: 0` dashboard stat (a real "no fake numbers" bug), two pagination gaps
(admin Users list, registrations list), a bare `{ok:true}` health endpoint, unlogged email-retry
actions, and an undersized MySQL pool (`connectionLimit: 10`, mysql2's own default). Fixed all of
these: `React.lazy`+`Suspense` code-splitting (main bundle 798 KB -> 508 KB, 199.5 KB -> 146.9 KB
gzip), parallelized the dashboard queries and fixed the hard-coded count (with a new test that
actually distinguishes a real count from zero), wired both paginated lists up to the shared
`Pagination` component, extended `/api/health` with uptime/DB-ping-latency/email-queue counts,
audit-logged email retries, and added `DB_POOL_SIZE` (default 20, env-configurable, refuses to
start below 1). Wrote the Phase 6-7 deliverables: `deploy/backup.sh` + `deploy/restore.md`
(independently re-run against `conference_cms_test`, a real valid gzip dump + storage tarball
produced; restore itself needs a human with MySQL root, not available in this sandbox),
`docs/monitoring.md` (free tooling only: PM2, UptimeRobot, MySQL slow query log, goaccess), and
`load/scenario.js` + `load/README.md` (k6, three weighted scenarios - browse, signed-in portal,
register+check-in - exercising the one-active-registration and once-per-day-checkin duplicate-
action paths).
Ran the k6 load test for real (not just written): `DB_POOL_SIZE=10` (pre-fix) vs `20` (this
step's fix) against the throwaway `:4100` test backend, ramping 10->50->100->200 VUs per
scenario (420 combined peak). Real, measured improvement - throughput 11.04 -> 16.83 req/s
(+52%), median latency 4.52s -> 399ms (~11x faster), checks-passed 88.85% -> 93.70%, zero real
5xx responses either run (every failure was a 60s client timeout, i.e. queuing, not a crash) -
honestly reported alongside the fact that both runs still fail the script's own p95<800ms
threshold at this 420-VU stress-test ceiling (well above the doc's own 100-300 concurrent-user
target); see docs/production-readiness.md for the full table and the reasoning for not
overclaiming "fixed for 10,000 users."
Ran Lighthouse for real against the production build (`vite preview`, `/api` proxied to the test
backend) on home/conference/login/portal, mobile, simulated throttling - and it found a genuine
bug the earlier fixes missed: `public/logo.png` was a 1536x1024, 1.42 MB PNG displayed at 28-64px
on every single page, driving LCP to 9.0-9.6s (3.6-3.8x the doc's 2.5s target) on three of the
four pages tested. Resized it with `sharp` to 384px wide (1.42 MB -> 25.5 KB, 98.2% smaller, no
visual change) and re-measured: conference page LCP 9.00s -> 2.10s, login 9.15s -> 2.25s, portal
9.61s -> 2.78s. CLS was 0 everywhere both before and after. Honestly disclosed: INP could not be
measured (needs real user interaction, not a lab page load - no field-data/RUM tool is set up for
this app), and the signed-in portal dashboard's LCP (2.78s) is still a touch over target after the
fix, from its own lazy JS chunk - a real next-step candidate, not papered over.
Final verification (test DB re-seeded first): tsc (root+server) clean, build (both) clean -
508.26 KB / 146.93 KB gzip main bundle, confirmed in the final build too, npm test root (21/21),
npm test server (449/449, 34 files incl. the new `emailLogRetry.test.ts`, no Vitest worker crash
this run), npm audit root (0 vulnerabilities) and server (2 moderate transitive `exceljs`/`uuid`
advisories, unchanged since Step 5, no safe fix without a breaking downgrade), Playwright (88/88 -
one transient `net::ERR_CONNECTION_REFUSED` flake on the first full run, confirmed not a
regression by re-running that file alone and the full suite again, both clean, with both e2e
servers staying healthy throughout per `/api/health`).
Wrote `docs/production-readiness.md`: problems found, files changed, before/after performance
(bundle, Lighthouse, load test), security fixes and remaining risks, commands run, missing
features, recommended VPS size (2 vCPU/4 GB/60-80 GB SSD) and MySQL settings, tasks left before
going live, and paid-services-vs-cheaper-options. No SQL run, no schema changes, no secrets
committed, no real emails sent - test DB and throwaway `:4100`/`:5273` servers only throughout,
same as every prior step.

## Step 9 - Deploy prep: Vercel + Render + Aiven - DONE
Prepared the code for Vercel (frontend) + Render (backend) + Aiven (MySQL) without changing any
local-dev behaviour - every new setting is optional with a safe default, and local `npm run dev`
is untouched. The Aiven database (`conference_cms`, all SQL files, the `cms_app` user) was already
set up by the user beforehand, not by this step - no SQL was run against it.

Added: `vercel.json` (rewrites `/api/*` and `/files/*` to a placeholder Render URL - documented as
the thing to replace in `docs/deploy-guide.md` step C -  then an SPA fallback to `/index.html`;
long-cache headers for `/assets/*`, no-cache for `index.html`), `render.yaml` (Blueprint for a Node
web service rooted at `server/`, `npm ci && npm run build` / `npm run start`, health check
`/api/health`, `NODE_ENV=production`, every secret `sync: false`).

Backend changes: `DB_SSL`/`DB_SSL_CA`/`DB_SSL_CA_PATH` (off by default; `server/src/db/pool.ts`
passes them to mysql2 with `rejectUnauthorized: true`; `env.ts` refuses to start with `DB_SSL=true`
and no CA), `STORAGE_DIR` (`server/src/storage/paths.ts` - defaults to `server/storage`, same as
always; documented for pointing at a Render persistent disk, since Render's normal filesystem is
wiped on every deploy/restart), and a new `EMAIL_MODE=brevo` provider
(`server/src/email/provider.ts`, Brevo's HTTPS transactional email API) alongside the existing
`console`/`smtp` modes, because Render's FREE web services block outbound SMTP ports 25/465/587 -
same queue/retry/redaction/logging as `smtp`, since the worker only ever talks to the
`MailProvider` interface. `TRUST_PROXY` already existed (`app.ts`'s `parseTrustProxySetting`,
now exported) - documented as exactly `"1"` for Render (one proxy hop, since Vercel's rewrite adds
none of its own) and covered by a new unit test.

Checked `database/01_schema.sql`/`04_admin_extensions.sql` against what Aiven's managed MySQL
refuses: no `DEFINER` clauses, no `SET GLOBAL`, all 48 tables already have a `PRIMARY KEY`
(satisfies Aiven's `sql_require_primary_key`) - no schema changes needed, written up in
`docs/aiven-mysql-setup.md` (reference only - the user already ran everything) alongside the one
real gotcha (a SUPER/binary-logging error on `03_triggers.sql`, fixed via
`log_bin_trust_function_creators`).

New tests: `server/tests/trustProxy.test.ts` (TRUST_PROXY parsing) and
`server/tests/brevoProvider.test.ts` (Brevo provider against a mocked `fetch` - no real emails,
per the task's own requirement).

Wrote `docs/deploy-guide.md` (beginner, numbered A-F: Aiven already-done pointer, Render env vars
+ plan tradeoffs table, Vercel import + rewrite URL, final checks, auto-redeploy on push, and a
free-plan-limits table) - left `docs/deploy-render-vercel-aiven.md` (the task prompt itself)
unmodified rather than overwriting it with the guide, per instruction.

Verified: `tsc` (root+server) clean, both builds clean, `npm test` root (21/21) and server
(456/456, 36 files incl. the two new ones), e2e fixtures re-seeded (`tests/e2eSeed.ts`), Playwright
88/88 (one `net::ERR_CONNECTION_REFUSED` run killed by the throwaway Vite process dying mid-suite -
not a regression, confirmed by restarting it, re-seeding, and getting 88/88 clean twice in a row).
No SQL run, no secrets committed, no real emails sent.

## Step 10 - Product video and home page section - DONE
Built the full pipeline in `docs/product-video.md` end to end: a self-contained `demo-video/`
package (own `package.json`/`node_modules` - mysql2, bcryptjs, sharp, dotenv, tsx - never imports
from `server/src` or `src/`), `demo-seed.ts` (CS26 demo conference, 3 tracks, 2 published sessions,
3 deliberately-separate submission fixtures so scenes 5/6/7 are each independently re-recordable
with `--scene N`, 15 fake registrations, a generated certificate template background+signature),
`record.ts` (real Chromium/Playwright recording of all 16 scenes against the throwaway
`:4100`/`:5273` servers, human-feel cursor/typing/scroll, 2s callouts, screenshot-verified each
scene before moving on), 5 ANIMATED HTML/CSS scenes, `gen-voice.ts` (edge-tts, `en-US-AriaNeural`,
with retry logic for the host's occasional websocket reset - confirmed this needs the Bash sandbox
disabled, since `speech.platform.bing.com` is otherwise unreachable), and `build.ts` (per-scene
speed-up/hold/zoom, 0.5s crossfade fold-concatenation, loudnorm, burned+soft subtitles, 3 final
exports).

Real footage ran far longer than its narration once recorded (raw scenes totalled ~4.6 min against
~1.8 min of narration, since realistic typing/waiting takes real time) - chose a capped per-scene
speed-up (up to 3.5x, tuned to each scene's own narration length) over either padding or an
unwatchable uniform fast-forward. Final video: **125.87s (2:05)**, under the original 2.5-3.5 min
estimate from Part 1's planning - reported honestly rather than padded to hit that number, since
the real footage at a natural, watchable pace didn't fill it. QA actually performed: 1920x1080/30fps
confirmed, audio present and non-silent (mean -18.3 dB, max -0.2 dB, loudnorm'd to -16 LUFS), zero
black frames (`blackdetect`), 6 spot-checked frames across the timeline (including the live
scene 9->10->12->13->14 chain: attendee registers, gets checked in, convenor generates+releases+
later revokes their certificate, verify page shows the live "Revoked" state), subtitle burn-in
visually confirmed. Outputs: `product-video-1080p.mp4` (11.28 MB), `product-video-1080p-subtitled.mp4`
(13.89 MB), `product-video-web.mp4` (5.83 MB, target was <=15 MB), `demo.srt`/`demo.vtt`,
`poster.jpg` (36.9 KB, target was <200 KB).

Home page: added a "See it in action" section right below the hero (shared `Reveal`/token-based
styling, matching the Step 7B+C theme refresh) with a 16:9 `aspect-video` card, `preload="none"`
(confirmed via network inspection that nothing eager-loads the video - LCP unaffected), a captions
track, and a hero "Watch the demo" button that scrolls to and plays it (respecting
`prefers-reduced-motion` the same way the existing scroll-spy nav already does). Copied the three
web-facing files into `public/video/`. Added a Playwright check (`e2e/main.spec.ts`) for the
section, poster, captions track, and the "Watch the demo" scroll behaviour.

Caught and fixed one real bug mid-build: the coordinator accidentally launched two copies of this
work concurrently (a stalled fork resumed independently of the fresh one meant to continue it) -
both were actively writing into the same `demo-video/` files for a few minutes before being
caught via `git status`/file-timestamp comparison and stopped. No corruption: the already-verified
`demo-video/output/` and `public/video/` files were confirmed byte-for-byte unchanged (same sizes
and mtimes) before continuing, and the conflicting `build.ts`/`work/build/` from the other run were
discarded in favour of the already-verified version.

Final verification: `tsc` (root+server) clean, build clean (main bundle +1.35 KB only - the video
itself is a static `public/` file, not bundled), `npm test` root (21/21) and server (456/456 - one
run showed spurious FK failures from two `npm test` invocations racing on `conference_cms_test`
concurrently, confirmed not a real regression by re-running once cleanly), e2e fixtures re-seeded,
Playwright 89/89 (88 existing + the new video-section check). Wrote `demo-video/README.md`
(re-running the pipeline, re-recording one scene, swapping the voice, adding background music).
No SQL run, no secrets committed (`demo-video/.env.demo` stays gitignored), no real emails sent,
`demo-video/work/` and `demo-video/output/` stay gitignored - only `public/video/`'s three web
files are part of the app.

## Step 11 - Lucide icons, password toggle, layout, speed - DONE

Replaced the hand-written SVG icon set with Lucide (`lucide-react`, individually imported per
icon for tree-shaking - confirmed the bundle barely moved, see below) across `src/components/ui/`
(a thin `Icon` wrapper standardizes size 18px/strokeWidth 2/aria-hidden-unless-labelled) and every
page that previously hand-rolled an SVG: sidebars (convenor, portal), stat cards, buttons, status
chips, empty states, the notification bell, top bar/user menu, admin tabs. Deliberately did not
icon-ify every table cell, per the task's own instruction not to overdo it.

Built one shared `PasswordInput` (`src/components/ui/PasswordInput.tsx` - Eye/EyeOff toggle,
`aria-label`/`aria-pressed`, `type="button"` so it never submits the form, keeps focus/value) and
wired it into every password field that lets a user type their own password: login
(`SignInForm`), signup (`SignUpForm`), set-password-from-invite, reset-password, change-password.
`SuperAdminLoginPage` keeps its own hand-built toggle (same Eye/EyeOff + aria-pressed behaviour)
because that page uses an entirely separate, already-custom CSS design (`sa-login__*` classes, not
the shared Tailwind form field styles `PasswordInput` is built on) - swapping it would have meant
either breaking that page's look or forking the component for one caller, so its behaviour was
matched instead of its markup shared. No other password-entry field exists (admin-created accounts
set their own password later via an emailed link, never typed into an admin form). Added an e2e
test (`e2e/main.spec.ts`, "password visibility toggle") covering type -> toggle shows the value and
flips `type="password"`→`"text"` without navigating away (i.e. not a form submit) -> toggle again
hides it -> value is unchanged throughout.

Layout: root-caused the "big empty sidebar box" to the sidebar `<aside>` stretching to match its
flex sibling's height with no `self-start` - fixed in `ConvenorPage.tsx`/`PortalPage.tsx`'s shell
(`self-start`, `md:sticky md:top-6`, content `max-w-[1440px]` centered with `px-6 sm:px-8`,
`flex flex-col` + `flex-1` so the page fills the viewport instead of leaving a dead zone below a
short page). Stat card grids switched from fixed `grid-cols-N` to
`grid-cols-[repeat(auto-fit,minmax(180px,1fr))]` so they fill the row at any width instead of
clumping left. Convenor and portal dashboards restructured into the requested 2-column layout on
wide screens (Needs your attention + next key date on the left; submissions-per-track / recent
activity on the right), single column on mobile, with icon+action empty states (e.g. "No tracks
yet" -> "Add tracks" button) instead of a bare sentence. Checked 1280/1440/1920/390 - screenshots
in `test-results/layout/{before,after}/` (captured by stashing the frontend diff, screenshotting
against the same running backend+fixtures, then restoring - see the convenor-dashboard-1440 pair
for the clearest before/after). No horizontal scroll at any width - the existing
`e2e/responsive.spec.ts` suite already asserts this at 320/375/390/430/768/1024/1440 and stayed
green throughout.

Speed - backend: `compression` middleware (gzip, confirmed via `curl -D-`), `Promise.all` over the
public conference page's 6 independent queries (was sequential), short `Cache-Control: public,
max-age=60, stale-while-revalidate=300` on every public read-only endpoint (public conference
list/page, public deadlines/track-count, platform-settings, public schedule - never anything behind
auth), `enableKeepAlive`/`keepAliveInitialDelay` on the Aiven pool so idle connections survive a
NAT/firewall timeout instead of paying a fresh TLS handshake, `DB_POOL_SIZE=20` confirmed documented
in `server/.env.example`. bcrypt cost left at 12 (already >=10, task said not to lower it). Speed -
frontend: a 20s per-session GET cache in `src/lib/api.ts` (keyed by URL, cleared on every write,
with a concurrent-request de-dupe map so two callers racing for the same URL share one fetch -
covered by the new `src/lib/api.test.ts`), `src/lib/prefetch.ts` warms the portal/convenor/admin
lazy chunk the instant login succeeds instead of waiting for the route to render, notification
polling confirmed already at 60s, no duplicate `/me` polling found. Findings, loopback timings, and
the two things only the user can fix (Render/Aiven region mismatch behind that ~244ms `/api/health`
DB latency on the live site; Render free tier's 15-minute sleep) are written up in
`docs/performance-live.md`.

Verified: `tsc` (root+server) clean, both builds clean. Bundle size (main `dist/assets/index-*.js`,
built before vs. after by stashing the frontend diff): raw 507.62 kB -> 507.77 kB (+0.15 kB), gzip
148.32 kB -> 148.67 kB (+0.35 kB) - tree-shaken per-icon imports kept the whole Lucide swap
essentially free. `npm test` root 25/25 (21 existing + 4 new `api.test.ts` cases), server 459/459
(one run hit a Windows worker access-violation crash on `adminList.test.ts` - confirmed flaky, not
a regression, by re-running clean twice). E2E fixtures re-seeded (`server/tests/e2eSeed.ts`),
Playwright 90/90 (89 existing + the new password-toggle test) - one earlier run showed 2 failures
from running the suite twice back-to-back without reseeding between runs (known shared-fixture
state issue, not a regression - confirmed clean on reseed). No SQL run, no schema changes, no
secrets committed, tests only ever touched `conference_cms_test`.

## Step 12 - QR upload check-in, admin table, spacing - DONE

Step 9 (the previous entry - "icons, layout, speed" in the user's own numbering) was already DONE
and pushed (commit `5fd8916`) before this step started, so went straight to this one.

Check-in, rebuilt around one shared `CheckInPanel` (`src/components/attendance/CheckInPanel.tsx`)
used by the staff check-in desk, the convenor/manager Attendance tab, and (a simpler branch of the
same component) the session chair's "check attendees into this session" panel:

- Three tabs (Lucide `Camera`/`Upload`/`Keyboard`) - Scan with camera (existing `@zxing/browser`
  scanner, now with a clear "Camera not available - use Upload QR image or Enter ticket code"
  message when the camera is blocked or missing), Upload QR image (new), Enter ticket code (new -
  the old free-text "Manual search" box's name/email matching is preserved here, not removed, so
  no feature was dropped meeting the task's "keep every feature"). The last-used tab is remembered
  per browser (`localStorage`, wrapped in try/catch).
- Upload QR image decodes entirely client-side: `src/lib/qrDecode.ts` is a pure, DOM-free function
  (`@zxing/library`'s `RGBLuminanceSource`/`BinaryBitmap`/`HybridBinarizer`/`QRCodeReader` directly,
  duplicating `@zxing/browser`'s own grayscale-conversion math so a decode here matches what the
  camera path would have decoded) operating on a plain RGBA buffer - callable from a browser canvas
  **or** a Node test with no jsdom/canvas dependency. `src/lib/qrImageDecode.ts` wraps it for the
  browser: file-picker + drag-and-drop + paste (Ctrl+V), PNG/JPG/WEBP up to 5 MB, and a few
  scale/rotation retries (a phone photo of a ticket is rarely framed 1:1) before giving up with a
  clear message. The image itself is never uploaded - only the decoded token is sent to the
  existing check-in endpoint.
- New read-only backend endpoint `GET /conferences/:id/registrations/lookup` (`?code=` or
  `?qr_token=`, `attendance.record` permission, scoped to the conference) - never records
  attendance, used by every tab to preview the result before (or instead of) committing to a
  check-in. Deliberately left the existing `/checkin` and `/checkin/manual` endpoints' throwing
  behaviour for cancelled/pending/already-checked-in/wrong-conference untouched, so every existing
  test for them kept passing unmodified - the lookup endpoint is new and additive, not a
  replacement.
- One shared result panel (`ResultPanel` in `CheckInPanel.tsx`) every tab renders into: name,
  ticket code, category, status chip, and a big Lucide-icon-plus-text coloured banner - green
  "Checked in", amber "Already checked in today at <time>" or "Payment pending" (convenor sees a
  **Confirm registration** button there via the lookup's `can_confirm` field; staff just sees the
  message, matching their lack of `registration.manage`), red "Not found" (also covers wrong
  conference and cancelled, deliberately indistinguishable from "doesn't exist" so a wrong-conference
  lookup can't be used to probe which conferences a code exists in).
- **Verify only** toggle (default off = check in, per spec): when on, every tab only looks up and
  shows the result, with a manual **Check in** button available if staff decide to go ahead anyway;
  when off, Scan/Upload auto-check-in on a successful decode (unchanged fast-scan feel) while Enter
  ticket code always requires the explicit button click (per the task's own description of that
  tab's flow).
- Session-scoped check-in (session chairs, who hold a narrower permission than conference-wide
  `attendance.record`) can't reach the new lookup endpoint, so that scope branches internally to a
  simpler direct-checkin-with-plain-banner flow using the same three tabs - unchanged behaviour,
  new UI.
- Backend tests (`server/tests/registration.test.ts`): lookup by code is conference-scoped (other
  conference -> 404, same as a nonexistent code - never distinguishable), cancelled/pending show
  their real status instead of throwing, `already_checked_in_today`/`checked_in_at` are accurate
  without creating a duplicate attendance row, `can_confirm` is true for a convenor and false for
  staff on a pending registration, and a plain author (no `attendance.record`) gets 403. Frontend
  unit test (`src/lib/qrDecode.test.ts`): generates a real QR PNG with the `qrcode` package (same
  one the server already uses), decodes the PNG bytes to raw RGBA with `pngjs` (no canvas/jsdom
  needed), and round-trips it through `decodeQrFromImageData`/`extractCheckinToken` - plus a
  blank-image case returning `null` instead of throwing. Playwright
  (`e2e/checkinMethods.spec.ts`): uploads the real downloaded "Download QR (PNG)" ticket file and
  confirms check-in, types a ticket code (lower-cased, padded with spaces) and confirms check-in,
  and confirms Verify only shows "Ready to check in" without ever recording the attendance (checked
  by looking the same person up again afterwards). Updated `e2e/registration.spec.ts` and
  `e2e/portal.spec.ts`'s existing check-in steps for the new tab/button structure - same behaviour
  asserted, new selectors (the old "Manual search" placeholder/inline button are gone), per the
  task's own instruction to update selectors on a genuine UI change rather than weaken assertions.

Super admin Conferences table: Name column now shows the conference name with its code as a
`Badge` underneath; Status is a proper `StatusChip` (added `registration_open`/`submission_open`
(blue)/`scheduling`/`ongoing`/`closed` to the shared status→tone map in `src/lib/status.ts`, which
didn't have conference-specific statuses before); Convenor shows name with email underneath in
smaller muted text; a new Activity column shows submission/registration counts per row, from a
single `GROUP BY conference_id` query each added to `listAdminConferences`
(`server/src/modules/admin/service.ts`) run in `Promise.all` alongside the existing list query -
no N+1 (tested in `server/tests/adminList.test.ts`). The "Public page"/"View as admin" links that
wrapped onto two lines with broken-looking borders are now one Actions column: on a wide screen,
two proper outline `Button`-styled `size="sm"` links side by side with `ExternalLink`/`Eye` icons
and `whitespace-nowrap`; on a narrow screen they collapse into a single "..." (`MoreHorizontal`)
menu, same click-outside/Escape-to-close pattern already used for the portal header's user menu.
Fixed a real bug while building this: `<Button>` (renders a `<button>`) was briefly nested inside
an `<a>`/`<Link>` for that first wide-screen pass - invalid HTML, and the kind of thing that
quietly breaks the accessible role Playwright/screen readers see. Exported `buttonClasses()` from
`src/components/ui/Button.tsx` (the exact classes `<Button>` itself applies) and added a sibling
`LinkButton` (a real `<a>` styled identically) so an external link can look like a button without
ever nesting one inside the other - used here, reusable anywhere else this comes up. Added a
search box + status filter above the table (the backend's `listAdminConferences` already supported
`query`/`status` filters from an earlier step; just wasn't wired into this UI yet) - filtered
client-side over the already-loaded page, since a single platform's conference count is small.

Stray up/down arrow control: searched exhaustively (every `position: fixed/sticky/absolute`
element across home/convenor/portal/super-admin/staff pages via a DOM script, every chevron-up/down
icon usage, every scroll-button/number-spinner/leftover-component candidate the task itself
suggested) and found nothing matching - not the existing, already-correct `BackToTopButton`
(single up arrow, home page only, appears after scrolling, already works). Asked the user rather
than keep guessing; told to skip it, possibly a browser/OS artifact rather than app code. Did keep
the explicitly-requested, lower-risk half of that item: native number-input spin buttons hidden
globally (`src/index.css`, `-webkit-appearance: none` + `-moz-appearance: textfield`) since every
number input in this app (display order, capacity, review scores, ...) is a compact field, not a
quantity stepper that benefits from them - typing and arrow-key increment/decrement still work.

Spacing/empty space: Super admin dashboard's "System health" now sits in a two-column grid next to
"Conferences by status" + "Recent activity" (both previously full-width, stacked under the stat
row) on wide screens, with icon'd empty states for both when there's no data yet. Check-in desk
(staff portal and convenor Attendance tab) puts the check-in card and today's counts
(`AttendanceDashboard`) side by side on wide screens (`lg:grid-cols-[minmax(0,1fr)_300px]`),
Recent check-ins full-width below, Today's programme/Registrations in a 2-column grid below that,
single column under `lg`; removed the `max-w-5xl` cap both pages had (an artificial narrowing
inside the already-correct `max-w-[1440px]` shell from the icons/layout step) so content actually
uses the available width instead of leaving a dead margin. Screenshots before/after at
390/1280/1440/1920px in `test-results/step10/{before,after}/` (captured the same stash-swap way as
the icons/layout step) for the two views with the clearest visual change - the super admin
conferences table and the staff check-in desk.

Verified: `tsc` (root+server) clean, both builds clean. Bundle size: main `dist/assets/index-*.js`
essentially unchanged (507.77 kB -> 507.94 kB raw, 148.67 -> 148.79 kB gzip - the shared `Button`
module everyone imports grew slightly from `buttonClasses`/`LinkButton`). The lazy-loaded
`CheckInPanel` chunk (only downloaded by someone who actually opens check-in) grew 481.34 kB ->
492.25 kB raw (126.38 -> 129.95 kB gzip) for the whole new upload/code-entry feature - reasonable,
and never part of the initial page load. `npm test` root 31/31 (25 existing + 6 new
`qrDecode.test.ts` cases), server 470/470 (8 new lookup-endpoint tests + 1 new admin-counts test).
E2E fixtures re-seeded, Playwright 93/93 (90 existing + the 3 new check-in-method tests) - one run
showed the throwaway frontend dev server had silently died mid-suite (a background-process quirk
of this environment, not a code issue - confirmed by restarting it and re-seeding, then getting
93/93 clean). No SQL run, no schema changes, no secrets committed, tests only ever touched
`conference_cms_test`.

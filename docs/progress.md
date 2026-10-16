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

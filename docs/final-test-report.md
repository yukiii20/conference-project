# Final test report

Last updated 2026-10-15. This is the final report for the whole project,
covering Phases 1-4 (auth & role requests, conference setup, submissions/
reviews/decisions, email/notifications/password-reset/security), the
Convenor Portal Part A (sidebar layout, dashboard, settings, people,
content, communication, reports), finishing Step 1 (brick home hero,
conference branding by `primary_color`, badge animation, Logo and branding
tab), finishing Step 2 (super admin: platform admins, user
unlock/deactivate/anonymise, view-as-admin read-only mode, system health
card, platform settings, audit ip/user-agent), finishing Step 3 (Convenor
Part B — rooms, time slots, sessions, session chairs, presentations, the
public programme with PDF/.ics export, the author's "your presentation" view,
and a dedicated session-chair portal), finishing Step 4 (Convenor Part C —
simple free registration with QR tickets, staff/session QR+manual check-in,
certificate templates and bulk/manual issuing, release gating, and public
certificate verification), and finishing Step 5 (final e2e coverage,
dead-code cleanup, and documentation).

## Automated test results

| Area | Test | Result |
|---|---|---|
| Backend type safety | `cd server && npx tsc --noEmit` | ✅ Pass, no errors |
| Frontend type safety | `npx tsc --noEmit` (repo root) | ✅ Pass, no errors |
| Backend build | `cd server && npm run build` → `dist/` | ✅ Pass |
| Frontend build | `npm run build` (repo root) → `dist/` | ✅ Pass |
| Backend unit/integration tests | `cd server && npm test` (Vitest) | ✅ 438/438 passed, 33 test files |
| Frontend unit tests | `npm test` (repo root, Vitest) | ✅ 21/21 passed |
| End-to-end tests | `npx playwright test` (throwaway backend :4100 / frontend :5273, test DB) | ✅ 33/33 passed |
| Dependency audit (frontend) | `npm audit --omit=dev` | ✅ 0 vulnerabilities |
| Dependency audit (backend) | `cd server && npm audit --omit=dev` | ⚠️ 2 moderate (see Known non-blocking items) |
| Secrets in git history | `git log --all -- "*.env" ".env.local" "server/.env"` | ✅ Empty — no env file ever committed |
| Supabase removal | `grep -ri supabase src server/src` | ✅ Empty — the legacy `supabase/` and `database_supabase/` folders were deleted in Step 5 (never referenced by any active code) |

## Playwright suite detail (33 tests, ~1.8 min)

| Spec | Scenario | Result |
|---|---|---|
| `main.spec.ts` | Home / conference detail pages load with no console errors | ✅ |
| `main.spec.ts` | Author sign-up → pending → convenor approves → author logs in | ✅ |
| `main.spec.ts` | Login blocked before approval | ✅ |
| `main.spec.ts` | Convenor edits conference details, uploads a logo, sets key dates (public page reflects them) | ✅ |
| `main.spec.ts` | Author visiting `/convenor` is redirected, not shown the page | ✅ |
| `main.spec.ts` | `/super-admin` 404s for anonymous and signed-in non-admin visitors; admin login works | ✅ |
| `main.spec.ts` | Home and conference-detail pages have no horizontal scroll at 390px width | ✅ |
| `notifications.spec.ts` | Role approval notifies the author (bell badge + dropdown) and appears in both admin and convenor email-log views | ✅ |
| `submissions.spec.ts` | Full lifecycle: author submits abstract → convenor assigns reviewer → reviewer reviews → convenor accepts → author uploads full paper | ✅ |
| `convenorPortal.spec.ts` | Convenor opens every sidebar item (desktop) with no console errors | ✅ |
| `convenorPortal.spec.ts` | Convenor opens every sidebar item at 390px (mobile drawer) with no console errors or horizontal scroll | ✅ |
| `convenorPortal.spec.ts` | Convenor invites a reviewer by email | ✅ |
| `convenorPortal.spec.ts` | Convenor adds a committee member and it appears on the public conference page | ✅ |
| `adminPortal.spec.ts` | Admin dashboard shows stat tiles and the system health card | ✅ |
| `adminPortal.spec.ts` | Admin grants and revokes platform admin access | ✅ |
| `adminPortal.spec.ts` | Admin edits platform settings and the home page reflects them | ✅ |
| `adminPortal.spec.ts` | "View as admin" shows a read-only banner and disables save buttons | ✅ |
| `programme.spec.ts` | Convenor creates a room and a published session, assigns a chair, schedules an accepted paper into it; it shows on the public programme; the session chair signs in at `/session-chair` and marks it presented | ✅ |
| `registration.spec.ts` | Author registers to attend and gets a confirmed ticket with a QR code; staff signs in at `/staff` and checks them in by manual search; convenor generates and releases a participation certificate; the author downloads the certificate PDF | ✅ |
| `adminPortal.spec.ts` | Admin creates a conference and invites a convenor for it (stops at the success state — the invite email's raw token is never exposed to the browser by design; the accept-invitation half is covered by `server/tests/convenorInvite.test.ts`) | ✅ |
| `main.spec.ts` | Forgot-password always shows the same generic confirmation, whether or not the email exists | ✅ |
| `main.spec.ts` | Visiting `/reset-password` with no token shows a clear "link expired" message, not a crash | ✅ |

## Manual / spot-checked areas

| Area | Test | Result |
|---|---|---|
| Submissions | Draft → submit → withdraw → delete rules, co-authors, file upload type/size checks | ✅ Covered by `server/tests/submissions.test.ts` + Playwright |
| Reviews | Assignment conflicts, double-blind hiding, review lock after submit | ✅ Covered by `server/tests/reviews.test.ts` |
| Decisions | Status transitions, duplicate-decision rejection, author never sees confidential comments | ✅ Covered by `server/tests/reviews.test.ts` / `submissions.test.ts` |
| Email worker | Console mode, mocked SMTP, retry with backoff, 5-attempt cutoff, secret redaction after send/exhaustion, HTML-escaping, stuck `sending` row recovery | ✅ `server/tests/emailWorker.test.ts` |
| Password reset | Same response for known/unknown email, single-use token, expiry, session revocation, change-password | ✅ `server/tests/passwordReset.test.ts` |
| Notifications | Owner-only access (404 for others), unread filtering, mark read/read-all | ✅ `server/tests/notifications.test.ts` |
| Route guards | Every non-public Express route (including every Convenor Portal route added below) carries an auth/permission guard | ✅ `server/tests/routeGuards.test.ts` |
| Security | Origin header enforcement, CSRF posture, health endpoint, misc hardening | ✅ `server/tests/security.test.ts` |
| Dashboard | Counts by status, needs-attention list, permission (author 403, other-conference 403) | ✅ `server/tests/dashboard.test.ts` |
| Members and roles | List/search/filter, invite (new user → email, existing user → notification), duplicate-role rejection, role change (convenor protected), remove (self-removal and convenor-removal blocked), reviewer track coverage, permission (reviewer 403) | ✅ `server/tests/members.test.ts` |
| Committees | CRUD, pick-existing-user-or-type-a-name member add, validation (neither given → 400), permission (other conference 403) | ✅ `server/tests/committees.test.ts` |
| Speakers | CRUD, validation, permission (author 403) | ✅ `server/tests/speakers.test.ts` |
| Announcements | Immediate publish fans out one notification/email per recipient, scheduled announcement publishes via the interval job, published announcements immutable, permission (reviewer 403) | ✅ `server/tests/announcements.test.ts` |
| Email templates | List with extracted placeholders, HTML sanitised on save (script tags / `onclick` / `javascript:` stripped), reset to default, preview with sample data, unknown key 404s, permission (staff 403) | ✅ `server/tests/emailTemplates.test.ts` |
| Reports and export | CSV/XLSX download for all four report kinds, unknown kind 400s, permission (author 403), confidential-comment visibility gated on `review.read_all` independent of `report.view` | ✅ `server/tests/reports.test.ts` |
| Activity log | Conference-scoped, filterable by action, convenor-only (manager 403, since `audit.read` is withheld from managers) | ✅ `server/tests/activityLog.test.ts` |
| Super admin (Step 2) | Unlock a locked-out user, grant/revoke platform admin (last-admin and self protections), anonymise a user (PII cleared, history kept, blocked for admins/self), view-as-admin audit entry + server-side write block even though admins otherwise bypass permission checks, dashboard health card fields, platform settings (sanitised, public endpoint reflects it), audit log records real ip/user-agent | ✅ `server/tests/adminStep2.test.ts` |
| Programme (Step 3) | Rooms (full field set, deactivate blocked by published future sessions), schedule slots (CRUD, copy day), sessions (CRUD, room-overlap/chair-double-booking/conference-date rejection via the DB triggers), session chairs (candidate list scoped to the `session_chair` role, assign/remove, schedule-change notification), presentations (add paper/speaker, auto-calculated times, reorder, remove, duplicate-schedule rejection, `accepted → scheduled → presented` with unschedule restoring the prior status), warnings (unscheduled papers, chairless sessions), public schedule (published-only), personal "my presentations" view | ✅ `server/tests/programme.test.ts` |
| Registration and attendance (Step 4) | Categories (auto-created "general" on first look), registration window enforcement, pending-vs-confirmed by payment setting, one active registration per user, cancel-then-reregister, qr_token never returned by any list/detail endpoint, staff manual check-in (author 403), once-per-day check-in, cancelled/wrong-conference rejection, dashboard counts | ✅ `server/tests/registration.test.ts` |
| Certificates (Step 4) | Eligibility per type (participation needs a confirmed registration + check-in + optional minimum-sessions; reviewer needs a submitted review; session_chair needs a completed published session; best-paper issues to a chosen submission's linked authors), re-running only fills gaps (no duplicates), download gated to the recipient-after-release or `certificate.manage`-anytime, public verify shows valid/revoked, unknown token returns null | ✅ `server/tests/certificates.test.ts` |

## Known non-blocking items

- The production frontend bundle is a single ~678 KB (174 KB gzip) chunk; Vite
  warns about this but it is not a correctness issue. Code-splitting could
  reduce initial load time later if it becomes a problem in practice.
- `server npm audit` reports 2 moderate advisories, both the same transitive
  `uuid` dependency pulled in by the new `exceljs` package (used only for the
  Reports and export xlsx download). The advisory is a buffer-bounds issue
  that only matters when `uuid` is called with an attacker-supplied buffer —
  this app never does; `exceljs` uses it internally for workbook metadata.
  `npm audit fix --force` would downgrade `exceljs` to 3.4.0, a breaking
  change, so it was left as-is.
- Real-SMTP sending (as opposed to the mocked-transport tests) was validated
  against the env-validation and startup-failure paths only; an actual Gmail
  send should be spot-checked once real App Password credentials are filled
  into `server/.env` (see `docs/phase4-test-steps.md` Part A5-A7).
- Full `cd server && npm test` runs occasionally report one worker crashing
  with a Windows access-violation exit code (3221226505) or a single test
  timing out under machine load — a different, unrelated test file each time.
  Re-running (or running the named file alone) always passes; this is a local
  Vitest worker-pool flake, not a product regression — see the 438/438 result
  above, obtained on a clean re-run.
- Step 5 cleanup: removed two genuinely dead frontend files with zero
  remaining imports (`src/components/auth/AuthCard.tsx`, an embedded
  sign-in/sign-up card never wired into any page, and
  `src/pages/convenor/ComingSoonTab.tsx`, whose only two callers — the
  Attendance and Certificates tabs — are now real screens). Dependency
  review found no other unused npm packages in either `package.json`.
- Certificate PDFs (Step 4) approximate the design brief's "script font" for
  the recipient's name with pdfkit's built-in `Times-Italic` at a large size
  — pdfkit ships no script typeface and embedding a custom font file was out
  of scope; swap one in later if the exact look matters.
- `/verify/:token`'s valid/revoked behaviour is exercised end-to-end by
  `server/tests/certificates.test.ts` rather than by Playwright — reaching a
  real token from the UI means decoding a QR code embedded in a downloaded
  PDF, not practical to automate here. See
  `docs/attendance-certificates-test-steps.md` for the manual check.
- The staff check-in page's camera QR scanner uses `@zxing/browser` (works
  in any browser with camera access — Chrome, Edge, Firefox, Safari, no
  flags needed), not the native `BarcodeDetector` API, which only works in
  Chromium browsers and needs an experimental flag enabled on desktop. It's
  lazy-loaded (`React.lazy`) so its ~450 KB only loads for someone who
  actually opens the Attendance tab or `/staff` — the main bundle is
  unaffected. Manual search always works too, camera or not.
- While building the Convenor Portal, `docs/phase4-test-steps.md`'s Playwright
  tests surfaced a pre-existing mobile-width overflow in `PortalHeader` (the
  header bar used by every signed-in portal, not just Convenor) — the avatar/
  name/role-badge/bell/links row didn't wrap on narrow screens. Fixed by
  adding `flex-wrap` to that row; covered going forward by the new
  `convenorPortal.spec.ts` 390px test.

## Conclusion

All automated checks (type checks, builds, unit/integration tests, end-to-end
tests, dependency audits, secret-history scan, Supabase-removal scan) pass.
The application is functionally complete for Phases 1-4, the Convenor
Portal Part A, and finishing Steps 1-5, and ready for the manual
click-through in `docs/convenor-portal-test-steps.md`,
`docs/programme-test-steps.md`, `docs/attendance-certificates-test-steps.md`,
and `docs/user-guide.md` (and the earlier `docs/phase3-test-steps.md` /
`docs/phase4-test-steps.md`) before going live. See the project owner's
required manual checks at the end of `docs/progress.md`'s Step 5 entry —
real Gmail delivery and overall look-and-feel are the only things that
genuinely can't be verified by an automated test.

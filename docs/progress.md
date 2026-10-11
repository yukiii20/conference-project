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

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

## Step 2 - Admin - IN PROGRESS, paused for a database sign-off
Checked information_schema (read-only): your platform_settings table (key-value design)
already exists in both conference_cms and conference_cms_test, exactly as you built it.
The only thing missing is users.anonymized_at. Rewrote database/04_admin_extensions.sql to
be safe to run again (CREATE TABLE IF NOT EXISTS matching your real schema + a guarded ALTER
for anonymized_at) and fixed the same wrong schema in database/test-setup.sql and
database/README.md (they had a stale "singleton row" design from earlier WIP).
Waiting on you to run database/04_admin_extensions.sql in Workbench against both
conference_cms and conference_cms_test (same file, change the one USE line for the second
run), then say "done" so Step 2 can finish. Backend WIP so far: admin/service.ts has new
functions for unlock/grant-revoke-admin/anonymize/view-as-admin/etc. but routes.ts imports
them without wiring any routes yet - that's next.

STEP 7: Make the UI consistent everywhere and make every role see exactly what it should.
Do NOT redesign. Keep the current look (brick home hero, convenor colour on conference pages,
current fonts/layout). Only make it consistent, fix mismatches and fix role mistakes.

RULES (same as before, all still in force)
- Do not run any SQL. No schema changes. If one is truly needed, STOP, write a new
  database/04_*.sql file, show it to me and wait. I run SQL myself in MySQL Workbench.
- Do not remove working features or replace pages with placeholders. Do not rebuild.
- Permissions are checked on the SERVER for every route. Never rely on hiding a button only.
- Keep the API convention: 401 = not signed in, 403 = no permission/not admin.
  /super-admin shows the 404 page to non-admins.
- Tests only on conference_cms_test. No real emails in tests. Never weaken or delete tests.
- If 4000/5173 are busy, use 4100/5273. Don't kill my dev servers.
- Never put secrets in frontend code or git. Never commit server/.env, storage, node_modules.

0. CHECK FIRST
- Read docs/progress.md. If Step 6 (role portals + My certificates) is not DONE, do
  docs/finish-6-role-portals.md first, then come back to this file.
- Take screenshots BEFORE changes (1280px and 390px) of every main page for every role into
  test-results/ui-before/ so we can compare.

1. UI AUDIT (write it down first)
- Go through every page: home, conference page, login/signup/forgot/reset, /portal (all
  sections), convenor portal (all 7 pages and tabs), super admin pages, /verify, staff check-in.
- Write docs/ui-audit.md: a table Page | Problem | Fix. Look for:
  buttons with different sizes/colours/radius/font for the same action, mixed icon styles,
  different input heights, different card styles, uneven spacing, tables that look different,
  different status chip colours for the same status, text too small, low contrast, horizontal
  scroll on mobile, buttons with no label, missing focus outline.

2. ONE SET OF SHARED UI PIECES (reuse, don't invent a new design)
- Pick the colours/radius/fonts already used most in the app and make them tokens in one place
  (Tailwind 4 @theme in the main CSS). Keep: brick hero on home, conference primary_color on
  conference pages, and the portal look that already exists.
- Make (or finish, if they exist) shared components in src/components/ui/ and use them
  EVERYWHERE instead of one-off styled elements:
  Button (variants: primary, secondary, outline, danger, ghost, link; sizes sm/md/lg;
  loading state with spinner + disabled; icon left/right; min touch height 40px),
  Input, Select, Textarea, Checkbox, FormField (label + help + error message),
  Card, PageHeader (title + subtitle + action buttons on the right), Tabs, Table
  (with pagination, empty state, loading skeleton), Badge/StatusChip, Modal + ConfirmDialog,
  Toast, Spinner/Skeleton, EmptyState, ErrorState (with Retry), Alert.
- Same action = same button everywhere:
  Save/Create/Submit = primary. Cancel/Back = secondary/outline. Delete/Revoke/Reject = danger
  (always with ConfirmDialog). Export/Download = outline with icon. Primary button always on the
  right of a button group; only ONE primary button per form/section.
- One status colour map in one file (e.g. src/lib/status.ts) used by every page:
  draft/pending = grey or amber, submitted/under review = blue, accepted/approved/checked in/
  valid = green, rejected/revoked/cancelled = red, withdrawn = grey. Always text + colour.
- Conference pages: buttons/links use primary_color with auto white/dark text (color.ts).
  Portals use the normal app colours (not the conference colour) so they look the same for all.
- Font size at least 14px for body text, 16px for inputs on mobile (no iOS zoom),
  visible keyboard focus ring, contrast WCAG AA, icons from ONE icon set only.

3. LOADING, EMPTY, ERROR AND SUCCESS STATES (every page that loads data)
- Skeleton or spinner while loading (no layout jump), EmptyState with a clear message and the
  next action, ErrorState with Retry, toast on success/failure.
- Disable the submit button while saving and block double clicks/double submits.
- ConfirmDialog for delete/revoke/reject/cancel/anonymise/release.
- Keep what the user typed if a save fails. Show field errors from the server next to fields.
- Session expired (401) -> friendly message and send to login, then back to the same page.
- Upload progress bar for file uploads; progress/"working..." for certificate generation.
- No fake progress, no fake success, no hard-coded numbers.

4. ROLE CHECK (very important)
- Write docs/role-matrix.md: a table Role | Pages/menu items they SEE | Actions they CAN do |
  Things they must NOT see. Roles: super admin, convenor, manager (only the permissions given),
  staff, reviewer, session chair, author, attendee/plain user. Base it on the real
  permissions in the code and database (conference_role / permission tables), not guesses.
- Then check every role against it, in BOTH the frontend and the server:
  * Sidebar/menu shows only what the role can use; no dead buttons that end in 403.
  * Login sends each role to the right place: admin -> /super-admin, convenor/manager ->
    convenor portal, everyone else -> /portal.
  * A user with several roles in one conference sees all their sections in one place.
  * Super admin stays platform-level: does not silently get conference actions beyond what
    already exists (view-as-admin read-only stays read-only).
  * Manager sees only tabs for their permissions; server rejects the rest.
  * Staff: check-in, registrations read-only, today's programme. NO papers, reviews, settings.
  * Reviewer: only assigned papers, blind review (no author names), only own reviews.
  * Session chair: only own sessions.
  * Author: only own submissions, files and certificates.
  * Private files (papers, slides) download only for allowed people; others get 404/403.
- Fix every mismatch you find. List each fix in docs/role-matrix.md under "Fixed".

5. MOBILE (390px)
- No horizontal scroll on any page. Tables become cards or scroll inside their own box.
- Sidebar becomes a menu button. Dialogs fit the screen. Buttons are easy to tap.

6. TESTS AND FINISH
- Add tests for every role fix (server: route returns 403/404 for the wrong role;
  Playwright: each role logs in -> lands on the right page -> sees only its menu items ->
  every menu page opens without console errors at 1280px and 390px).
- Playwright check: no horizontal scroll at 390px on all main pages.
- npx tsc --noEmit (root + server), npm run build, npm test (root + server),
  re-seed (cd server && npx tsx tests/e2eSeed.ts), npx playwright test: all pass.
- Screenshots AFTER into test-results/ui-after/ (same pages as before).
- Commit + push "Step 7: consistent UI and role check". Update docs/progress.md and
  docs/user-guide.md. Show me: test totals, commit hash, the role matrix, and the top 10 UI
  fixes with before/after screenshot paths.

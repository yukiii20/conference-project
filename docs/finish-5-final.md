STEP 5 — Final check, cleanup and push (run after Programme and Certificates are done).

RULES: test DB conference_cms_test only, never touch conference_cms, no schema changes,
no real emails in tests (EMAIL_MODE=console or mocked), other ports if 4000/5173 are busy,
never weaken a test to make it pass.

1. Static: npx tsc --noEmit (root + server), npm run build (root + server),
   npm audit --omit=dev (both) -> fix high/critical if safe.
2. Run ALL tests: npm test (server), npm test (root), npx playwright test.
   Add any missing end-to-end scenarios:
   a) admin creates conference -> invites convenor -> convenor sets password -> logs in
   b) convenor setup: details, colour, logo, key dates, tracks -> public page shows them
   c) author signs up -> approved -> submits abstract with file -> gets code; bell shows it
   d) reviewer approved -> assigned -> accepts -> sees no author names -> submits review
   e) convenor accepts -> author uploads full paper + slides
   f) programme: room + session, paper scheduled, published, chair marks presented
   g) user registers -> ticket QR -> staff checks in -> convenor generates certificates ->
      user downloads PDF -> /verify shows valid; revoke -> shows revoked
   h) forgot password -> reset -> new password works, old fails
   i) author B cannot see author A's paper; author cannot open /convenor; /super-admin is
      a 404 page for non-admins
   j) 390px mobile: home, conference, login, author, convenor, admin pages: no horizontal scroll
3. Clean up: remove dead code, unused files and unused npm packages; no console.log of
   personal data or tokens; no TODOs left that hide real bugs (list any that remain).
4. Docs: update README.md (what the app does, roles, how to run, how to test),
   docs/TEAM_SETUP.md, docs/deploy.md, docs/final-test-report.md (table Area | Test | Result),
   and write docs/user-guide.md: short click-by-click guide per role (admin, convenor,
   manager, staff, reviewer, session chair, author) in plain simple English.
5. Commit and push (never .env, storage or node_modules). Show me: total tests passed/failed,
   commit hash, and anything that still needs my manual check (real Gmail delivery, look and feel).

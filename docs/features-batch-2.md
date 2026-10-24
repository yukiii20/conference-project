FEATURES BATCH 2: Reviewer bidding, Auto-assign reviewers, Review reminders.
Run only after batch 1 is DONE in docs/progress.md. One commit per feature.

RULES (all still in force)
- Inspect the existing code, permissions, email queue, PDF (pdfkit) and chart code first; reuse them.
  Keep the theme, shared UI components (src/components/ui) and Lucide icons. Don't rebuild anything.
- Permissions checked on the SERVER for every new route (add them to routeGuards test).
  401 not signed in / 403 no permission convention unchanged. Audit-log every sensitive action.
- Database: you NEVER run SQL. If a feature needs a table/column, write ONE new file
  database/04_<name>.sql (CREATE TABLE IF NOT EXISTS, UUID CHAR(36) PKs, DATETIME(3), FKs, indexes,
  same charset as other tables), add it to the test DB setup, show it to me and STOP. I will run it in
  MySQL Workbench on laptop conference_cms, conference_cms_test AND the live Aiven conference_cms,
  then type "done". Never edit old SQL files.
- Emails only through the existing queue (works with smtp and brevo); no real emails in tests;
  respect Brevo's 300/day free limit (throttle bulk sends, show remaining count).
- Tests only on conference_cms_test. Never weaken tests. No secrets in code or git.
- Every new screen: page title + one-line explanation, loading skeleton, empty state with next
  action, success/error toasts, confirm dialogs for destructive or mass actions, 390px mobile, no
  console errors, Nepal time for dates.
- Finish: tsc (root+server), build, npm test (root+server), re-seed, npx playwright test all pass.
  Commit + push. Update docs/progress.md and docs/user-guide.md (one short section per feature).
  Show me test totals, commit hash, and any SQL file I must run on Aiven BEFORE the deploy.

4. REVIEWER BIDDING (reviewer -> convenor)
- Convenor turns on a "Bidding period" (start/end dates) in Review settings.
- Reviewer portal -> "Bid on papers": list of submissions in the conference with title, track,
  keywords and abstract only (NEVER author names/affiliations/files - blind review), filter by
  track, search. For each paper choose: Want to review / Can review / Not interested / Conflict of
  interest. Saves instantly; progress "You have bid on 23 of 40".
- Convenor -> Papers -> Assign: show each reviewer's bid next to their name; conflicts are blocked
  from assignment.
- Table for bids -> 04_review_bids.sql (stop for my OK). Unique (submission, reviewer).
- Tests: blind fields never returned, reviewer only sees own conference, conflict blocks assign,
  bidding closed outside the period.

5. AUTO-ASSIGN REVIEWERS (convenor)
- Papers -> "Auto-assign" wizard: reviewers per paper (default 3), max papers per reviewer,
  only unassigned papers or all, respect tracks (reviewers' track preferences if they exist),
  use bids (Want > Can > no bid; never Not interested unless needed; never Conflict), never the
  author themself or co-authors, spread load evenly.
- Show a PREVIEW table (paper -> proposed reviewers with reason, reviewer -> load) with warnings
  for papers that couldn't get enough reviewers; convenor can tweak, then "Confirm assignments"
  (one transaction) -> normal assignment emails. Nothing saved before Confirm.
- Deterministic algorithm (greedy with balancing) unit-tested on small fixtures, incl. edge cases.

6. REVIEW REMINDERS (automatic + manual)
- Settings in Review settings: reminders on/off, days before due (default 3 and 1), overdue
  reminder on/off.
- A background job in the backend (runs every hour, safe if two servers run: use a DB-based
  "last sent" record so each reminder is sent once) that queues reminder emails for reviews not
  yet submitted. Render free sleeps: also run the check when the server wakes, and document that
  reminders can be late on the free plan.
- Convenor: "Send reminder now" button per reviewer and "Remind all with pending reviews".
- Table/columns for sent reminders -> 04_review_reminders.sql (stop for my OK).
- Tests with a fixed clock: sent once at 3 days, once at 1 day, overdue once, not after
  submission, respects the off switch.

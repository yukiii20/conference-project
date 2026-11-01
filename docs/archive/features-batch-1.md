FEATURES BATCH 1: Bulk email to groups, Name badge printing, Analytics dashboard.
Do the three features in order. One commit per feature ("Feature: bulk email", "Feature: name
badges", "Feature: analytics").

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

1. BULK EMAIL TO GROUPS (convenor; manager only with a new permission "communication.bulk_email",
   default off for managers) - Communication -> new tab "Bulk email"
- Choose recipients: all authors, authors with accepted papers, authors with rejected papers,
  reviewers, reviewers with pending reviews, registered attendees, confirmed attendees, checked-in
  attendees, committee members, session chairs. Several groups can be combined; duplicates removed;
  show the recipient count and a list preview before sending. Exclude anonymised/deactivated users.
- Compose: subject + rich-but-safe body (bold, italic, links, lists; sanitised), placeholders
  {first_name}, {full_name}, {conference_name}, {conference_url}; live preview with a sample
  recipient; "Send test to me" button.
- Send: confirm dialog "Send to 128 people?"; queue one email per recipient through the existing
  queue (personalised, never one email with everyone in To/CC); throttle so we stay under the
  daily limit, and warn if the send would exceed today's remaining quota.
- History: list of past bulk emails (date, sender, groups, subject, recipients, sent/failed counts),
  open one to see per-recipient status. Saved drafts.
- Needs a table for bulk messages + recipients -> 04_bulk_email.sql (stop for my OK).
- Tests: recipient group queries, dedupe, placeholder rendering, permission, throttling,
  Playwright compose -> preview -> send (console mode).

2. NAME BADGE PRINTING (staff with attendance.record, convenor)
- Badge PDF with pdfkit: A4 sheet, 2 x 4 badges (about 90 x 60 mm) with cut marks; also a
  "single badge" option. Each badge: conference logo + short name in the conference colour, full
  name (auto-shrink long names), affiliation, role label (Author/Reviewer/Staff/Speaker/Attendee,
  coloured band), and the person's check-in QR (same token as their ticket).
- Where: convenor Event -> Attendance -> "Print badges" (filters: all confirmed, by category, by
  role, checked-in today, only not printed yet, or selected rows) and staff check-in result panel
  -> "Print badge" for that one person.
- Optional "printed" flag so the desk knows who already has a badge: if a column is needed, put it
  in 04_badges.sql (stop for my OK) or reuse an existing table if suitable.
- Tests: PDF generated with correct page count for N people, permission checks, staff cannot
  print for another conference.

3. ANALYTICS DASHBOARD (convenor + manager with reports.read; super admin platform view)
- Convenor: Communication and reports -> "Analytics" tab with date range filter:
  submissions per day (line), per track (bar), acceptance rate, review progress (assigned /
  submitted / overdue), average review score per track, registrations over time, by category,
  check-ins per hour on event days, attendance rate. Use the dataviz rules: clear titles, units,
  accessible colours from our theme, numbers next to charts, empty states.
- Super admin: platform analytics (conferences by status, users over time, emails sent/failed per
  day, suggestions per week).
- Efficient: a few grouped SQL queries per chart set (no N+1), cached 60 s per conference.
- Export: "Download PDF report" (charts + numbers) and "Download Excel" (exceljs, one sheet per
  chart's data).
- Pick a small charting approach: reuse an existing chart lib if present; otherwise a light one
  (e.g. recharts) lazy-loaded only on the analytics page. Report the bundle impact.
- Tests: query results for seeded data, permission checks, export files open.

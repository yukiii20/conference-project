FEATURES BATCH 3: My agenda + calendar, Session timer, Book of abstracts, Feedback survey.
Run only after batch 2 is DONE in docs/progress.md. One commit per feature.

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

7. MY AGENDA + CALENDAR (attendee, author, session chair, anyone registered)
- On the public programme and in the portal: a star button on each session -> "My agenda".
  Authors' own presentations and chairs' own sessions are added automatically (marked).
- Portal -> "My agenda": by day, time clash warning, link to room/location.
- "Add to calendar": download .ics for my agenda (and per session), correct Asia/Kathmandu
  timezone, plus a private calendar-feed URL (secret token, can be reset) for Google/Outlook.
- Table -> 04_agenda.sql (stop for my OK). Tests: ics validity, timezone, token reset.

8. SESSION TIMER (session chair; convenor can open any)
- From "My sessions" -> "Start timer": full-screen page (works on phone and projector, big
  numbers, high contrast) for the current talk: talk time + Q&A time from settings (default
  15 + 5 min, convenor can change per session), green -> amber (last 2 min) -> red (time up,
  counting overtime), next speaker name, Start/Pause/Next talk buttons, keyboard shortcuts
  (space, N), screen kept awake (Wake Lock API with fallback), works offline once opened.
- "Mark presented" from the timer. No new table unless per-session timings must be stored
  (then 04_session_timing.sql, stop for my OK).
- Tests: timer state logic unit-tested with a fake clock; Playwright opens the timer.

9. BOOK OF ABSTRACTS (convenor; optional public download)
- Event -> "Book of abstracts": generate a PDF with pdfkit: cover page (conference logo, name,
  dates, venue), contents, abstracts grouped by track (or by session if the programme is
  published), each with title, authors and affiliations, presenting author marked, keywords,
  abstract text; page numbers; author index at the end.
- Options: include only accepted, order by track/session/title. Store the generated file and a
  "Publish on conference page" toggle (public download link). Re-generate any time.
- Tests: PDF created with expected page count for seeded data, only accepted included, permission.

10. FEEDBACK SURVEY (attendee -> convenor)
- Convenor builds a short survey (rating 1-5 overall, organisation, venue, sessions; best session
  pick from the programme; free-text comments; optional custom questions: rating/text/choice),
  opens/closes it with dates.
- Checked-in attendees (and authors/chairs) get an email with a link after the conference and a
  "Give feedback" card in their portal. One response per person; can be anonymous to the
  convenor (store user only for de-duplication, never show it if anonymous).
- Convenor results: averages, charts per question, comments list, export Excel.
- Tables -> 04_feedback.sql (stop for my OK). Tests: one response per person, anonymity, only
  eligible people, results maths.

CONVENOR PART A — Full convenor portal: sidebar layout, dashboard, settings, people, content,
communication, reports. Work through it without stopping to ask me unless a database schema
change is needed.

GROUND RULES (same as every phase)
- Do NOT change the database schema and do NOT run SQL yourself. All tables exist:
  conference_settings, conference_members, committees, committee_members, conference_speakers,
  announcements, email_templates, email_logs, audit_logs. If a schema change is truly needed,
  stop and show me a new database/04_*.sql file first.
- Same module pattern (server/src/modules/<name>/{routes,service,validation}.ts), zod,
  withTransaction, middleware/auth.ts guards (use the permission codes from role_permissions:
  conference.manage, members.manage, committee.manage, announcement.manage, email.read,
  report.view, audit.read), utils/audit.ts for every change.
- Frontend uses src/lib/api.ts. Keep the brick/navy look already in the app.
- A convenor/manager may only touch THEIR conference; another conference id -> 403/404.
- Managers see the same portal minus what their permissions don't allow (hide those items).

1. PORTAL LAYOUT (src/pages/ConvenorPage.tsx)
- Replace the top tab row with a left sidebar (collapsible drawer on mobile), grouped:
  Overview: Dashboard
  Setup: Conference details, Logo and branding, Location, Key dates, Tracks, Review settings
  People: Role requests (with pending count badge), Members and roles, Committees, Speakers
  Papers: Submissions, Reviews and decisions
  Event: Programme and rooms, Attendance, Certificates   (Part B/C fill these in)
  Communication: Announcements, Email templates, Email log
  Reports: Reports and export, Activity log
  Supporters stays under Setup.
- Each item has its own URL (/convenor/dashboard, /convenor/tracks ...) so refresh and the
  back button work. Unbuilt items show a friendly "Coming soon" panel, not an error.
- Conference switcher at the top if the user is convenor/manager of more than one conference.

2. DASHBOARD  GET /api/conferences/:id/dashboard  (conference.view_internal)
- Cards: submissions (by status), reviews done / assigned, accepted papers, members by role,
  registrations (0 until built), days to next key date.
- "Needs your attention" list with links: pending role requests, submitted papers with no
  reviewer, overdue reviews (due_at < now, not completed), papers with all reviews done but no
  decision, next deadline within 7 days.
- Small bar chart: submissions per track (plain SVG/CSS, no heavy chart library).

3. REVIEW SETTINGS  GET/PATCH /api/conferences/:id/settings (conference.manage)
- Form for conference_settings: review_mode (open / single blind / double blind),
  reviews_required, max_submissions_per_author, max_abstract_words, max_file_size_mb,
  allowed_file_types, authors_see_review_comments. Explain each field in one short line.
- Extend the existing settings module; keep the existing convenor-only GET working.

4. MEMBERS AND ROLES  (members.manage)
- List all members with name, email, role(s), status, joined date; search + filter by role.
- Change role (author/reviewer/session_chair/staff/manager), remove member (status removed),
  set reviewer max_review_load. The convenor role itself can NOT be changed or removed here
  (only the admin can), and nobody can remove themselves.
- "Invite by email": invite a reviewer/manager/staff/session chair by email. Existing user ->
  added directly + notification; new user -> invitation email with set-password link
  (reuse the existing invite flow and email worker).
- Reviewer tracks: choose which tracks a reviewer covers (reviewer_tracks) so the assign
  dialog can show "track match".

5. COMMITTEES  (committee.manage)
- CRUD committees (name, type, description, order, public yes/no) and committee members
  (pick an existing user OR type a name + affiliation + country; role chair / co-chair /
  secretary / member; order). Drag or arrow buttons to reorder.
- Public conference page: "Committees" section showing public committees and members.

6. SPEAKERS  (conference.manage)
- CRUD conference_speakers: name, designation, affiliation, bio, photo (reuse the image
  upload pipeline: magic-byte check + sharp, storage/public/speakers), type keynote /
  invited / panelist / guest, order, public yes/no.
- Public page: "Speakers" section with photo cards, keynotes first.

7. ANNOUNCEMENTS  (announcement.manage)
- CRUD with status draft / scheduled (publish_at) / published / archived, audience
  (all, authors, reviewers, session chairs, staff), "also send email".
- Publishing creates in-app notifications for the audience and, if send_email, queues
  emails through the existing worker (one per user, never one email with everyone in To).
- Scheduled ones publish automatically when publish_at passes (simple interval job).
- Public page: latest published announcements for audience "all".

8. EMAIL TEMPLATES  (conference.manage)
- List the platform templates; "Customise for this conference" copies one into a
  conference-specific row (email_templates.conference_id). Edit subject and body with a list
  of allowed {{placeholders}}, preview with sample data, "Reset to default" deletes the copy.
- Sanitise the HTML on save (allow simple tags only: p, br, strong, em, a, ul, ol, li, h2, h3).

9. EMAIL LOG (email.read) — keep the existing one, put it in the sidebar.

10. REPORTS AND EXPORT  (report.view)
- Download as .xlsx (use exceljs) and .csv: submissions (code, title, track, status,
  authors, average score, decision), reviews (paper, reviewer, scores, recommendation; no
  confidential comments unless review.read_all), members, committees.
- Respect blind review in exports for anyone without review.read_all.

11. ACTIVITY LOG  (audit.read — convenor only)
- Paged list of audit_logs for this conference: when, who, action, what. Filters by user,
  action and date. Read-only.

12. TESTS AND FINISH
- Backend tests for every new route: permission (author/reviewer 403, other conference 404),
  validation, convenor cannot be removed, self-removal blocked, scheduled announcement
  publishes, export hides confidential comments, template HTML sanitised.
- Playwright: convenor opens each sidebar item without errors on desktop and 390px mobile;
  invite a reviewer by email; add a committee member and see it on the public page.
- npx tsc --noEmit, npm run build, npm test (server + frontend), npx playwright test pass.
- Update docs/final-test-report.md and write docs/convenor-portal-test-steps.md.
- Keep the backend running on port 4000 when you finish and give me a short list of what to
  click to test.

CONVENOR PART B — Programme, rooms, sessions, session chairs and presentations.
Do this after Convenor Part A works. Work through it without stopping to ask me unless a
database schema change is needed.

GROUND RULES (same as before)
- Do NOT change the database schema and do NOT run SQL yourself. Tables exist: rooms,
  schedule_slots, conference_sessions, session_chairs, presentations. DB triggers already
  block: two sessions in the same room at overlapping times, a session chair in two
  overlapping sessions, presentation times outside their session / overlapping inside it,
  and a paper being scheduled twice (presentations_submission_once_uq). Catch SIGNAL 45000
  and duplicate-key errors and show the message clearly to the user.
- Extend the existing server/src/modules/schedule module and src/pages/convenor/ProgrammeTab.tsx
  instead of starting over. Permission schedule.manage. All times entered and shown in
  Asia/Kathmandu, stored in UTC.

1. ROOMS
- CRUD rooms: name, room number, building, floor, capacity, equipment (checkbox list:
  projector, microphone, video conference, whiteboard, recording), description, active.
- Cannot deactivate a room that has published future sessions (show which ones).

2. TIME SLOTS (optional helpers)
- CRUD schedule_slots per day (e.g. "Morning 1, 09:00-10:30"), "Copy day" button.
- Creating a session can pick a slot to fill start/end automatically.

3. SESSIONS
- CRUD conference_sessions: title, type (paper, keynote, panel, workshop, poster, opening,
  closing, break), room, track (optional), start, end, description, status
  (draft / published / cancelled). Only published sessions appear publicly.
- Session chairs: pick only from active members who have the session_chair role
  (chair / co-chair). If the list is empty, show a link to Members and roles to add the role.
- Notify chairs (notification + email "presentation_scheduled"/"schedule_changed" template)
  when assigned or when the session time/room changes after publishing.

4. PRESENTATIONS (putting papers into sessions)
- In a session: "Add papers" lists ACCEPTED submissions (status accepted / full_paper_* /
  final_approved) not yet scheduled, filter by track. Or add a speaker talk (from
  conference_speakers) for keynote/panel sessions.
- Auto-calculate start/end from the session start + a per-paper duration (default 15 min),
  editable; reorder with up/down; remove (status cancelled).
- When a paper is scheduled: submission status -> scheduled (respect the trigger rules and
  set @app_user_id/@app_reason); unscheduling moves it back (scheduled -> final_approved or
  accepted, whichever it came from — store it in the status history reason or derive from
  history). Notify the presenting author.
- Session chair portal: chairs see their sessions and can mark each presentation presented /
  absent (status + marked_by/marked_at). Marking presented moves the submission to presented.

5. VIEWS
- Convenor: day tabs; grid view (rooms as columns, time as rows) and list view. Colour by
  track. Warnings panel: accepted papers not yet scheduled, sessions without a chair,
  sessions over room capacity (if registrations exist later).
- Public conference page: "Programme" section with day tabs, published sessions only, room,
  chairs, papers with authors (respect nothing secret: only accepted/scheduled info).
  "Download programme" as PDF (pdfkit or pdf-lib) and add-to-calendar (.ics) per session.
- Author portal: shows when and where their paper is presented.
- Mobile 390px: grid collapses to a list.

6. TESTS AND FINISH
- Backend: room overlap rejected with a clear message; chair double-booking rejected; paper
  scheduled twice rejected; status changes accepted -> scheduled -> presented; unschedule
  restores status; only schedule.manage can edit; public endpoint returns published only;
  .ics and PDF download work.
- Playwright: convenor creates a room and a session, adds an accepted paper, publishes it,
  it shows on the public programme; session chair marks it presented.
- npx tsc --noEmit, npm run build, npm test, npx playwright test pass.
- Update docs/final-test-report.md and write docs/programme-test-steps.md.
- Keep the backend running on port 4000 when you finish.

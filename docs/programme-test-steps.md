# Programme (Convenor Part B) manual test steps

Rooms, time slots, sessions, session chairs and presentations, under the
Convenor Portal's **Event → Programme** tab, plus the public programme on the
conference page, the author's "your presentation" notice, and a dedicated
`/session-chair` portal for marking attendance. Pair this with `npm run build`,
`npm test` (both `server/` and the repo root) and `npx playwright test`, which
already cover this ground automatically — see `docs/final-test-report.md` for
the automated results.

## Before you start

Same prerequisites as `docs/convenor-portal-test-steps.md`: MySQL loaded,
backend on `http://localhost:4000` (`cd server && npm run dev`), frontend on
`http://localhost:5173` (`npm run dev`). You'll want:

- a **convenor** of one conference,
- at least one **accepted** submission (status `accepted`, `full_paper_*`, or
  `final_approved`),
- a member holding the **session_chair** role for that conference (appoint one
  from Members and roles),
- optionally a **speaker** (Speakers tab) to test keynote/panel talks that
  aren't tied to a paper.

All times are entered and shown in Asia/Kathmandu; they're stored in UTC.

---

## Part A — Rooms

| # | Click path | Expected result |
|---|---|---|
| A1 | Programme → "Add room" with name, room number, building, floor, capacity, equipment checkboxes, description | Appears in the rooms table with every field shown. |
| A2 | Create a session in that room, publish it with a future start time, then try "Deactivate" on the room | Rejected — the error names the session title and time. |
| A3 | Deactivate a room with no published future sessions | Succeeds immediately; it disappears from the room picker on the session form (but stays visible in the rooms table, dimmed status). |

## Part B — Time slots

| # | Click path | Expected result |
|---|---|---|
| B1 | Programme → "Time slots" → add a slot (e.g. "Morning 1", 09:00–10:30) | Appears in the list. |
| B2 | Create a session and pick that slot from the new "Time slot" dropdown | Start/end fields below fill in automatically; you can still edit them afterwards. |
| B3 | "Copy day from" one date "to" another date that has slots on the first day | Reports how many slots were copied; the second day now has matching slots at the same wall-clock times. |
| B4 | Copy a day with no slots | "No slots found on that day." — nothing created. |
| B5 | Edit or delete a slot | Updates/removes immediately; deleting a slot already used by a session does not delete the session (slot_id just becomes stale — the session keeps its own stored times). |

## Part C — Sessions

| # | Click path | Expected result |
|---|---|---|
| C1 | Add a session: title, type, track (optional), room, start/end, status "draft" | Appears in the sessions table; not visible on the public conference page yet (draft). |
| C2 | Edit it, set status to "published" | Now shows on the public conference page's Programme section. |
| C3 | Try creating a session whose room already has an overlapping published session | Rejected — the database trigger's message is shown verbatim. |
| C4 | Try creating a session outside the conference's start/end dates | Rejected — "This session must fall within the conference dates." |
| C5 | More than one distinct day of sessions exists | Day tabs appear above the sessions list; clicking one filters to that day only. |
| C6 | Toggle **List / Grid** (desktop width only) | Grid shows rooms as columns and start times as rows, with sessions coloured by track; List shows the flat table. At 390px width the toggle is hidden and only the list renders (no horizontal page scroll). |
| C7 | Delete a session | Removed from the list; any of its presentations are also gone (cascade). |

## Part D — Session chairs

| # | Click path | Expected result |
|---|---|---|
| D1 | Open "Manage" on a session → chair picker | Only lists active members holding the **session_chair** role; if none exist, a note points at Members and roles. |
| D2 | Add a chair | Appears under Chairs with their role (Chair/Co-chair); they get a notification + email ("schedule_changed"-style). |
| D3 | Publish the session, then edit its room or time | Chairs and any scheduled presenting authors are notified again (notification + email). |
| D4 | Remove a chair | Disappears immediately. |

## Part E — Presentations

| # | Click path | Expected result |
|---|---|---|
| E1 | "Manage" on a session → "Add an accepted paper" dropdown | Lists only accepted/full-paper/final-approved submissions not already scheduled, filtered by the session's track if it has one. |
| E2 | Add a paper (default 15 minutes, editable) | Appears under "Papers and talks" with its computed start/end; the paper's submission status becomes `scheduled`; the presenting (corresponding) author is notified. |
| E3 | Add a speaker talk (title + duration) instead, on a keynote/panel session | Appears the same way, credited to the speaker instead of a submission. |
| E4 | Reorder with the ↑/↓ buttons | Times repack back-to-back from the session start, in the new order. |
| E5 | Remove a presentation | Status becomes `cancelled`; the submission reverts to whatever status it had before scheduling (`accepted` or `final_approved`). |
| E6 | Try scheduling the same paper into a second session | Rejected — a paper can only be scheduled once. |
| E7 | Mark a presentation **Presented** (from Manage, or from `/session-chair` — see Part G) | Submission status becomes `presented`; marked_by/marked_at recorded. |
| E8 | Mark a presentation **Absent** | Status field just records `absent` — the submission status is left alone. |

## Part F — Public programme and author view

| # | Click path | Expected result |
|---|---|---|
| F1 | Visit the conference's public page, Programme section | Day tabs, published sessions only, each with room, chairs, and papers with author names. |
| F2 | "Download programme (PDF)" | Downloads a PDF grouped by day with session times, rooms, chairs and papers. |
| F3 | "Add to calendar" on a session | Downloads a single-event `.ics` file for that session. |
| F4 | Sign in as the presenting author, open their scheduled submission | A "Your presentation" box shows the session, room and time. |
| F5 | At 390px width | No horizontal page scroll; the programme list reads top-to-bottom. |

## Part G — Session chair portal (`/session-chair`)

| # | Click path | Expected result |
|---|---|---|
| G1 | Sign in choosing role "Session Chair" | Lands on `/session-chair`, "My sessions" — lists every session they chair, across conferences, newest first by start time. |
| G2 | "Mark attendance" on a session | Shows its presentations with Presented/Absent buttons and each one's current status. |
| G3 | Mark one Presented | Status badge updates to "presented" without leaving the page; the underlying submission moves to `presented` (same as E7). |
| G4 | "← Back to my sessions" | Returns to the list. |
| G5 | A member with no chair assignments signs in | "You are not assigned to chair any sessions yet." — not an error. |

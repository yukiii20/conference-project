# Feature completion matrix — Phase 0

**Date:** 1 November 2026 · **Commit:** `cc7e74b`

## Status key

| Status | Meaning |
|---|---|
| **Verified** | Proven working *in this audit*: its tests ran and passed here, or the output was inspected. |
| **Not verifiable** | Fully implemented end to end (UI → API → DB) and covered by database-backed or end-to-end tests that passed in earlier recorded runs (`docs/progress.md`), but those tests **could not run in this audit** (no database). Treat as "probably working, unproven today". |
| **Partial** | Some of it is missing or limited (the gap is described). |
| **Not implemented** | No working code path. |
| **Broken** | Known to fail. |

"Tests" names the files under `server/tests/` (`.test.ts`) and `e2e/` (`.spec.ts`).

Every feature in the **Not verifiable** rows becomes Verified or Broken in Phase 10, once a
database is available.

---

## Accounts and access

| Feature | Status | Tests | Notes |
|---|---|---|---|
| Registration (per conference) | Not verifiable | signup, auth / registration.spec, main.spec | |
| Login, logout, remember me | Not verifiable | auth, session | Login is per conference since `53af871`. |
| Forgot / reset password | Not verifiable | passwordReset | |
| Invitation acceptance + set password | Not verifiable | convenorInvite | |
| Session expiry + cleanup job | Not verifiable | session | The cleanup job pauses while Render sleeps (audit H2). |
| Account lockout / unlock | Not verifiable | auth, adminUsers | `users.locked_until` |
| Profile edit, photo, change password | Not verifiable | me | Photos are re-encoded with sharp. |
| Pending / suspended / deactivated handling | Not verifiable | adminUsers, roleRequests | |
| Rate limiting (auth, uploads, public forms) | Not verifiable | security | |
| Per-conference session binding | Not verifiable | conferenceScope | Needs `06_session_conference.sql` on every database. |

## Platform administration

| Feature | Status | Tests | Notes |
|---|---|---|---|
| Create / edit / soft-delete conferences | Not verifiable | admin, conferenceManage | |
| Publish / unpublish (conference status) | Not verifiable | conferenceManage | |
| Branding (logo, banner, colour, tagline) | Not verifiable | conferenceManage | **Files are lost on Render redeploy (audit C1).** |
| Users: suspend, reactivate, unlock, anonymise | Not verifiable | adminUsers, adminStep2 | |
| Grant / revoke platform admin | Not verifiable | adminStep2 | |
| Super admin vs platform admin split | **Partial** | — | Only one platform admin level (`admin`). The seeded `organizer` role is unused (audit M7). |
| View-as (read-only) | Not verifiable | adminStep2 | Write-blocking is enforced on the server. |
| System health and platform settings | Not verifiable | adminStep2 | |
| Platform analytics | Not verifiable | analytics | Date range is calculated in UTC (audit M1). |
| Suggestion box | Not verifiable | suggestions | |

## Conference setup

| Feature | Status | Tests | Notes |
|---|---|---|---|
| Tracks, deadlines, settings | Not verifiable | tracks, deadlines | |
| Committees, speakers, supporters | Not verifiable | committees, speakers, supporters | |
| Members and role requests (approve / reject) | Not verifiable | members, roleRequests / notifications.spec | Raw `{{conference_code}}` in role emails was fixed on 1 Nov. |
| Locations | Partial | — | A single venue/city per conference, not a list of locations. |

## Submissions

| Feature | Status | Tests | Notes |
|---|---|---|---|
| Abstract draft → submit, keywords, track | Not verifiable | submissions / submissions.spec | |
| Co-authors (`submission_authors`) | Not verifiable | submissions | |
| File upload (content-checked) | Not verifiable | submissions | Files are lost on redeploy (C1). |
| Edit, withdraw | Not verifiable | submissions | |
| Full paper, revision, camera-ready | Not verifiable | submissions | |
| Status history | Not verifiable | submissions | Times shown in browser-local time (M1). |
| Decision notifications | Not verifiable | reviews, emailWorker | |

## Peer review

| Feature | Status | Tests | Notes |
|---|---|---|---|
| Reviewer invitations / approval | Not verifiable | convenorInvite, roleRequests | |
| Bidding | Not verifiable | reviewBidding / reviewBidding.spec | |
| Manual assignment, conflicts of interest | Not verifiable | reviews | |
| Auto-assign with explanation | Not verifiable | autoAssign, autoAssignRoutes | |
| Review form, scores, confidential comments | Not verifiable | reviews | |
| Deadlines, overdue tracking, reminders | Not verifiable | reviewReminders | Reminders pause while Render sleeps (H2). |
| Editorial decisions | Not verifiable | reviews | |
| **Double-blind anonymity** | **Partial** | reviews, reviewBidding.spec | Reviewer screens hide authors, but **downloaded files keep their original filename and document metadata** (audit H1). |

## Programme

| Feature | Status | Tests | Notes |
|---|---|---|---|
| Rooms, days, sessions, presentations, chairs | Not verifiable | schedule, programme / programme.spec | |
| Conflict detection (room / presenter / chair / overlap) | Not verifiable | schedule | Enforced by DB triggers in `03_triggers.sql`. |
| Copy day; list and grid views | Not verifiable | programme.spec | |
| Publish; public programme | Not verifiable | schedule | Public queries filter `status='published'` (checked). |
| Programme PDF, ICS (single + My agenda feed) | Not verifiable | agendaIcs, pdfUtils | |
| My agenda + calendar feed | Not verifiable | agenda / agenda.spec | Needs the batch-3 SQL. |
| Session timer | Not verifiable (logic **Verified**) | sessionTimer, `src/lib/sessionTimer.test.ts` | Pure timer logic passed here. |

## Registration and on-site

| Feature | Status | Tests | Notes |
|---|---|---|---|
| Attendee registration, status | Not verifiable | registration / registration.spec | |
| **Registration categories and fees** | **Not implemented** | — | Tables + trigger exist; no code (audit H3). |
| **Online payment** | **Not implemented** | — | `payments` tables exist, unused. Payment is a manual "confirm" step. |
| Digital ticket + QR | Not verifiable (decoding **Verified**) | registration, `qrDecode.test.ts` | |
| Check-in: camera / QR image upload / ticket code / manual | Not verifiable | checkinMethods.spec | Duplicate same-day check-in is refused. |
| Attendance reports | Not verifiable | reports | |
| Name badges | Not verifiable | badges / badges.spec | |

## Certificates

| Feature | Status | Tests | Notes |
|---|---|---|---|
| PDF rendering and layout | **Verified** | (manual render, 1 Nov) | Sample PDFs rendered and inspected: default and fully customised designs, long names, 1 and 2 signatories. There's no *automated* layout test. |
| Template editor (all text, colours, font, show/hide, live preview) | Not verifiable | — | Added 1 Nov. Typecheck and build pass; the page needs a database to load. |
| Background and signature images | Not verifiable | certificates | Lost on redeploy (C1). |
| Bulk / individual issue, release gating, revoke | Not verifiable | certificates | |
| Public verification (revoked = invalid) | Not verifiable | certificates | `valid` only when `status='issued'` (checked in code). |
| Issue-date timezone | **Partial** | — | Printed in UTC (M1). |

## Communication

| Feature | Status | Tests | Notes |
|---|---|---|---|
| Announcements (incl. scheduled) | Not verifiable | announcements | Scheduled publishing pauses while Render sleeps (H2). |
| Bulk email + recipient groups + quota | Not verifiable | bulkEmail / bulkEmail.spec | |
| Email templates | Not verifiable | emailTemplates | |
| Email log, retry, failure handling | Not verifiable | emailLogRetry, emailWorker | |
| **Provider-confirmed delivery / bounce** | **Not implemented** | — | Statuses exist but no Brevo webhook sets them (M2). |
| Brevo provider | Not verifiable | brevoProvider | Real delivery has never been tested with a real API key. |
| In-app notifications | Not verifiable | notifications / notifications.spec | |
| Feedback survey + invitations | Not verifiable (results maths **Verified**) | feedback, feedbackResults | `feedbackResults` is pure and passed here. |

## Reports and analytics

| Feature | Status | Tests | Notes |
|---|---|---|---|
| Convenor analytics | Not verifiable | analytics / analytics.spec | UTC date range (M1). |
| Excel / CSV reports | Not verifiable | reports | |
| Activity log | Not verifiable | activityLog | |
| Book of abstracts | Not verifiable | abstractBook, abstractBookPdf | Issue date printed in UTC (M1). |

## Cross-cutting

| Area | Status | Notes |
|---|---|---|
| Typecheck (frontend + server) | **Verified** | Clean |
| Production build | **Verified** | Succeeds |
| Frontend unit tests | **Verified** | 75/75 |
| Server tests without a database | **Verified** | 308 pass |
| Server tests with a database | Not verifiable | 366 tests across 45 files need MySQL |
| Playwright end-to-end | Not verifiable | 20 specs. Last recorded: 109–111/111. |
| Responsive (320–1440 px) | Not verifiable | `responsive.spec`, `usabilityAudit.spec` exist; 1920 px and real devices never tested. |
| Persistent file storage in production | **Broken** | Audit C1 |
| Lighthouse / k6 | Not verifiable | Last recorded figures are in `production-readiness.md` |

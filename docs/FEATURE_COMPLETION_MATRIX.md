# Feature completion matrix

**Updated:** 1 November 2026, release branch `release/production-candidate`.
Replaces the Phase 0 matrix (commit `cc7e74b`), which was written before any database-backed
test had ever run and before the R2, anonymisation, payments, super-admin, Brevo-webhook and
tick work landed.

## Status key

| Status | Meaning |
|---|---|
| **Verified** | Proven in this release pass: its automated tests ran against a real MySQL 8.0.45 database (server Vitest) and/or a real browser (Playwright), and passed. |
| **Verified (code)** | Logic proven by tests that don't need external services (mocked provider, parsed output). The real external service has not been exercised. |
| **Owner action** | Implemented and tested locally; needs the owner's credentials, account or a physical device before it can be called live. |
| **Partial** | Works, with a described limitation. |
| **Not implemented** | No working code path. |

Test names are files in `server/tests/` (`.test.ts`, run against `conference_cms_test`) and
`e2e/` (`.spec.ts`, Playwright against a seeded test database). Results are in
`docs/FINAL_RELEASE_REPORT.md`.

---

## Accounts and access

| Feature | Status | Tests |
|---|---|---|
| Registration (per conference), approval | Verified | signup, roleRequests / main.spec |
| Login, logout, remember me (per-conference sessions) | Verified | auth, session, conferenceScope / main.spec |
| Signed-in check on public pages without a console 401 (`GET /auth/session`) | Verified | authSession |
| Forgot / reset password, single-use tokens | Verified | passwordReset |
| Invitation acceptance + set password | Verified | convenorInvite / adminPortal.spec |
| Session expiry + cleanup job | Verified | session, tick |
| Account lockout / unlock | Verified | auth, adminUsers |
| Profile edit, photo, change password | Verified | me |
| Pending / suspended / deactivated handling | Verified | adminUsers, roleRequests |
| Rate limiting (auth, uploads, public forms, machine endpoints, email triggers) | Verified | security |
| Per-conference session binding (conference isolation) | Verified | conferenceScope, roleMatrix |

## Platform administration

| Feature | Status | Tests |
|---|---|---|
| Create / edit / soft-delete conferences, publish / unpublish | Verified | admin, conferenceManage / adminPortal.spec |
| Branding (logo, banner, colour, tagline) | Verified (local storage) | conferenceManage / main.spec. Persistence across Render deploys needs R2 (owner action). |
| Users: suspend, reactivate, unlock, anonymise | Verified | adminUsers, adminStep2 |
| Super admin vs platform admin | Verified | superAdmin, adminUsers. Live database needs `database/2026-11-01-part-2/`. |
| View as admin (read-only) | Verified | adminStep2 / adminPortal.spec. Blocks writes server-side while the view-as header is sent; it is a safety guard, not a privilege boundary (platform admins hold write rights anyway). |
| System health, platform settings, audit log, email log | Verified | adminStep2, activityLog, emailLogRetry |
| Platform analytics (Nepal-day buckets) | Verified | analytics, timezone / analytics.spec |
| Suggestion box | Verified | suggestions / suggestions.spec |

## Conference setup

| Feature | Status | Tests |
|---|---|---|
| Tracks, key dates, settings | Verified | tracks, deadlines / main.spec |
| Committees, speakers, supporters | Verified | committees, speakers, supporters / convenorPortal.spec |
| Members and role requests | Verified | members, roleRequests / notifications.spec |
| Locations | Partial | One venue/city per conference, not a list. |
| Unsaved-changes guard (app dialog, cleared by any successful save) | Verified | convenorPortal.spec, reviewBidding.spec |

## Submissions

| Feature | Status | Tests |
|---|---|---|
| Abstract draft → submit, keywords, track, co-authors | Verified | submissions / submissions.spec |
| File upload (content-checked), edit, withdraw | Verified | submissions |
| Full paper, revision, camera-ready | Verified | submissions / submissions.spec |
| Status history, decision notifications | Verified | submissions, reviews, emailWorker |

## Peer review

| Feature | Status | Tests |
|---|---|---|
| Reviewer invitations / approval | Verified | convenorInvite, roleRequests |
| Bidding | Verified | reviewBidding / reviewBidding.spec |
| Manual + auto assignment, conflicts of interest | Verified | reviews, autoAssign, autoAssignRoutes |
| Review form, scores, confidential comments, decisions | Verified | reviews / submissions.spec |
| Deadlines, overdue tracking, reminders | Verified | reviewReminders, tick |
| **Double-blind anonymity** | Verified | reviews, anonymize / reviewBidding.spec. Neutral download names; author metadata stripped from PDF (Info + XMP), DOCX/PPTX core/app/custom properties, and tracked-change, comment and comment-author names. Limits in the release report. |

## Programme

| Feature | Status | Tests |
|---|---|---|
| Rooms, days, sessions, presentations, chairs; clash detection (DB triggers) | Verified | schedule, programme / programme.spec |
| Copy day; list and grid views; publishing; public programme | Verified | schedule / programme.spec |
| Programme PDF, ICS (single + My agenda feed) | Verified | agendaIcs, pdfUtils / agenda.spec |
| My agenda, starred sessions, calendar feed | Verified | agenda / agenda.spec |
| Session timer | Verified | sessionTimer / sessionTimer.spec |

## Registration and on-site

| Feature | Status | Tests |
|---|---|---|
| Attendee registration, ticket, QR generation and decoding | Verified | registration, `src/lib/qrDecode.test.ts` / registration.spec |
| Registration categories, prices with validity windows, overlap prevention | Verified | registrationFees, registrationFeesValidation |
| Free / paid registration, manual payments (cash, bank, eSewa, Khalti, Fonepay, other), part + full payment, auto-confirm, void, waive | Verified | registrationFees |
| **Online payment checkout** | Not implemented | Payments are recorded by staff. Recording an eSewa/Khalti payment is *not* gateway integration. |
| Check-in: QR image upload / ticket code / manual; duplicate same-day check-in refused | Verified | checkinMethods.spec |
| Check-in by phone camera | Owner action | Needs a real phone over HTTPS (`Permissions-Policy: camera=(self)`). |
| Attendance reports and exports (CSV formula-safe) | Verified | reports, csv |
| Name badges | Verified | badges / badges.spec |

## Certificates

| Feature | Status | Tests |
|---|---|---|
| PDF rendering and layout (A4, long names, Nepal issue date) | Verified | certificatePdf |
| Template editor with live preview, background + signature images | Verified | certificates / convenorPortal.spec |
| Bulk / individual issue, release gating, revoke | Verified | certificates / registration.spec, portal.spec |
| Public verification (revoked = invalid) | Verified | certificates |

## Communication

| Feature | Status | Tests |
|---|---|---|
| Announcements (incl. scheduled) | Verified | announcements, tick |
| Bulk email, recipient groups, quota | Verified | bulkEmail / bulkEmail.spec |
| Email templates, log, retry, failure handling | Verified | emailTemplates, emailLogRetry, emailWorker |
| Brevo delivery webhook (auth, delivered, bounced, duplicates, out-of-order) | Verified (code) | brevoWebhook, brevoWebhookDb. Live: owner sets `BREVO_WEBHOOK_SECRET`. |
| Real email delivery through Brevo | Owner action | brevoProvider (mocked). Never sent with the real API key in this pass. |
| In-app notifications | Verified | notifications / notifications.spec |
| Feedback survey + invitations | Verified | feedback, feedbackResults / feedback.spec |

## Reports, storage, jobs

| Feature | Status | Tests |
|---|---|---|
| Convenor analytics, Excel/CSV reports, activity log, book of abstracts | Verified | analytics, reports, activityLog, abstractBook, abstractBookPdf |
| Local file storage, private download authorisation, streaming, 404 on missing | Verified | storage, submissions |
| Cloudflare R2 storage driver | Verified (code) | storage (S3 client mocked). Real bucket: owner action. |
| Background tick endpoint + GitHub workflow | Verified (code) | tick. Workflow runs once the owner adds secrets. |

## Cross-cutting

| Area | Status |
|---|---|
| Database: fresh install = upgrade path = test database (schema and reference data) | Verified on MySQL 8.0.45 |
| Typecheck, ESLint (frontend + server), production builds | Verified |
| Frontend unit tests, server tests (with MySQL), Playwright end-to-end | Verified (see release report) |
| Responsive 320–1440 px | Verified by responsive.spec and usabilityAudit.spec in headless Chromium; real devices: owner action |
| Lighthouse / k6 | Not run in this pass (need the deployed site) |

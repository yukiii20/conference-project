# Registration, attendance and certificates (Convenor Part C) manual test steps

Simple free registration, QR check-in, and certificates — under the public
conference page (Register / My ticket / My certificates), the Convenor
Portal's **Event → Attendance** and **Event → Certificates** tabs, a
dedicated `/staff` check-in page, and the public `/verify/:token` page. Pair
this with `npm run build`, `npm test` (both `server/` and the repo root) and
`npx playwright test`, which already cover this ground automatically — see
`docs/final-test-report.md` for the automated results.

## Before you start

Same prerequisites as `docs/programme-test-steps.md`: MySQL loaded, backend
on `http://localhost:4000`, frontend on `http://localhost:5173`. You'll want:

- a **convenor**,
- a **staff** member (Members and roles),
- the conference's **registration** key date open (Key dates tab — this
  table already existed; registration/certificate dates just weren't wired
  to anything until this step),
- Review settings → "Registration, attendance and certificates" section, to
  turn payment requirement / session attendance / minimum sessions /
  currency on or off.

All times are entered and shown in Asia/Kathmandu; stored in UTC. Payment
itself is out of scope — this is the free-registration groundwork a paid
flow can extend later.

---

## Part A — Registration categories and free registration

| # | Click path | Expected result |
|---|---|---|
| A1 | Convenor → Event → Attendance → "Registration categories" → add one (code, name, order, active) | Appears in the list. |
| A2 | A brand-new conference with no categories yet: any signed-in user opens the public page's Registration section | A "General" category is created automatically the first time anyone looks. |
| A3 | Review settings → turn OFF "Registration requires payment" → a signed-in user clicks "Register to attend" | Registration goes straight to **confirmed** — ticket shows immediately. |
| A4 | Turn ON "Registration requires payment" → register again (different user) | Status is **pending** — ticket area explains payment is awaited. |
| A5 | Convenor → Attendance → Registrations → find the pending row → "Confirm" | Status flips to confirmed; the user's ticket now shows confirmed. |
| A6 | Register outside the registration key-date window (close it in Key dates first) | Rejected — "Registration is not open right now." |
| A7 | Try registering twice with the same account | Second attempt rejected — one active registration per user. |
| A8 | On "My ticket", "Cancel registration" | Registration disappears; the same user can register again afterwards. |
| A9 | Convenor → Attendance → Registrations → "Export CSV" | Downloads a CSV with registration number, name, email, category, status, amount — never the QR token. |

## Part B — Attendance check-in

| # | Click path | Expected result |
|---|---|---|
| B1 | On "My ticket", confirmed | Shows a QR code image and a "Download QR (PNG)" link — the QR encodes only a check-in URL, nothing personal. |
| B2 | Sign in as **staff** → lands on `/staff` → "Manual search" | Typing a name/email/registration number lists matches; "Check in" shows a big green "Checked in: Name". |
| B3 | Check the same person in again the same day | Rejected — "Already checked in today." |
| B4 | A browser/device with camera + QR support → "Start camera" → scan the ticket QR | Same big green confirmation, no manual search needed. |
| B5 | Try checking in a cancelled registration | Rejected — "This registration has been cancelled." |
| B6 | An **author** (no `attendance.record` permission) tries the check-in API directly | 403. |
| B7 | Staff page / Attendance tab | Shows "Confirmed registrations" and "Checked in today" counts. |
| B8 | Review settings → turn on "Enable per-session attendance check-in" | Session chairs and staff can check attendees into individual sessions (same QR/manual pattern), gated on this setting. |

## Part C — Certificates

| # | Click path | Expected result |
|---|---|---|
| C1 | Convenor → Event → Certificates → "Add a template" (type, name, recipient-name position, up to 2 signatories) | Appears in the list; creating a second **active** template for the same type quietly deactivates the old one (one active per type). |
| C2 | Edit a template → upload a background image and signature images | Uploaded; "Preview" opens a sample PDF with the template's layout and images. |
| C3 | "Generate certificates" → pick "Participation" | Shows eligible/new/already-issued counts; issues one PDF per confirmed, checked-in attendee (respecting "minimum sessions" if set). |
| C4 | Re-click "Generate certificates" for the same type | No duplicates — only genuinely new recipients get a certificate. |
| C5 | "Best paper" → choose a submission → "Issue to authors" | One certificate per author with a linked account. |
| C6 | "Speaker" → choose a speaker with a linked account → "Issue" | One certificate for that speaker; a speaker with no account is rejected with a clear message. |
| C7 | A recipient opens "My certificates" before release | Certificate is listed, but "Download" fails (403) until released. |
| C8 | Convenor → "Release now" (or set the certificate_release key date in the past) | Recipients are notified (notification + email); "Download" now works for them. |
| C9 | Convenor downloads any certificate, even unreleased | Always allowed — `certificate.manage` bypasses the release gate. |
| C10 | Convenor → "Revoke" with a reason | Status becomes revoked; `/verify/:token` for that certificate flips to invalid. |
| C11 | Visit `/verify/<token>` from a certificate's QR code, signed out | No login required — shows name, type, conference, issue date, and valid/revoked. |
| C12 | Visit `/verify/` with a made-up token | "Not found" — not an error page. |

## Known simplification

- The certificate PDF's "script font" for the recipient's name is approximated
  with `Times-Italic` at a large size — pdfkit ships no script typeface, and
  embedding a custom font file was out of scope here. Swap in a real
  signature-style font file later if the look needs to match the design
  brief exactly.
- `/verify/:token`'s valid/revoked behaviour is covered end-to-end by
  `server/tests/certificates.test.ts` (backend) rather than by Playwright —
  reaching a real token from the UI means decoding a QR code embedded in a
  downloaded PDF, which isn't practical to automate here.

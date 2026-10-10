CONVENOR PART C — Simple free registration, QR attendance and PDF certificates.
Do this after Convenor Part B works. Work through it without stopping to ask me unless a
database schema change is needed.

IMPORTANT: attendance rows in the database must point to a registration
(conference_attendance.registration_id and session_attendance.registration_id are NOT NULL).
Paid registration is NOT built yet, so this part adds a SIMPLE FREE registration that the
paid version can extend later.

GROUND RULES (same as before)
- Do NOT change the database schema and do NOT run SQL yourself. Tables exist:
  registration_categories, registrations, conference_attendance, session_attendance,
  certificate_templates, certificates. If a schema change is truly needed, stop and show
  me a new database/04_*.sql file first.
- Module pattern, zod, withTransaction, guards, audit. Permissions: registration.read_all,
  registration.manage, attendance.record (staff have it), certificate.manage.
- Times in Asia/Kathmandu for display, UTC in the DB.

1. FREE REGISTRATION (minimal)
- Convenor: manage registration_categories (code, name, description, active, order), e.g.
  general, student, author. Seed nothing automatically except: if a conference has no
  category when registration opens, create "general" once.
- Any logged-in user: "Register to attend" on the conference page during the 'registration'
  key-date window. Creates registrations row: category chosen, amount_due 0, currency from
  settings, status confirmed (pending if conference_settings.registration_requires_payment
  is TRUE — then show "Payment coming soon" and let the convenor confirm manually),
  registration_number <conferences.code>-R0001 via conference_counters ('registration'),
  qr_token = 48 random url-safe chars. One active registration per user (DB enforces it).
- User can cancel their registration. Convenor sees the list, search, confirm, cancel,
  export.
- "My ticket" page: registration number, name, conference, dates and a QR code image
  generated on the fly from qr_token (npm qrcode). The QR encodes only
  APP_URL/checkin/<qr_token>, nothing personal. Downloadable as PNG.

2. ATTENDANCE (attendance.record: convenor, manager, staff)
- Check-in page for staff: camera QR scanner in the browser (html5-qrcode or
  @zxing/browser), plus manual search by name/email/registration number.
  Scan -> POST /api/conferences/:id/checkin {qr_token, date?} -> shows a big green
  "Checked in: Name" or a red reason (not registered, cancelled, already checked in today,
  wrong conference). One check-in per registration per day (DB unique key).
- Optional check-out button. Session attendance: staff/session chair picks a session and
  scans; only allowed if conference_settings.session_attendance_enabled.
- Dashboard numbers: registered, checked in today, per session.
- The QR token is never exposed in lists; staff only see it by scanning.

3. CERTIFICATES (certificate.manage)
- Templates per certificate_type (participation, presentation, speaker, reviewer,
  session_chair, staff, best_paper): name, background image (upload, image pipeline,
  A4 landscape), layout JSON for text positions (simple form: name y-position, font size,
  colour), signatories (name, title, signature image upload). One active template per type.
  Live preview with sample data.
- Issue rules (button "Generate certificates" with a preview count before issuing):
  participation -> confirmed registrations with at least one check-in (and at least
  certificate_min_sessions session check-ins if that setting is set);
  presentation -> presenting authors of presentations marked presented;
  reviewer -> users with at least one submitted review;
  session_chair -> chairs of completed sessions; staff -> staff members.
  best_paper -> issued manually to a chosen submission's authors.
- Each certificate: certificate_number <code>-C0001 (conference_counters 'certificate'),
  verification_token 32 random chars, PDF generated with pdf-lib (or pdfkit) and saved to
  storage/private/certificates/<conference_id>/<id>.pdf, recipient_name snapshot. The DB
  unique key prevents duplicates; re-running only issues missing ones.
- The PDF contains: name, conference name, type wording, date, signatories, certificate
  number, a QR code to APP_URL/verify/<verification_token>.
- Only release to recipients after the 'certificate_release' key date (or manual "release
  now"); then notify them (notification + email certificate_available).
- Recipients: "My certificates" page to download their own PDFs.
- Public page /verify/:token (no login): shows valid / revoked, name, type, conference,
  issue date — nothing else. Rate limited.
- Convenor can revoke with a reason (status revoked) and re-issue.

4. TESTS AND FINISH
- Backend: register inside/outside window; one active registration; QR check-in once per
  day; wrong conference / cancelled rejected; staff can check in, author cannot; certificate
  eligibility per type; no duplicates on re-run; download only by the recipient or
  certificate.manage; verify page shows valid/revoked; QR token never returned in list APIs.
- Playwright: user registers, opens ticket with QR; staff checks them in by manual search;
  convenor generates participation certificates; user downloads the PDF; /verify works.
- npx tsc --noEmit, npm run build, npm test, npx playwright test pass.
- Update docs/final-test-report.md and write docs/attendance-certificates-test-steps.md.
- Keep the backend running on port 4000 when you finish.

EXTRA: default certificate design = A4 landscape, double border (primary_color outer, gold
#C9A24A inner), corner accents, logo on top, serif title, recipient name large in a script
font, two signature blocks with a gold seal in the middle, certificate number and issue
date bottom-left, verify QR code bottom-right.

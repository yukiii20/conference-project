# Fix list for the Conference Management System

Instructions for Claude Code. Read this whole file first, then work through it in the order given. Save it in the project root as `FIXES.md` and start Claude Code with: "Read FIXES.md and implement it, group by group."

The project is a React + Vite frontend (Vercel), a Node/Express backend (Render, free plan) and MySQL (Aiven). The frontend reaches the backend through Vercel rewrites for `/api` and `/files` (see `vercel.json`).

## Rules for the whole job

- Find the exact root cause of each problem in the CURRENT code before changing anything. The "likely cause" notes below come from an older copy of the project, so verify every one of them and tell me what you actually found.
- Keep all existing functionality. Do not delete tables, columns or data. Do not use dummy data.
- Work on a new git branch called `fixes-nov`. Make one local commit per group. Never push to GitHub.
- Before any database migration, explain it, show me the exact SQL, and wait for my OK. Migrations will be run by me on the Aiven database before I deploy.
- Backend-enforced permissions and validation, audit log entries for admin and convenor actions, no secrets in the frontend, no service-role keys.
- Give complete working code per file with exact file locations. Modern, responsive UI that matches the current design, with loading, empty and error states.
- After each group, run the TypeScript check (`npx tsc --noEmit -p tsconfig.app.json`, plus the server's own check), the existing tests and the production build, and make sure all pass. Add tests for every fix.
- At the end, give me: a summary per problem (root cause, fix, files changed), the exact SQL to run on Aiven, the new environment variables to add on Render and Vercel, and a manual test checklist.

## Order of work

1. Group A: file storage (problems 6, 8, 10, and the root of 5 and 1)
2. Group B: sessions and forms (problems 2, 4, 9)
3. Group C: emails and invitations (problems 3, 11)
4. Group D: certificates (problems 1, 7)
5. Group E: delete and recreate a conference (problem 12)
6. Group F: supporter logo (problem 5)
7. Group G: feedback on the conference home page (problem 13)

---

## Group A: file storage (problems 6, 8, 10)

**Symptoms**
- Problem 6 and 10: logos, banners, speaker photos and other pictures only show in the browser that uploaded them. On other computers they do not load.
- Problem 8: after an abstract is uploaded, some time later it can no longer be viewed or downloaded ("file is no longer available").

**Likely cause**
- Uploads are saved on the server's local disk (`server/src/storage/paths.ts`, `ensureStorageDirs`, served by `app.use('/files/public', express.static(...))`). Render's free plan has no persistent disk, so every deploy and every wake-up from sleep wipes the files. The database still points to them.
- Public files are served with `maxAge: '7d', immutable`, so the browser that uploaded the picture keeps it in its cache and still shows it, while every other browser gets a 404. That is why it looks like "only the uploader sees it".

**Required**
1. Add a storage layer with two drivers selected by `STORAGE_DRIVER`: `local` (the current behaviour, for development) and `s3` (any S3-compatible service, for example Cloudflare R2 or Backblaze B2), configured by `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`. Use `@aws-sdk/client-s3`.
2. Put ALL uploads behind it: logos, banners, speaker photos, supporter logos, venue or other pictures, abstracts and full papers (with versions), certificate backgrounds, signature images, generated certificate PDFs, badges, profile photos, and any other file the code writes to disk. Search the whole server for direct `fs` writes and `multer` destinations so nothing is missed.
3. Keep the stored path values in the database exactly as they are, so no data migration is needed. Keys in the bucket use the same relative paths.
4. Public files keep the URL `/files/public/...` (the Vercel rewrite already forwards it). The backend streams them from the bucket with correct content type. Replace `immutable` with a short `Cache-Control` (for example `public, max-age=3600`) plus an ETag, because paths can be reused after a replace.
5. Private files (abstracts, papers, certificate PDFs) stay private: the backend checks the permission first and then streams the file from the bucket. Never expose the bucket publicly for them and never put the bucket credentials in the frontend.
6. If a file is missing from storage, return a clear 404 with a message such as "This file is missing from storage. Please ask the author to upload it again." Show that message in the UI instead of a blank error. For images, show a neutral placeholder (first letter or icon) via `onError`, never the browser's broken-image icon.
7. In production, if `STORAGE_DRIVER` is `local`, log a loud warning at startup that files will be lost on redeploy.
8. Provide `server/scripts/migrate-storage.ts` that copies an existing local storage folder into the bucket (dry-run first), for files I still have on a machine.
9. In the final report, give me step-by-step setup instructions for creating the bucket and the access key, and the exact environment variables to add on Render.

**Done when**
- A picture uploaded on one computer shows on another computer and in a private window.
- It still shows after I redeploy the backend and after the free instance wakes from sleep.
- An uploaded abstract can be viewed and downloaded days later, after redeploys.

---

## Group B: sessions and forms (problems 2, 4, 9)

### Problem 2: super admin shows "Page not found" after a refresh or after some time

**Symptom:** in the super admin area, after refreshing or after some time, it shows "Page not found / return to home".

**Likely cause:** `src/components/SuperAdminRoute.tsx` shows the "Page not found" page whenever `refresh()` (GET /api/auth/me) does not return an admin. That includes: the 30-minute admin idle timeout (the session was revoked), a cold start or a 502 from Render when the free instance is waking up, and a slow request. All of them look like "denied", so the admin gets a misleading not-found page.

**Required**
1. Distinguish three results of the check: confirmed admin (show the page), confirmed not admin or no session (401 or 403), and temporary failure (network error, timeout, 502, 503).
2. For a temporary failure, retry up to 3 times with a short backoff and show "The server is waking up, please wait..." Never show not-found for a temporary failure. After the retries, show a "Could not reach the server" page with a Retry button.
3. When the idle timeout logs the admin out (or the session has expired), show "Your admin session expired" with a button to `/super-admin/login`, and return to the page they were on after login. Keep the existing masking for people who are not admins (visitors probing the URL still see the generic not-found page).
4. Check that the idle timer, the "session about to expire" warning and the refresh behave correctly, and that refreshing any /super-admin/* URL works (check vercel.json rewrites and React Router).

**Done when:** refreshing at any time after login keeps the admin on the same page, and an expired session shows a clear message, never "Page not found".

### Problem 4: a date is not saved the first time, I have to save twice

**Symptom:** I enter a date, click Save, and the date is not saved. The second save works.

**Likely causes to check:** (a) the form's "original values" are not refreshed after a save, so the first save sends a diff against stale data; (b) the date or datetime inputs convert time zones twice (the app shows Kathmandu time); (c) a different tab or endpoint (Conference details versus Dates and tracks) overwrites the date with an older value; (d) the save is sent before the last field change is committed, or validation compares against stale state; (e) a silent validation failure on the first attempt.

**Required**
1. Reproduce it in every place with dates: Conference details, Dates and tracks (key dates, deadlines), announcements (publish date), schedule (session times), registration windows.
2. Fix the root cause so that one click on Save persists every field. After a successful save, reload the data from the server and reset the form baseline.
3. Show a clear success message, and a clear error message for any validation failure (never a silent failure).
4. Use one shared helper for converting between the date inputs and the stored value (Kathmandu time), with tests for midnight, end of day and daylight-free edge cases.

**Done when:** setting any date and clicking Save once keeps it after a reload.

### Problem 9: "Discard changes or keep editing" appears although I changed nothing

**Symptom:** leaving a form shows the "Discard changes / Keep editing" dialog even though nothing was changed.

**Where to look:** `src/pages/convenor/DirtyGuard.tsx` and every form that uses it.

**Likely causes:** the dirty check compares raw values, so `null` versus `''`, a number versus a string, a trimmed versus untrimmed string, a date format, or an array order counts as a change; the baseline is not reset after loading or after saving; the form state is set by an effect after mount and is treated as a user change.

**Required**
1. Compare normalised values (trim, treat null/undefined/'' as equal, compare numbers and dates by value, ignore array order where it does not matter).
2. Set the baseline when the data finishes loading and again after every successful save, never during loading.
3. The dialog must appear only when the person really changed something. Add tests for: open then leave, edit then revert (no dialog), edit then leave (dialog), save then leave (no dialog).
4. Check that the background auto-refresh (if present) does not mark forms dirty.

**Done when:** opening a tab and leaving it without touching anything never shows the dialog, and a real change always does.

---

## Group C: emails and invitations (problems 3, 11)

### Problem 3: an account that already exists is used in another conference, and no email is sent for that conference

**Symptom:** if a person already has an account and is added to or uses another conference, the email is not sent for that conference.

**Where to look:** `server/src/modules/auth/service.ts` (`registerUser`), `members/service.ts` (`inviteMember`: for an existing user it only calls `notifyUser`, with no email), `roleRequests`, `server/src/utils/email.ts` (`queueEmail`), the email worker, `email_logs` and `email_templates`.

**Likely causes:** emails like "account created" and "invitation" are only queued when the user is new; an existing user only gets an in-app notification. The queue may also de-duplicate by user and template, so a second conference's email is treated as a duplicate. A conference-specific template may be missing without a fallback to the global one.

**Required**
1. List every place an email is sent and check what happens when the user already exists. Make sure an existing user still receives the conference-specific emails: role request received, role approved or rejected, added or invited to a conference, abstract submitted, review assigned, decision made, registration confirmation, certificate issued.
2. Remove or correct any de-duplication that blocks a legitimate email for a different conference. Duplicates should be decided per user, per conference, per template and per related item.
3. Fall back to the global template when the conference has no template of its own.
4. Failed or skipped emails must be visible: record the reason in the email log and show it in the convenor's Email log tab.
5. Add tests for an existing user being added to a second conference.

### Problem 11: when I invite a person, no email is sent and the person can log in directly

**Symptom:** inviting a person does not send an email, and the person can log in without accepting.

**Required**
1. Inviting must create a pending invitation, not an active membership. Add an `invited` status for a membership (check the current enum on `conference_members.status`; propose the migration) or use an invitations table, whichever fits the code better. Explain your choice first.
2. The invitation email is always sent (new and existing users) with a single-use link that expires (7 days). New users set their password through the link. Existing users sign in, see an accept screen with the conference name, the role and who invited them, and click Accept or Decline.
3. The person can only sign in with that role, and only sees that conference, after accepting. A pending invitation never gives access.
4. The convenor's Members tab shows invited people with the status "Invited" and offers Resend invitation and Cancel invitation. Show a clear warning to the convenor if the email could not be sent, with the reason.
5. Check why the invitation email is not being sent now (template missing, worker not running, Brevo sender not verified, wrong sender address) and fix the cause.
6. Update the link in the email and notifications to the sign-in page of that conference if conference-specific sign in pages exist.
7. Tests: invite a new email, invite an existing user, accept, decline, expired link, reused link, a pending invitation cannot log in, cancel invitation.

---

## Group D: certificates (problems 1, 7)

### Problem 1: when a certificate is issued, other people cannot view it

**Symptom:** after a certificate is issued, other people cannot view it.

**Required**
1. First clarify from the code who "other people" are, and make all of these work:
   - The recipient sees the certificate in their portal (My certificates), can open it and download the PDF.
   - Anyone with the certificate's public verification link or ID can see the verification page (holder, type, conference, number, date) and view and download the PDF, without logging in.
   - The convenor and managers can view every certificate of their conference.
2. Generate the certificate PDF on demand from the database and the template when it is requested, so viewing never depends on a stored file. If a template background or signature image is missing from storage, fall back gracefully instead of failing (see Group A).
3. Check the download routes for permission or ownership bugs (for example a route that requires the convenor permission), wrong content types, and CORS or rewrite problems through the Vercel `/api` proxy.
4. Send the recipient an email with a link when the certificate is issued (check that it is sent, see Group C).
5. Add tests for each viewer type.

### Problem 7: upload a complete, ready-made certificate (keep the current feature unchanged)

**Need:** besides templates, the convenor can upload a full finished certificate file, without creating a template. The current template-based issuing must keep working exactly as it does.

**Required**
1. In the convenor's Certificates tab add a second option next to templates: "Upload a ready-made certificate".
2. Flow: choose the certificate type, choose the recipient (search among the conference's registered participants, authors, reviewers and others, or enter an email), upload the file (PDF, PNG or JPEG, up to 10 MB, validated by file content and not only by extension), and click Issue.
3. The system creates the same certificate record as for template certificates (unique number such as CONF-CERT-2026-00125, issued date, type, recipient), stores the uploaded file as the certificate, and uses it everywhere the generated PDF is used: the recipient's My certificates, the download, the public verification page, and the issue email.
4. Optional checkbox, off by default: "Add the certificate number and a verification QR code at the bottom of my file".
5. Nice to have, only if it is straightforward: bulk upload of several files where each file name is the recipient's email (for example name@example.com.pdf), with a preview table to confirm the matches before issuing.
6. Revoking and re-issuing must work the same as for template certificates.
7. Tests for: valid and invalid files, wrong recipient, duplicate issue, verification page, permissions.

---

## Group E: delete a conference and create it again (problem 12)

**Symptom:** after I delete a conference and create a new one with the same name, it says "conference already exists". It should be possible to create the new conference with the old name, and the old conference's information should be available again.

**Likely cause:** conferences are soft-deleted (`deleted_at`), but the unique keys `conferences_slug_uq` and `conferences_code_uq` in `database/01_schema.sql` still include deleted rows, so the slug and code stay taken.

**Required**
1. Free the slug and code of deleted conferences. Preferred approach: generated columns such as `slug_live = IF(deleted_at IS NULL, slug, NULL)` and `code_live = IF(deleted_at IS NULL, code, NULL)` with unique indexes on them, and drop the old unique keys (MySQL allows many NULLs in a unique index). Explain the migration and show me the SQL first. Also check any other table with a unique key that a deleted conference could block (for example names or shortcodes).
2. Creating a conference whose name, slug or code matches a deleted conference works. When it does, show this choice before creating:
   - "Restore the deleted conference" (restores the old conference with all of its information and data, using the existing restore function), or
   - "Create a new conference" and optionally "Copy the settings from the deleted one" (details, dates, tracks, committees, speakers, supporters, email templates, settings), but not people, submissions or registrations.
3. If the old slug or code is needed by the restore and has since been taken by a new conference, the restore must ask for a new slug or code instead of failing silently.
4. The Super admin conference list lists deleted conferences with Restore, and shows their original name and slug.
5. Tests: delete then create with the same name, delete then restore, restore when the slug is taken, copying settings.

---

## Group F: supporter logo says "invalid" (problem 5)

**Symptom:** when I upload a logo for a supporter it shows "invalid", although the image is actually uploaded.

**Where to look:** `src/pages/convenor/SupportersTab.tsx`, `src/components/ImageUpload.tsx`, `src/lib/storage.ts` (`validateImageFile`), `server/src/modules/supporters/routes.ts`, and `server/src/storage/imageUpload.ts`.

**Required**
1. Reproduce it and find which check fails: the frontend validation, the backend file-type sniff (some valid PNG or WEBP files may be rejected), the response shape the frontend expects, or the image failing to load afterwards because of the missing-file problem in Group A (the upload works, but the file is not found when it is displayed, and that is reported as "invalid").
2. Fix the root cause and make the error messages accurate: separate "unsupported type", "file too large", "upload failed" and "could not load the image".
3. After a successful upload, show the new logo immediately and keep it after a refresh.
4. Tests for PNG, JPEG and WEBP files, an oversized file, and a wrong type.

---

## Group G: feedback on every conference home page (problem 13)

**Need:** a place on every conference's public home page (`/c/:slug`) where the audience can leave feedback about the conference.

**Required**
1. A "Feedback" section on the conference page (with an anchor `#feedback` and a link in the page navigation). The form has: an overall rating from 1 to 5 stars (required), "What went well" (optional), "What can be improved" (optional), "Other comments" (optional, up to 1000 characters in total per field), an optional name and email (anonymous feedback is allowed), and an optional "I took part as" choice (Author, Reviewer, Attendee, Speaker, Visitor).
2. Spam protection: a rate limit per IP (for example 5 per hour), a hidden honeypot field, plain text only (sanitise it, no HTML), and length limits. A signed-in person can leave at most one feedback per conference per day.
3. The convenor can turn feedback on or off for their conference (on by default) and can optionally set a window (for example open from the conference start date).
4. Database: a new table `conference_feedback` (id, conference_id, rating, liked, improve, comments, name, email, participant_type, user_id nullable, ip_hash, status visible/hidden, created_at) with an index on conference_id and ON DELETE CASCADE. Show me the SQL first.
5. Backend: a public POST endpoint (no login) with validation and the rate limit, and convenor-only endpoints (permission `conference.manage`) to list, filter, hide or delete, and export as CSV. Write audit log entries for hide and delete.
6. Convenor UI: a new "Feedback" tab with the average rating, the number of responses, a chart of the rating distribution (the project already has recharts), the list of comments with filters by rating and date, hide and delete actions, and a CSV export. Respect the read-only "view as admin" mode.
7. Feedback is private to the organisers by default (not shown publicly). Do not email the audience addresses unless I ask for it later.
8. Show a thank-you message after sending, keep the form accessible and responsive, and do not lose the person's text if sending fails.
9. Tests: valid and invalid submissions, honeypot, rate limit, permissions on the convenor endpoints, a deleted or unpublished conference does not accept feedback.

---

## Final report

When everything is done, give me:
1. A table with the 13 problems: root cause found, fix made, files changed.
2. The exact SQL to run on the Aiven database, in order (migrations for the invitation status, the unique keys of conferences, and the feedback table).
3. The new environment variables for Render and Vercel (storage keys and anything else).
4. The deploy order: Aiven SQL first, then the backend on Render (wait for "Deploy live"), then the frontend on Vercel.
5. A manual test checklist I can follow on the live site, one test per problem, including a test from a second computer or a private window for the picture and file problems.

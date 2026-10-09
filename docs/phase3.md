PHASE 3 — Move submissions, reviews and decisions from Supabase to Node/Express + MySQL,

then remove Supabase completely. Do PART A first. When its tests pass, do PART B.

Work through both without stopping to ask me unless a database schema change is needed.



GROUND RULES

\- Do NOT change the database schema and do NOT run SQL yourself. The schema already has

&#x20; submissions, submission\_authors, submission\_files, submission\_status\_history,

&#x20; conference\_counters, conference\_settings, conference\_deadlines, review\_assignments,

&#x20; reviews, submission\_decisions, conflicts\_of\_interest, reviewer\_tracks. If a schema change

&#x20; is truly needed, stop and show me a new database/04\_\*.sql file first.

\- Follow the existing backend structure: server/src/modules/<name>/{routes,service,validation}.ts,

&#x20; zod, withTransaction, requireAuth / requireConferenceRole / requireConferencePermission

&#x20; from middleware/auth.ts, utils/audit.ts, utils/email.ts queueEmail (dev console + email\_logs).

\- Frontend uses src/lib/api.ts for every call. No new Supabase code.

\- Never trust the browser: check membership, ownership, deadlines and status on the server.

\- Before every submission status UPDATE set @app\_user\_id and @app\_reason on the same

&#x20; connection so submission\_status\_history records who/why. DB triggers enforce allowed

&#x20; status transitions (submissions\_transition\_bu), lock submitted reviews (reviews\_lock\_bu)

&#x20; and lock decisions (decisions\_lock\_bu). Map SIGNAL 45000 errors to clear 400/409 messages.

\- Do not put passwords or secrets in code or in chat.



==================== PART A — AUTHOR SIDE ====================



A1. Author form data (fixes the empty Track dropdown)

GET /api/conferences/:id/author-form  (any ACTIVE member of that conference)

\-> { tracks: \[{id,name}] (is\_active = TRUE, ORDER BY display\_order, name),

&#x20;    settings: { max\_abstract\_words, max\_file\_size\_mb, max\_submissions\_per\_author, review\_mode },

&#x20;    windows: { abstract\_submission, full\_paper, final\_paper } each {opens\_at, closes\_at, is\_open} }

Defaults if no conference\_settings row: 300 words, 20 MB, no limit, double\_blind.



A2. Submissions API (new module server/src/modules/submissions)

Login required and the user must be an active author member of the conference. An author

only sees/changes submissions where created\_by = them OR they are linked in

submission\_authors.user\_id. Rows with deleted\_at are invisible.

\- GET    /api/conferences/:id/my-submissions   id, code, title, status, track name, updated\_at

\- POST   /api/conferences/:id/submissions      create DRAFT {track\_id, title, abstract, keywords\[], presentation\_preference}

&#x20;        \* track active and in this conference; abstract word count <= max\_abstract\_words (server-side)

&#x20;        \* max\_submissions\_per\_author enforced (ignore withdrawn/deleted)

&#x20;        \* add creator as author #1, is\_corresponding = TRUE, user\_id = creator, name/email from users

\- GET    /api/submissions/:sid      detail incl. authors, files (metadata only), status history,

&#x20;        feedback (A5), and flags can\_edit, can\_delete, can\_withdraw,

&#x20;        can\_upload {abstract, full\_paper, slides, camera\_ready} so the UI never guesses

\- PATCH  /api/submissions/:sid      edit core fields only while draft or revision\_required

\- POST   /api/submissions/:sid/submit   draft->submitted or revision\_required->submitted

&#x20;        \* first submit only inside abstract\_submission window (opens\_at <= now <= closes\_at + grace\_minutes)

&#x20;        \* on FIRST submit assign submission\_code via conference\_counters (INSERT IGNORE the row,

&#x20;          then SELECT ... FOR UPDATE, current\_value + 1), format <conferences.code>-0001

&#x20;        \* queue 'submission\_received' email to the corresponding author

\- POST   /api/submissions/:sid/withdraw {reason?}

\- DELETE /api/submissions/:sid   only if status is draft or submitted AND no review\_assignments

&#x20;        with status in\_progress/completed. Soft delete (deleted\_at = now, keep files/history).

&#x20;        If status is submitted, first move it to withdrawn with reason 'Deleted by author'.

&#x20;        Otherwise 409 "Already under review".

Co-authors (only while draft or revision\_required):

\- POST   /api/submissions/:sid/authors {full\_name, email, affiliation?, department?, country?, orcid?, is\_corresponding?}

&#x20;        order = max+1; if is\_corresponding, clear the old one FIRST in the same transaction;

&#x20;        corresponding author must have a user account (link user\_id by email)

\- PATCH  /api/submissions/:sid/authors/:aid   edit / reorder

\- DELETE /api/submissions/:sid/authors/:aid   not the last author, not the corresponding author



A3. Private file uploads (server/storage/private, never public)

\- POST /api/submissions/:sid/files/:kind  multipart field "file";

&#x20; kind = abstract | full\_paper | camera\_ready | slides | supplementary

\- Allowed: abstract, supplementary: pdf, doc, docx, png, jpg/jpeg, webp

&#x20;          full\_paper, camera\_ready: pdf, doc, docx

&#x20;          slides: pdf, ppt, pptx

\- Check REAL type from magic bytes with file-type (docx/pptx = zip-based OOXML, old doc/ppt =

&#x20; application/x-cfb; extension must match the sniffed family). Max size = max\_file\_size\_mb.

\- Status rules: abstract/supplementary while draft, submitted (before review starts) or

&#x20; revision\_required; full\_paper and slides only when accepted, full\_paper\_pending or

&#x20; full\_paper\_submitted AND inside the full\_paper window; camera\_ready only when final\_approved

&#x20; inside the final\_paper window.

\- Save to private/submissions/<conference\_id>/<submission\_id>/<kind>-v<version>-<random>.<ext>.

&#x20; Never use the original filename in the path. Store sanitised original\_filename, mime, size,

&#x20; sha256. version = max + 1; previous active file of same kind -> 'superseded'.

\- First full\_paper upload moves accepted/full\_paper\_pending -> full\_paper\_submitted.

\- GET /api/submissions/:sid/files/:fileId/download  streams with Content-Disposition:

&#x20; attachment. Allowed for the submission's authors, convenor/manager (submission.read\_all),

&#x20; and reviewers with an active assignment on it. Never expose storage\_path.

\- server/storage/private must NOT be served by express.static.



A4. Frontend (replace Supabase completely)

\- src/pages/AuthorPage.tsx, src/pages/author/SubmissionsList.tsx,

&#x20; src/pages/author/SubmissionDetail.tsx: replace every supabase call (submissions,

&#x20; submission\_authors, submission\_files, submission\_status\_history, rpc withdraw\_submission,

&#x20; rpc get\_submission\_feedback, supabase.auth.getUser) with the new API. Keep the current look.

\- src/lib/submissionFiles.ts: upload with FormData to the new endpoint, download via the

&#x20; download endpoint. No Supabase.

\- Show "Delete" only when can\_delete is true. Upload must be a button, not a bare file input.

\- Dates in Asia/Kathmandu with existing datetime.ts helpers.



A5. Feedback to the author

Return decisions (stage, decision, comments\_to\_author, decided\_at) and, if

conference\_settings.authors\_see\_review\_comments, comments\_to\_author of SUBMITTED reviews only.

Never confidential\_comments, never reviewer names, no scores when review\_mode is blind.



A6. Tests (Vitest + supertest on conference\_cms\_test, separate STORAGE\_ROOT, clean up)

\- author-form: member gets active tracks only; non-member 403; logged out 401

\- create/edit/submit; word limit; track from other conference rejected

\- submit outside window rejected; code generated once and sequential

\- other author cannot read/edit my submission (404)

\- co-authors; only one corresponding author

\- upload: valid pdf ok; text renamed .pdf rejected; image ok for abstract but not full\_paper;

&#x20; oversized rejected; file stored in private; download ok for owner, refused for other author

\- full paper only after accepted; first full paper -> full\_paper\_submitted

\- delete before review ok, refused once review in progress; withdraw works; history written



==================== PART B — REVIEWERS, CONVENOR, DECISIONS ====================



B1. Convenor/manager submissions overview (permission submission.read\_all)

\- GET /api/conferences/:id/submissions?status=\&track\_id=\&q=  id, code, title, status, track,

&#x20; submitted\_at, assignment count, completed reviews count, average overall\_score of submitted

&#x20; reviews. Exclude drafts and deleted.

\- GET /api/conferences/:id/submissions/:sid  core fields, authors (+photo url if any), files,

&#x20; assignments with reviewer name/email and full review incl. confidential comments

&#x20; (review.read\_all), decisions, status history.



B2. Assigning reviewers (permission review.assign)

\- GET /api/conferences/:id/reviewers?submission\_id=  active reviewer members with flags

&#x20; has\_conflict, already\_assigned, is\_author\_of\_submission, track\_match (reviewer\_tracks),

&#x20; open assignment count.

\- POST /api/conferences/:id/submissions/:sid/assignments {reviewer\_id, due\_at}

&#x20; \* reviewer must be an active reviewer of THIS conference

&#x20; \* reject if reviewer is an author of the paper (user\_id or same email) or has a conflict

&#x20; \* round = current\_round; unique (submission, reviewer, round); due\_at in the future

&#x20; \* if status is submitted -> under\_review

&#x20; \* queue 'review\_assigned' email

\- DELETE /api/conferences/:id/assignments/:aid {reason} -> cancelled (not if completed)

\- POST /api/conferences/:id/conflicts {submission\_id, user\_id, reason} (manager\_flagged)



B3. Reviewer portal (only their OWN assignments)

\- GET  /api/reviewer/assignments?conference\_id=  code, title, track, due\_at, status,

&#x20; is\_overdue (computed: due\_at < now and status assigned/in\_progress)

\- POST /api/reviewer/assignments/:aid/accept    assigned -> in\_progress, responded\_at = now

\- POST /api/reviewer/assignments/:aid/decline {reason}

\- POST /api/reviewer/assignments/:aid/conflict {reason} -> conflicts\_of\_interest

&#x20; (reviewer\_declared) + decline

\- GET  /api/reviewer/assignments/:aid  title, abstract, keywords, track, files (download

&#x20; allowed while assigned). review\_mode double\_blind/single\_blind -> NO author names, emails,

&#x20; affiliations or file uploader; open -> show authors.

\- PUT  /api/reviewer/assignments/:aid/review         save draft (scores 1-5)

\- POST /api/reviewer/assignments/:aid/review/submit  require originality, quality, relevance,

&#x20; methodology, overall\_score, confidence, recommendation, comments\_to\_author ->

&#x20; review submitted, assignment completed. Read-only afterwards.

\- Reviews only while assignment in\_progress and submission not withdrawn/deleted.



B4. Decisions (permission decision.make)

\- POST /api/conferences/:id/submissions/:sid/decisions

&#x20; {stage: abstract|full\_paper|final\_approval, decision: accepted|rejected|revision\_required,

&#x20;  comments\_to\_author?, internal\_notes?}

&#x20; \* round = current\_round; unique (submission, stage, round)

&#x20; \* abstract stage -> status submitted/under\_review; full\_paper and final\_approval ->

&#x20;   full\_paper\_submitted

&#x20; \* update status in the same transaction: abstract accepted -> accepted; full\_paper or

&#x20;   final\_approval accepted -> final\_approved; rejected -> rejected;

&#x20;   revision\_required -> revision\_required

&#x20; \* warn (UI confirm) if fewer submitted reviews than reviews\_required

&#x20; \* cancel open assignments of that round on a final decision

&#x20; \* queue decision\_accepted / decision\_rejected / decision\_revision\_required email, set notified\_at

\- After abstract acceptance the author can upload full paper and slides (A3 rules).



B5. Frontend (replace Supabase completely)

\- src/pages/convenor/SubmissionsTab.tsx, src/pages/convenor/SubmissionDetailPanel.tsx,

&#x20; src/pages/reviewer/AssignmentsList.tsx, src/pages/reviewer/ReviewForm.tsx,

&#x20; src/pages/ReviewerPage.tsx

\- Delete src/lib/sendQueuedEmails.ts and its callers (backend queues emails now).

\- Keep the existing look, buttons disabled while saving, clear messages, Kathmandu dates.



B6. Tests

\- convenor lists submissions; author/reviewer 403 on convenor routes

\- assign: non-reviewer, paper's own author, conflict, duplicate all rejected;

&#x20; submitted -> under\_review; email\_logs row created

\- reviewer sees only own assignments; other reviewer 404; double\_blind hides authors

\- review draft, submit validation, submitted review cannot be edited

\- reviewer download only while assigned

\- decision accepted -> author can upload full paper; second decision same stage/round

&#x20; rejected; author never sees confidential comments or reviewer identity

\- Playwright: author submits abstract -> convenor assigns reviewer -> reviewer accepts and

&#x20; submits review -> convenor accepts -> author uploads full paper



==================== FINISH ====================

\- Remove Supabase completely from src/: no imports, delete src/lib/supabase.ts, remove the

&#x20; @supabase/supabase-js dependency, no VITE\_SUPABASE keys used. Do NOT delete the supabase/

&#x20; or database\_supabase/ folders; I will archive them myself.

\- npx tsc --noEmit, npm run build (frontend) and npm test (server) must all pass.

\- Show me: grep -r "supabase" src  (should be empty).

\- Write docs/phase3-test-steps.md: step-by-step manual test, which user does what.

\- Make sure the backend is running on port 4000 when you finish, and give me a short list

&#x20; of what to click to test.


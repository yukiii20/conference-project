# Phase 3 manual test steps

Submissions, reviews and decisions, now served by the Node/Express + MySQL backend
instead of Supabase. This is a step-by-step script for a human to click through —
pair it with `npm run build`, `npm test` (both `server/` and the repo root) and
`npx playwright test e2e/submissions.spec.ts`, which already cover this ground
automatically.

## Before you start

1. MySQL is running with the `conference_cms` schema loaded (see `database/README.md`).
2. Backend: `cd server && npm run dev` — listens on **http://localhost:4000**.
3. Frontend: `npm run dev` (repo root) — listens on **http://localhost:5173**, proxying
   `/api` and `/files` to the backend.
4. You have (or can create) three accounts for one conference:
   - a **convenor** of that conference,
   - an **author**, approved by that convenor,
   - a **reviewer**, approved by that convenor.
   Sign-up is at `/signup?conference=<slug>`; approval happens on the convenor's
   "Role requests" tab.
5. As the convenor, open **Tracks** and make sure at least one active track exists,
   and open **Key dates** and set "Abstract submission" to a window that includes
   now (and, before Step 6 below, "Full paper submission" the same way).

---

## Part A — as the Author

| # | Click path | Expected result |
|---|---|---|
| A1 | Sign in as the author → `/author` | The page loads; if you belong to more than one conference, a selector appears. |
| A2 | "New abstract" tab | A form: Track, Title, Abstract (with a live word counter against the conference's limit), an optional abstract-file upload, Keywords, Presentation preference. |
| A3 | Fill the form (pick a track, a title ≥ 5 characters, an abstract, at least one keyword) → **Create draft** | The page switches to showing the submission with a **Draft** badge, an Authors panel (you, as corresponding author), a Files panel, and a "Submit for review" button. |
| A4 | Files panel → **Upload abstract file**, pick a PDF/DOC/DOCX/PNG/JPG/WEBP | File appears in the list as `abstract · v1 (active)`. |
| A5 | Pick a `.txt` file renamed to `.pdf` | Upload is rejected — the server checks real file content, not the extension. |
| A6 | Authors panel → add a co-author with an email that has **no** account and check "Corresponding author" | Rejected: "The corresponding author must already have an account with this email." |
| A7 | Add a co-author with a real account's email, without checking corresponding | Co-author appears in the list; you're still marked "(corresponding)". |
| A8 | Click **Submit for review** → confirm | Status badge changes to **Submitted**, a `submission_code` like `CONF-0001` appears, and the Timeline panel shows draft → submitted. |
| A9 | Reload the page → "My submissions" tab | The submission is listed with its code, title, track and status. |
| A10 | Try to edit the title or abstract now | The form fields are disabled — only `draft` / `revision_required` submissions are editable. |
| A11 | (Only while still a draft, before Step A8, on a **separate** draft) Click **Delete submission** | The draft disappears from "My submissions". |
| A12 | Open the submitted one → **Withdraw submission** → give a reason → confirm | Status becomes **Withdrawn**, and the reason shows in the Timeline. |

## Part A — as someone else

| # | Click path | Expected result |
|---|---|---|
| A13 | Sign in as a *different* author in the same conference, try to reach the first author's submission directly | They never see it — it's not in their "My submissions" list, and the detail page 404s if forced. |

---

## Part B — as the Convenor

| # | Click path | Expected result |
|---|---|---|
| B1 | Sign in as convenor → `/convenor` → **Submissions** tab | A table of every non-draft submission: code, title, track, status, reviews (completed/assigned), average score. Filter by status and track. |
| B2 | Sign in as an author or reviewer and try `GET /api/conferences/<id>/submissions` (or just note the tab doesn't exist for them) | 403 — this view requires `submission.read_all`. |
| B3 | Click a submitted abstract | Detail panel: abstract text, keywords, authors (with avatars), files (download button each), an empty "Reviewers" list, and a "Record a decision" form. |
| B4 | "Assign reviewer" box → choose a reviewer, pick a due date → **Assign reviewer** | A new row appears under Reviewers ("Awaiting response"); status badge at the top moves from **Submitted** to **Under review**. |
| B5 | Try assigning the submission's own author, or a reviewer already flagged with a conflict | Rejected with a clear message — authors and conflicted reviewers never appear as assignable in the dropdown to begin with. |
| B6 | Try assigning the same reviewer again | Rejected: already assigned for this round. |
| B7 | After the reviewer submits (Part C) → reload the detail panel | The Reviewers list shows the full submitted review: scores, recommendation, "To author" comment, and — because you have `review.read_all` — the confidential comment too. |
| B8 | "Record a decision" → Stage = Abstract, Decision = Accepted, write comments → **Save decision** | A confirm dialog (warning if fewer reviews are in than `reviews_required`) → "Decision saved." → status badge becomes **Accepted**; a Decision history entry appears. |
| B9 | Try recording a second decision for the same stage (round hasn't changed) | Rejected: a decision for this stage/round already exists. |

## Part B — as the Reviewer

| # | Click path | Expected result |
|---|---|---|
| C1 | Sign in as the assigned reviewer → `/reviewer` | "My assignments" list shows the submission with status "Awaiting response" and the due date. |
| C2 | A *different* reviewer, same conference | Sees nothing for this submission — assignments are strictly per-reviewer. |
| C3 | Click **Accept** | Status flips to "In progress"; the button becomes "Write review". |
| C4 | Click **Decline** instead (on a different assignment), optionally give a reason | Status becomes "Declined" and disappears from assignable actions. |
| C5 | "Write review" | Shows the submission's title, abstract, keywords, track and files — **no author names** (double-blind by default) — plus the review form (six 1–5 scores, recommendation, comments to author, confidential comments to the convenor). |
| C6 | Fill it in → **Save draft** | "Draft saved." — can still be edited. |
| C7 | **Submit review** → confirm | "This review has been submitted and can no longer be edited" banner appears; the form locks. |
| C8 | Try to edit and save again | Rejected — a submitted review is locked by the database. |
| C9 | Try downloading a submission's file for an assignment you don't hold | 403/404 — download is scoped to the submission's authors, convenor/manager, and reviewers with a live assignment on it. |

## Part A again — full paper, after acceptance

| # | Click path | Expected result |
|---|---|---|
| D1 | As the author, open the now-**Accepted** submission (with "Full paper submission" dates open) | A "Full paper" and a "Presentation" upload box both appear. |
| D2 | Upload a PDF as the full paper | File list shows `full_paper · v1`; the status badge moves to **Full paper submitted** automatically. |
| D3 | As convenor, open the same submission → "Record a decision" → Stage = Full paper, Decision = Accepted | Status becomes **Final approved**; the author can now upload a camera-ready file once the "Final paper" window opens. |
| D4 | As the author, re-check the "Feedback" panel | Shows the decisions and (if the conference allows it) the reviewer's comments-to-author — never the confidential comment, never who wrote it, and never scores unless the conference's review mode is "open". |

---

## Cleanup check

- `grep -r "supabase" src` from the repo root should print nothing.
- Nothing under `server/storage/private` is reachable at a public URL — try hitting
  a submission file's `storage_path` directly; only `/api/submissions/:id/files/:fileId/download`
  (with a valid session) works.

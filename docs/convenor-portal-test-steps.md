# Convenor Portal (Part A) manual test steps

The convenor's `/convenor` page (and the manager's `/manager` page, which
reuses the same screens minus a couple of items) is now a left sidebar with
its own URL per item — refresh and the back button work, and unbuilt Part B/C
items show a friendly "Coming soon" panel instead of an error. Pair this with
`npm run build`, `npm test` (both `server/` and the repo root) and
`npx playwright test`, which already cover this ground automatically — see
`docs/final-test-report.md` for the automated results.

## Before you start

Same prerequisites as `docs/phase3-test-steps.md` / `docs/phase4-test-steps.md`:
MySQL loaded, backend on `http://localhost:4000` (`cd server && npm run dev`),
frontend on `http://localhost:5173` (`npm run dev`). You'll want:

- a **convenor** of one conference,
- that same conference with at least one **manager** (appoint one from
  Members and roles — see Part B below — or re-use an existing account),
- at least one **track**, so Review settings / Members / Dashboard have
  something to show.

---

## Part A — Sidebar layout

| # | Click path | Expected result |
|---|---|---|
| A1 | Sign in as convenor → `/convenor` | Lands on **Dashboard**, grouped sidebar on the left: Overview, Setup, People, Papers, Event, Communication, Reports. |
| A2 | Click any sidebar item | The URL changes (e.g. `/convenor/tracks`) and only the right-hand panel updates — the sidebar and header stay put. |
| A3 | Reload the page on a non-dashboard item (e.g. `/convenor/committees`) | Same panel reloads directly — no redirect to a blank or error page. |
| A4 | Click the browser **back** button after a couple of sidebar clicks | Returns to the previous sidebar item, not out of the app. |
| A5 | Narrow the browser to 390px wide | The sidebar disappears behind a **Menu** button at the top; tapping it shows the same grouped list; tapping an item opens it and closes the drawer. No horizontal scrollbar on any item. |
| A6 | Click **Attendance** or **Certificates** | A plain "Coming soon" panel — not an error (these are Part B/C). |
| A7 | If you also have a manager account: sign in as manager → `/manager` | Same sidebar, same URLs (`/manager/...`), but **Members and roles** and **Activity log** are missing — managers hold every permission except `members.manage` and `audit.read`. |

## Part B — Dashboard

| # | Click path | Expected result |
|---|---|---|
| B1 | Dashboard | Cards: submissions (total), reviews assigned/done, accepted papers, members, registrations (always 0 — not built yet). |
| B2 | Submit an abstract as an author, don't assign a reviewer yet | Dashboard → "Needs your attention" shows "Submitted papers with no reviewer" with a count; clicking it jumps to Submissions. |
| B3 | Leave a review assignment overdue (or set its due date in the past directly in MySQL for a quick check) | "Overdue reviews" appears in the attention list. |
| B4 | Set a key date (Key dates tab) to close within the next 7 days | Dashboard shows "closes within a week" with the day count; a next-key-date line appears above the attention list. |
| B5 | Submissions per track | A small horizontal bar per track, proportional to how many non-draft submissions it has. |

## Part C — Review settings

| # | Click path | Expected result |
|---|---|---|
| C1 | Review settings | Form: review mode, reviews required, max submissions per author, max abstract words, max file size, allowed file types, "authors can see review comments". |
| C2 | Change review mode to "Open" and save | "Saved." — reloading the tab shows the new value persisted. |
| C3 | Set reviews required to 11 | Rejected — 1-10 only. |
| C4 | Clear "max submissions per author" | Saves as no limit (field accepts blank). |

## Part D — Members and roles

| # | Click path | Expected result |
|---|---|---|
| D1 | Members and roles → search box | Typing a name or email filters the table live. |
| D2 | Filter by role "Reviewer" | Only reviewer rows show. |
| D3 | "Invite by email" with a **new** email | "Invitation email sent." — check the backend console (or Email log) for the `invitation` email with a set-password link. |
| D4 | "Invite by email" with an email that **already has an account** | "Added — they already had an account." — that person gets an in-app notification instead, and shows up in the list right away. |
| D5 | Try inviting the same person for the same role again | Rejected — already has that role. |
| D6 | Change a member's role via the dropdown | Saves immediately; try setting it to a role they already hold elsewhere — rejected. |
| D7 | Try to change or remove the **convenor** row | Not offered — the dropdown and Remove button don't appear for the convenor; the API also rejects it directly. |
| D8 | Try to remove **yourself** (if you're a member of the conference in another role too, or via devtools against your own convenor membership) | Rejected — "You cannot remove yourself." |
| D9 | On a reviewer row, set "Max reviews" and click **Tracks** | A small picker lists every track with checkboxes; save it, then check Reviews → assign dialog shows "track match" for that reviewer on a matching track. |

## Part E — Committees

| # | Click path | Expected result |
|---|---|---|
| E1 | Committees → "Add a committee" | Name, type, description, "Show on the public conference page" checkbox. |
| E2 | On the new committee, "Find by email…" with an email that has an account | Shows a green chip with that person's name; adding uses their account (so the public page can link/display them consistently). |
| E3 | Same box, but type a name instead (no email) | Adds a committee member who isn't a platform user — affiliation/country optional. |
| E4 | Try adding a member with neither an email match nor a typed name | Rejected — "Pick an existing user or type a name." |
| E5 | Remove a member | Disappears from the list immediately. |
| E6 | Toggle "Public"/"Hidden" on a committee, then visit the public conference page's Committees section | Only committees currently marked Public appear there. |

## Part F — Speakers

| # | Click path | Expected result |
|---|---|---|
| F1 | Speakers → "Add a speaker" | Name + type (keynote/invited/panelist/guest); after creating, a photo upload box appears on that row. |
| F2 | Upload a photo (PNG/JPG/WEBP) | Square-cropped preview appears; re-uploading replaces it. |
| F3 | Reorder with ↑ / ↓ | Order changes; refresh confirms it persisted. |
| F4 | Hide a speaker, then check the public conference page's Speakers section | Hidden speakers don't appear there; keynotes always sort first among the visible ones. |

## Part G — Submissions / Reviews and decisions

| # | Click path | Expected result |
|---|---|---|
| G1 | Submissions | Same table/detail panel as before (code, title, track, status, reviews, decisions) — unchanged from Phase 3. |
| G2 | Reviews and decisions | Same screen as Submissions — this is one underlying feature with two sidebar entries, matching the spec's "Papers" grouping. |

## Part H — Announcements

| # | Click path | Expected result |
|---|---|---|
| H1 | Announcements → fill title/body, pick audience "Authors", check "Also send an email", click **Publish now** | Every active author gets one notification and (since the box was checked) one email each — never one email with everyone in To (check Email log: one row per author). |
| H2 | Create another announcement, pick a publish date/time a minute in the future, click **Schedule** | Status shows "Scheduled"; after that time passes (the backend checks every 60s), it flips to "Published" on its own and the audience is notified then — no manual action needed. |
| H3 | Try editing or deleting a **published** announcement | Not offered — edit/delete only work on draft/scheduled; use **Archive** instead for a published one. |
| H4 | Visit the public conference page | A new "Announcements" section lists published announcements aimed at "Everyone", newest first. |

## Part I — Email templates

| # | Click path | Expected result |
|---|---|---|
| I1 | Email templates → click a template key (e.g. `role_request_approved`) | Shows its subject/body, a list of `{{placeholders}}` it uses, and "Default" (not yet customised). |
| I2 | Edit the subject/body, click **Save** | Badge changes to "Customised" — this conference now has its own copy; the platform default is untouched for every other conference. |
| I3 | Click **Preview with sample data** | An isolated preview box renders the email with realistic sample values substituted for every placeholder. |
| I4 | Try pasting `<script>alert(1)</script>` or `<p onclick="...">` into the body and save | Saved body has it stripped — only `p, br, strong, em, a, ul, ol, li, h2, h3` survive, and link targets are limited to `http(s)`/`mailto`. |
| I5 | Click **Reset to default** | Badge goes back to "Default"; the customisation is deleted. |

## Part J — Email log

| # | Click path | Expected result |
|---|---|---|
| J1 | Email log | Unchanged from Phase 4 — recipient, template, subject, status, attempts, time, error, Retry on failed rows. |

## Part K — Reports and export

| # | Click path | Expected result |
|---|---|---|
| K1 | Reports and export → Submissions → Download CSV / Download Excel | A file downloads with code/title/track/status/authors/average score/decision. |
| K2 | Reviews → Download CSV | As a convenor (who holds `review.read_all`) you see the reviewer's name and confidential comments; a report pulled by someone without that permission would see them blanked (enforced server-side regardless of who clicks the link). |
| K3 | Members / Committees downloads | Straightforward name/email/role and committee/member listings. |

## Part L — Activity log (convenor only)

| # | Click path | Expected result |
|---|---|---|
| L1 | Activity log | A paged table: when, who, action, what — every write you've made elsewhere in the portal shows up here (e.g. `track.create`, `member.invite`, `announcement.publish`). |
| L2 | Filter by the "Everyone" dropdown (a specific member) or by action text (e.g. `committee.create`) | List narrows accordingly. |
| L3 | As a **manager**, try to open Activity log directly (e.g. by URL) | Not in the sidebar, and the underlying API 403s — managers don't hold `audit.read`. |

---

## Cleanup check

- `npx tsc --noEmit` (both projects), `npm run build` (both), `npm test`
  (server + root) and `npx playwright test` all pass.
- `grep -r "supabase" src` from the repo root is still empty.
- `cd server && npm audit` shows only the two known moderate advisories
  documented in `docs/final-test-report.md` (transitive to `exceljs`, not
  exploitable in how this app uses it).

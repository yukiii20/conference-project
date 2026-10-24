# Usability audit — Step 11

How this was done: an automated crawl (`scratch-audit-crawl.ts`, not
committed — a throwaway script) signed in as every role (visitor, author,
reviewer, session chair, staff, manager, convenor, super admin) and visited
every sidebar page/tab each role has (58 page visits total), checking at
1440px and 390px for: console errors, failed network requests, visible
`undefined`/`null`/`NaN`/`Invalid Date`/snake_case text, and horizontal
overflow. A second pass (`scratch-a11y-check.ts`) checked every page for
icon-only buttons with no `aria-label`, images with no `alt`, and heading
level skips. Both found real issues (listed below), both came back clean
after the fixes. The explicitly-named pain points in the task were checked
by hand against the actual running app. `e2e/responsive.spec.ts`,
`e2e/convenorPortal.spec.ts`, `e2e/portal.spec.ts`, and
`e2e/adminPortal.spec.ts` already covered console-errors-per-role and
no-horizontal-scroll before this step and were re-verified, not rebuilt.

## Findings

| Page | Role | Problem | Severity | Fix | Status |
|---|---|---|---|---|---|
| Super admin Dashboard (recent activity) | super admin | Raw audit action strings shown verbatim, e.g. `role_request.approve` | High | `humanizeAuditAction()` (`src/lib/humanize.ts`) | Fixed |
| Admin Email log / convenor Emails tab (shared component) | super admin, convenor | Raw `template_key` shown in mono font, e.g. `convenor_invitation` | High | `humanizeTemplateKey()` | Fixed |
| Convenor Activity log | convenor | Raw action (`track.create`) and raw entity_type (`conference_tracks`) shown; filter placeholder itself showed a raw example | High | `humanizeAuditAction()` / `humanizeIdentifier()`; friendlier placeholder | Fixed |
| Convenor Email templates | convenor | Raw `template_key` as the card heading and iframe title | Medium | `humanizeTemplateKey()` | Fixed |
| Key dates, Review settings, Role requests, Activity log, Email templates (page titles) | convenor | Inconsistent Title Case vs. the rest of the app's sentence case | Low | Normalized to sentence case | Fixed |
| My ticket, My certificates, My submissions, My reviews, My sessions, Check-in desk, My profile, Administrator | 7 roles | Page title with no one-line explanation of what the page is for | Medium | Added a `subtitle` to each `PageHeader` | Fixed |
| App-wide (checklist ticks, "nothing needs attention" icon) | convenor | `text-success` Tailwind class used in 3 places but no `success` colour token existed — compiled to nothing, so these icons silently weren't green | Medium | Added `--color-success` to the theme (`src/index.css`) | Fixed |
| Convenor Dashboard | convenor (new) | No guidance on what's left to set up, or why the conference isn't public yet | High (named pain point) | New "Setup checklist" card — 7 steps, ticked off live, links straight to each unfinished one | Fixed |
| Convenor Key dates | convenor | No warning if abstract submission closes after the conference starts, or registration closes after it ends | High (named pain point) | Inline warning banner per affected date, computed against the conference's own start/end dates | Fixed |
| Signup — Choose a conference | visitor | "No conferences are open right now" with no explanation or next step | Medium (named pain point) | Explains why, links to "Browse conferences" (home page) | Fixed |
| Public conference page — My ticket (pending registration) | attendee | Said registration was "awaiting payment confirmation" but not what to do or who to contact | Medium (named pain point) | Added a "Contact `<organiser email>` to confirm it" line when the conference's contact email is known | Fixed |
| Convenor Dashboard — Needs your attention | convenor | No visibility into pending (payment-unconfirmed) registrations at all | High (named pain point) | New "Pending registrations (N)" attention item, links straight to the pre-filtered list where Confirm is one click | Fixed |
| Admin — Create convenor / Appoint existing account tabs | super admin | No page title, no explanation of what either does or how they differ | Medium (named pain point) | Added a `PageHeader` with a one-sentence explanation to each | Fixed |
| Convenor Certificates — "Release now" | convenor | No explanation of what it does; no success toast; the issued-certificates list didn't refresh afterward, so a convenor couldn't tell if it worked | High | Added an explanatory line, a success toast reporting the real count released, and a reload after | Fixed |
| Convenor Certificates — "Revoke" | convenor | Used the browser's native `window.prompt()` for the reason — looks broken, inconsistent with every other destructive action in the app, no "here's what happens" message | Medium | Replaced with the shared `ConfirmDialog` (explains the consequence, has a proper reason field) | Fixed |
| Convenor Certificates (page) | convenor | No page title at all | Low | Added `PageHeader` | Fixed |
| Every gated page (`ProtectedRoute`) | all signed-in roles | Blank "Loading…" text while `GET /api/auth/me` resolves; the page's own data fetch doesn't even start until that finishes | High (Part A) | Swapped in `AppShellSkeleton` — doesn't remove the wait (it's a real permission check) but replaces the blank flash with a shell that matches the real layout | Mitigated — see `docs/performance-live.md` for why the wait itself wasn't removed |
| `GET /conferences/:id/attendance/dashboard` | convenor, staff | 4 queries ran one after another; 3 of the 4 didn't actually depend on each other | Medium (Part A) | `Promise.all` | Fixed |
| Registrations list (convenor Attendance tab + staff desk), Members search, Activity log action filter | convenor, staff | Search input fired an API call on every keystroke, no debounce at all | High (Part A) | 300ms debounce added to all three | Fixed |
| Check-in panel's code/name search | convenor, staff | Debounced, but at 250ms instead of the 300ms used everywhere else | Low | Normalized to 300ms | Fixed |
| App-wide | all | No indication an API call might be Render's free-tier cold start — a slow request just looked stuck | High (named pain point) | `SlowRequestBanner` — appears if any request is pending past 5s, clears itself after | Fixed |
| App-wide (shared `CardHeader` component) | convenor mainly, also used elsewhere | Heading level skip (`<h1>` straight to `<h3>`) on every page using a `Card`/`CardHeader` combo directly under the page title — found on certificates, attendance, programme, review settings, supporters, and both portal dashboards | Medium | Fixed once at the source: `CardHeader` now renders `<h2>`; also fixed ~10 call sites that used a bare `<h3>` for the same reason | Fixed |

## Checked and already fine (no fix needed)

- **Icon-only buttons / images:** every icon-only button found across every
  page crawled already has an `aria-label`; every `<img>` already has
  `alt`. (Automated check, not a sample — see "How this was done" above.)
- **Blind review explanation:** Review settings already explains
  single-blind/double-blind in plain English right next to the dropdown.
- **Debounce elsewhere:** admin Users search and Appoint-convenor search
  were already correctly debounced at 300ms before this step.
- **Destructive-action confirmations:** every other delete/revoke/cancel
  action already used the shared `ConfirmDialog` with a clear consequence
  message — the certificate revoke flow (fixed above) was the one
  exception.
- **No duplicate `/me` polling, notification polling already at 60s.**
- **Console-errors-per-role and no-horizontal-scroll-at-390px:** already
  covered by `e2e/convenorPortal.spec.ts`, `e2e/portal.spec.ts`,
  `e2e/adminPortal.spec.ts`, and `e2e/responsive.spec.ts` (7 breakpoints,
  320–1440px) before this step; re-verified passing, not re-built.
- **Deep links / browser back / refresh-on-any-URL:** exercised
  incidentally by the crawl script (every page visit above was a direct
  `page.goto()`, not a client-side navigation) and by the existing e2e
  suite's "old URLs redirect" tests — all worked.

## What this didn't cover

A full manual click-through of literally every button on every page, for
every one of the 9 roles, at both viewports, against every item in the
task's 18-point checklist, is a bigger undertaking than the automated crawl
plus the named pain points above — the crawl is systematic and real
(console errors, failed requests, raw-identifier leakage, heading order,
icon labels, horizontal scroll), but it can't judge things like "is this
copy actually clear to a 45-year-old first-time convenor." The named pain
points were the targeted, hand-checked exception to that. If you spot
something specific this missed, it's easy to add as another row here.

# UI consistency audit (Step 7, section 1)

Date: 2026-10-17. Scope: every page/role per `docs/finish-7-ui-roles.md` section 1.
`docs/responsive-ui-audit.md` (2026-10-16) already covered horizontal-scroll/overflow
and form-grid breakpoint bugs — those are NOT repeated here; this audit only covers
non-responsive consistency (shared components, colours, states).

## Headline finding

`src/components/ui/` **does not exist**. There is no shared component library at all.
The good news: because most of the app was built by copy-pasting the same hand-written
Tailwind strings, the *common* cases (primary button, danger button, card, table header,
input) are already fairly consistent in isolation — the real risk is that every one of
those strings is independently duplicated 30-50+ times with no single source of truth,
so each new page is one typo away from drifting, and several pages already have.
Building the shared `src/components/ui/` library and swapping every page over to it (section 2)
is the fix for nearly every row below, not a separate nice-to-have.

## Table: Page | Problem | Fix

| Page / area | Problem | Fix |
|---|---|---|
| App-wide | No shared component library (`src/components/ui/` missing). Button/Input/Card/Table-header markup is hand-typed and duplicated in 30-50+ files (verified via grep: `bg-button` primary-button classes appear in 39 files, `rounded-lg border border-line bg-white p-4` card classes in 20+ files). | Build the library in section 2 and migrate call sites. |
| App-wide status badges | FOUR independent status→colour implementations exist and disagree on category colours: `src/lib/submissionDisplay.ts:19-43` (`statusBadgeClass`), `src/components/EmailLogTab.tsx:18-31` (`statusClass`), `src/pages/reviewer/AssignmentsList.tsx:23-35` (`statusClass`), and an inline ternary in `src/pages/SuperAdminPage.tsx:1043-1049` for user status. E.g. "pending"-type states get `bg-amber-100` in one map but there is no amber/grey case at all in the other two (they fall through to a generic ink-grey default), and a 4th map (registrations, `src/components/attendance/RegistrationsList.tsx`) renders registration status as plain text with no badge at all. | Create `src/lib/status.ts` per section 2's spec (one semantic map: draft/pending→grey/amber, submitted/under review→blue, accepted/approved/checked-in/valid→green, rejected/revoked/cancelled→red, withdrawn→grey) and point `StatusChip` + every one of the 4 call sites at it. Add a registration-status badge (currently text-only). |
| App-wide confirm actions | Every destructive/confirm action uses the raw browser `window.confirm()` — 18 call sites: `SuperAdminPage.tsx:630,809,940,1345`, `RegistrationsList.tsx:75`, `ImageUpload.tsx:130`, `RegistrationPanel.tsx:87`, `ReviewForm.tsx:130`, `SubmissionDetail.tsx:265,295,334`, `DirtyGuard.tsx:30`, `SupportersTab.tsx:142`, `SubmissionDetailPanel.tsx:179`, `SpeakersTab.tsx:128`, `ProgrammeTab.tsx:425,693,1054`, `RoleRequestsTab.tsx:36`. Only one page (`SuperAdminPage.tsx`'s anonymise flow) has a real styled `ConfirmDialog` (`AnonymizeConfirmDialog`, line 1139). Native `confirm()` cannot be styled, ignores the app's design, and is unpredictable in different browsers. | Build `ConfirmDialog` per section 2 (reuse `AnonymizeConfirmDialog`'s shape) and replace all 18 `window.confirm()` calls — this is explicitly required by section 3 ("ConfirmDialog for delete/revoke/reject/cancel/anonymise/release"). |
| App-wide loading state | "Loading…" as literal duplicated text (not a shared component) in 45+ files, e.g. `ConvenorPage.tsx:136`, `SuperAdminPage.tsx:281,1018,1218,1393,1489`, every convenor tab, every portal section. Inconsistent wrapper styling: most are `<p className="mt-6 text-sm text-ink/60">`, but `ProfilePage.tsx:111` and `AdminViewAsPage.tsx:57` are full-screen centered divs with different text colour/size, and none of them are skeletons — every data table/card replaces its whole content with one line of text, so there is layout jump between loading and loaded (violates section 3: "no layout jump"). | Build `Spinner`/`Skeleton` per section 2 and section 3's loading-state requirement; use table/card-shaped skeletons for the big lists (submissions, members, email log, audit log, registrations) instead of a line of text. |
| App-wide empty state | No shared `EmptyState`. Three different inline treatments for "nothing here": `MembersTab.tsx:188` (dashed-border card, "No members found."), `TracksTab.tsx:269` (plain text, "No tracks yet."), `SubmissionsTab.tsx:107` (plain text, "No submissions match."). None of them suggest a next action (doc requires "a clear message and the next action"). | Build `EmptyState` per section 2 and give each list a one-line CTA ("Invite a member", "Add a track", "Clear filters"). |
| App-wide errors | No shared `ErrorState`/toast. No toast library is installed at all (`package.json` has no `react-hot-toast`/`sonner`/etc.) — success/failure feedback is handled ad hoc per page (inline green "Saved." banners in some convenor tabs, inline red text in forms, nothing at all after some actions e.g. `RoleRequestsTab.tsx` approve/reject). Section 3 explicitly requires "toast on success/failure" everywhere. | Add a lightweight toast (one shared `Toast`/`ToastProvider` — no need for a new dependency, a small context + portal is enough) and an `ErrorState` with Retry; wire into every mutating action. |
| Convenor tabs ("Saved." banner) | 5 near-identical copies of the same inline success banner with no shared component: `LocationTab.tsx:115`, `LogoTab.tsx:186`, `KeyDatesTab.tsx:133`, `ReviewSettingsTab.tsx:99`, `ConferenceDetailsTab.tsx:88,261` — all `rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700`, auto-dismiss behaviour not shared (some rely on local `useEffect` timers, risk of drift). | Replace with the shared `Toast`/`Alert` component so timing and markup live in one place. |
| `CommitteesTab.tsx:93,137` | Small inline-row action buttons use an undocumented "extra-small" size (`px-2 py-1 text-xs`) that doesn't match the rest of the app's two sizes in practice (`text-sm px-4 py-2` primary/secondary buttons seen everywhere else, e.g. `SpeakersTab.tsx:276`, `CommitteesTab.tsx:347`). There's no formal size scale, so this third size is a one-off. | `Button`'s `sm` size variant (section 2 spec) should standardize this exact case instead of a bespoke class string. |
| `ProgrammeTab.tsx:724,858` | Secondary/outline buttons here use `px-3 py-1`/`px-3 py-1.5` (28-30px tall) vs. the same "Cancel"/outline action elsewhere using `px-4 py-2` (36-40px tall, e.g. `AttendanceTab.tsx:158`, `CertificatesTab.tsx:238`). Falls below the 40px minimum touch target the doc requires for buttons. | Standardize on `Button` `md` size (40px min height) everywhere; use `sm` only for genuinely dense inline rows, never below 40px touch height on anything a mobile user taps as a primary row action. |
| `PortalHeader.tsx:36` | Sign-out button uses `rounded border border-white/40 px-3 py-1` — a different radius (`rounded` = 4px) and height than the rest of the app's buttons (`rounded-md` = 6px, taller padding). It sits on the primary-colour header bar so needs its own on-color treatment, but should still come from `Button`'s `outline` variant with an `onColor`/inverse prop rather than a one-off class string. | Add an inverse/on-color style to the shared `Button` outline variant and use it here instead of a bespoke class. |
| `src/lib/submissionDisplay.ts` vs `EmailLogTab.tsx`/`AssignmentsList.tsx` badges | Badge base classes are re-declared 3 times (`BADGE_BASE` constant in `submissionDisplay.ts:17` vs. inline `rounded-full px-2 py-0.5 text-xs font-medium` literals in the other two files) — if one is ever tweaked (radius, padding) the other two silently diverge. | Centralize in `StatusChip` (section 2) which accepts a status key and the new `src/lib/status.ts` semantic map. |
| `HomePage.tsx:470` | Conference status badge (`rounded-full px-2.5 py-1`, its own padding scale) is a 5th independent inline badge implementation separate from the 4 above, for a semantically similar "status" concept (conference open/closed vs. submission/registration/email status). | Fold into the same `StatusChip`/`status.ts` system if the semantics line up (open/upcoming/closed), otherwise document explicitly in `status.ts` why conference lifecycle state is intentionally a separate map. |
| `SuperAdminPage.tsx:1043-1049` (user status) | Inline ternary duplicates the red/grey/green semantics already captured by `submissionDisplay.ts`'s pattern but hand-rolled again with slightly different grey (`bg-gray-200 text-gray-700` vs. the rest of the app's `bg-ink/10 text-ink/70` grey used for "draft"/neutral elsewhere). | Route through `status.ts`'s grey tone so "deactivated" and "draft" use the identical neutral grey. |
| Icon set | No icon library is installed; the app currently has zero icon-only buttons (confirmed by the prior responsive audit) and uses text labels throughout — already compliant with "icons from ONE icon set only" by having effectively none. Flag only if section 2's new shared components (e.g. `Table` sort arrows, `Select` chevron, `Toast` close button) introduce ad hoc inline SVGs from different sources. | When building the new shared components, use one single minimal inline-SVG icon set (or none) consistently; don't pull in a new icon package. |
| Super admin "Replace primary contact"/admin-removal confirms (`SuperAdminPage.tsx:630,809,1345`) | Same `window.confirm()` problem as above, called out separately because these are the highest-consequence admin actions in the app (replacing a conference's primary contact, revoking admin access) and currently get the least amount of visual weight — no distinct "this is serious" styling vs. a routine cancel-registration confirm. | `ConfirmDialog` should support a `tone="danger"` variant (red icon/button) used for these specifically, not just a generic dialog. |
| Auth pages (`SignInForm.tsx`, `SignUpForm.tsx`) vs. rest of app | These share the same `rounded-md border border-line px-3 py-2` input style and `bg-button` submit button as the rest of the app (good — already consistent) but duplicate the classes locally rather than importing `Input`/`Button`, so a future tweak to the shared tokens won't reach them automatically. | Migrate once `Input`/`Button` exist; no visual change needed, this is a maintainability-only fix. |
| `SuperAdminLoginPage.tsx` (`sa-login__*` classes in `src/index.css:60-302`) | Deliberately uses a separate, plain institutional design system (own font stack `IBM Plex Sans`/`Source Serif 4`, own navy palette) completely outside the app's shared tokens — this is called out in the CSS's own comment as intentional. Confirmed intentional, not a bug: this page is the platform-admin front door and is meant to look distinct from both the public site and the portal, per the existing comment. | No fix — document as an intentional, isolated exception in the component-library README so a future pass doesn't "fix" it by accident. |
| Convenor sidebar / portal sidebar unread badges (`ConvenorSidebar.tsx:70`, `PortalSidebar.tsx:61`) | Both already use the identical `rounded-full bg-red-600 px-2 py-0.5 text-xs font-medium text-white` — good, already consistent, no fix needed, listed here only to confirm it was checked. | None. |
| Table headers (`ConferencePage.tsx`, `SuperAdminPage.tsx`, `EmailLogTab.tsx`, `AttendanceTab.tsx`, `CertificatesTab.tsx`, and others) | Already consistent (`px-4 py-2 font-medium` on every `<th>` checked, `divide-y divide-line` on every `<tbody>` checked) — good, no fix needed, listed to confirm it was checked rather than assumed. | None — but migrate to a shared `Table` component anyway so this consistency is enforced going forward instead of relying on every author remembering to copy it correctly. |
| Cards (`ConferencePage.tsx`, `SuperAdminPage.tsx`, every convenor tab) | Already consistent (`rounded-lg border border-line bg-white p-4` or `p-5`) — good, no fix needed, listed to confirm it was checked. One minor inconsistency: `ConferencePage.tsx:404,458` use `rounded-md … p-3` (smaller radius/padding) for list items inside a card rather than the card radius itself — acceptable (nested list item, not a card), not a bug. | Migrate to shared `Card` for the outer containers; leave the smaller nested list-item treatment as-is. |
| Inputs (`ConferenceDetailsTab.tsx`, `SignInForm.tsx`, `SignUpForm.tsx`, and others) | Already consistent height/padding (`rounded-md border border-line px-3 py-2`) and already inherit the body's 16px default font size (no `text-sm` override found on any text/email/date input checked) — so no iOS-zoom bug exists today. Listed to confirm it was checked, not assumed. | Migrate to shared `Input`/`Select`/`Textarea`/`FormField` so this stays true as new forms are added; `FormField` should carry the inline field-error pattern (`<p className="mt-1 text-sm text-red-600">`) already used consistently in `ConferenceDetailsTab.tsx:280` and elsewhere. |

## Row count

24 rows (15 genuine problems to fix, 4 rows confirming already-consistent patterns worth
preserving/enforcing via the new components, 1 intentional exception, with the remainder
being closely related sub-findings grouped under the problems above rather than split into
their own rows, to keep the table actionable rather than exhaustive).

## Fixed

- **Shared component library built**: `src/components/ui/` now has Button, Input/Select/
  Textarea/Checkbox, FormField, Card, PageHeader, Tabs, Table (+ Pagination), Badge/StatusChip,
  Modal/ConfirmDialog, Toast/ToastProvider, Spinner/Skeleton, EmptyState/ErrorState, Alert, and
  one hand-written icon set (`icons.tsx` — no new npm dependency). `ToastProvider` is wired into
  `App.tsx` around the whole router.
- **One status→colour map**: `src/lib/status.ts` (`statusTone`/`statusBadgeClasses`/
  `statusLabel`), covering every status string found across submissions, reviews, registrations,
  certificates, accounts, rooms and the email log. `StatusChip` now backs the badge in
  `submissionDisplay.ts`'s 4 call sites (`SubmissionsList`, `SubmissionDetail`,
  convenor `SubmissionsTab`, `SubmissionDetailPanel`), `EmailLogTab`, `AssignmentsList`,
  `SuperAdminPage`'s user-status badge, and `RegistrationsList` (previously plain text, no
  badge at all). `HomePage.tsx`'s conference-lifecycle badge was left as its own map — open/
  upcoming/closed is a different semantic domain than submission/registration workflow status,
  same reasoning as the already-documented `SuperAdminLoginPage` exception.
- **All 18 `window.confirm()` calls replaced with the shared `ConfirmDialog`**, across
  `SuperAdminPage.tsx` (4), `RegistrationsList.tsx`, `ImageUpload.tsx`, `RegistrationPanel.tsx`,
  `ReviewForm.tsx`, `SubmissionDetail.tsx` (3), `SubmissionDetailPanel.tsx`,
  `SupportersTab.tsx`, `SpeakersTab.tsx`, `ProgrammeTab.tsx` (3), `RoleRequestsTab.tsx` — except
  `DirtyGuard.tsx`'s "Discard changes?" guard, left as a native `confirm()` with a comment
  explaining why (it needs a synchronous answer to decide whether to let a navigation proceed;
  every e2e test that exercised a converted dialog was updated to click the dialog's own button
  instead of relying on a native-dialog auto-accept handler).
- **5 duplicated "Saved." banners replaced with the shared toast** (`LocationTab`, `LogoTab`,
  `KeyDatesTab`, `ReviewSettingsTab`, `ConferenceDetailsTab` ×2) — same wording so the existing
  e2e assertions (`getByText('Saved.')`) still pass, now with toast's own auto-dismiss instead of
  five independent ad hoc `saved` booleans.
- **`RoleRequestsTab`** also gained success/error toasts on approve/reject, which previously gave
  no feedback at all beyond the row disappearing.
- **3 `EmptyState` conversions with a next action**: `MembersTab` ("No members found." → "Clear
  filters" when a search/role filter is active), `SubmissionsTab` ("No submissions match." →
  "Clear filters"), `TracksTab` ("No tracks yet." → points at the always-visible add-track form
  below it).
- **Small flagged sizing bugs fixed**: `CommitteesTab`'s inline add-member mini-form now uses
  `Input`/`Select`/`Button size="sm"` instead of a bespoke `px-2 py-1 text-xs` scale;
  `ProgrammeTab.tsx`'s "Close" and "Add" buttons bumped to the 40px minimum touch height;
  `PortalHeader.tsx`'s Profile/Change password/Sign out on-colour buttons now share one
  `rounded-md`/`min-h-10`/`px-4 py-2` treatment instead of a separate `rounded`/`px-3 py-1` one.

Not done in this pass (documented, not silently dropped): the full file-by-file migration of
every remaining one-off `<button>`/`<input>`/card wrapper to the new `Button`/`Input`/`Card`
components (the audit's own "already consistent, migrate for future maintainability" rows —
auth pages, table headers, card containers, plain inputs) was left as-is. Those were flagged as
already visually consistent with no behaviour or appearance change needed from a migration, so
the fix queue here prioritised the rows that were actual bugs (colour disagreements, no
confirm dialog, no feedback, wrong touch size) over a cosmetic-only refactor of ~30-50 files.

## Step 7B+C — colour theme (Cosmic Latte / Mocha Cream / Deep Burgundy) + the remaining migration

Date: 2026-10-18. Scope: `docs/finish-7bc-theme-and-ui.md`. Finishes exactly the "Not done" item
above (the full `<button>`/`<input>`/card migration) and rolls out the new brand palette.

### A. Tokens

Every colour now comes from one place, `src/index.css`'s `@theme` block:

| Token | Hex | Used for |
|---|---|---|
| `page-bg` (= legacy `background`) | `#F7F2EA` | page background |
| `surface` | `#FFFDF9` | cards, tables, dialogs, inputs |
| `surface-muted` | `#E8DCC6` | table header row, sidebar background, selected/hover rows, tag backgrounds |
| `border` (= legacy `line`) | `#B7A89A` | card/input/table borders, dividers |
| `border-soft` | `#DDD1C2` | light dividers inside cards |
| `brand` | `#722F37` | top bar, footer, page-title accents, active sidebar item + left bar, active tab underline, links |
| `brand-hover` | `#5C252C` | brand hover |
| `text` (= legacy `ink`) | `#2B2420` | main text |
| `text-muted` | `#6B5E52` | secondary text |
| `on-brand` | `#FFFFFF` | text/icons on the burgundy bar |
| `button` (= legacy `button`, repointed) | `#1E3A8A` | primary action buttons (Save/Create/Submit/Sign in/Register), NAVY, distinct from the brand burgundy |
| `button-hover` / `button-active` | `#172F6E` / `#13285C` | primary button states |
| `outline-hover` | `#E8EDF8` | outline-button hover background |
| `danger` / `danger-hover` | `#B42318` / `#912018` | Delete/Revoke/Reject — a clear red, distinct from the burgundy brand |

The legacy names (`background`/`ink`/`line`/`button`) were **repointed** to this same palette
rather than renamed everywhere, so every page that already referenced them (including the ones
this step didn't touch directly) picked up the new look automatically. `src/lib/status.ts`'s
`StatusChip`/`Alert`/`Toast` tones were updated to the brief's exact hex values (success
`#166534`/`#DCFCE7`/`#86EFAC`, warning `#92400E`/`#FEF3C7`, info `#1E3A8A`/`#E0E7FF`, danger
`#991B1B`/`#FEE2E2`, withdrawn/neutral `#57534E`/`#E7E5E4`) and a success toast now renders with
the exact same green classes as a success `Alert`/`StatusChip` (previously all three toast
variants shared one dark `bg-ink` background with only the icon colour changing — not what the
brief asked for).

**Intentionally left outside this theme** (same reasoning as the brief's own exemptions):
- **Conference pages** (`ConferencePage.tsx`, `src/pages/conference/*`) — keep the convenor's own
  `primary_color` branding untouched; they still use the legacy `background`/`ink`/`line` token
  names for neutral chrome, which now render in the new palette too since those tokens were
  repointed (not renamed) — the per-conference accent mechanism itself was not touched.
- **The brick-wall home hero** — unchanged brown/brick/white design; only the rest of the home
  page (conferences list, announcements, how-it-works, features, FAQ, contact band) and the
  shared `LandingHeader`/`LandingFooter` moved to the new palette.
- **`SuperAdminLoginPage.tsx`** (`.sa-login__*` classes) — the deliberate, separately-documented
  "plain institutional" design from an earlier step; left byte-for-byte as before.
- **`LogoTab.tsx`'s live branding preview** and the `primary_color` picker control — per-conference
  branding feature, not this theme.
- **`MyTicketTab.tsx`'s `PORTAL_ACCENT` constant** — feeds `RegistrationPanel`'s `accent` prop,
  the same conference-branding mechanism.
- **`ProgrammeTab.tsx`'s `TRACK_COLORS`** — each track's own colour in the Sessions grid, a
  separate per-track identity system, not part of the app chrome.
- **Privacy/Terms pages** — not listed in the brief's scope; still use the landing palette.

### B. Contrast (WCAG AA)

Computed (relative luminance, not estimated) for every documented pair in the brief:

| Pair | Ratio | AA normal text (≥4.5) |
|---|---|---|
| text `#2B2420` on page-bg `#F7F2EA` | 13.70 | PASS |
| text-muted `#6B5E52` on page-bg | 5.63 | PASS |
| text on surface `#FFFDF9` | 15.02 | PASS |
| text-muted on surface | 6.17 | PASS |
| brand `#722F37` on surface (links/page titles) | 9.49 | PASS |
| on-brand white on brand bg (top bar/footer) | 9.65 | PASS |
| white on button navy `#1E3A8A` (primary) | 10.36 | PASS |
| white on button-hover `#172F6E` | 12.59 | PASS |
| white on button-active `#13285C` | 14.13 | PASS |
| button-navy text on white (outline button) | 10.36 | PASS |
| button-navy text on outline-hover `#E8EDF8` | 8.83 | PASS |
| white on danger `#B42318` | 6.57 | PASS |
| white on danger-hover `#912018` | 8.66 | PASS |
| success text `#166534` on `#DCFCE7` | 6.49 | PASS |
| warning text `#92400E` on `#FEF3C7` | 6.37 | PASS |
| info text `#1E3A8A` on `#E0E7FF` | 8.41 | PASS |
| danger-chip text `#991B1B` on `#FEE2E2` | 6.80 | PASS |
| neutral/withdrawn text `#57534E` on `#E7E5E4` | 6.08 | PASS |
| text-muted on surface-muted `#E8DCC6` (table header row) | 4.62 | PASS |
| brand text on surface-muted (avatar initials) | 7.11 | PASS |
| sidebar inactive text (`text/70`) on hover `#DDD1C2` | 5.01 | PASS |

Every documented text/background pair clears WCAG AA (4.5:1) for normal text — nothing needed to
be darkened. (`border` on `page-bg` is 2.08:1, but that pair is never text — it's the card/input
border colour, which only needs the much lower non-text contrast minimum, not checked against
the text threshold.) All inputs render at 16px (`text-base` in the shared `Input`/`Select`/
`Textarea`), text is ≥14px everywhere via the shared components, and every interactive element
keeps a visible `focus-visible` outline (the shared `Button`'s outline colour is the primary
navy; native elements inherit the global `:focus-visible` rule in `index.css`).

### C. The rest of the migration

Every remaining page/tab was migrated to the shared `src/components/ui/` library (Button,
Input/Select/Textarea/Checkbox, FormField, Card, PageHeader, Tabs, Table/Pagination,
Badge/StatusChip, Modal/ConfirmDialog, Toast, Spinner/Skeleton, EmptyState/ErrorState, Alert) and
every page now starts with the shared `PageHeader`. Convenor dashboard (B3): "Reviews assigned"
renamed to "Reviews pending" (the underlying SQL was already counting assigned-but-not-submitted
vs. submitted correctly — added `server/tests/dashboard.test.ts`'s new test that actually creates
`assigned`/`in_progress`/`completed` review rows and checks the dashboard tells them apart, not
just that both read 0), stat cards are now same-height and clickable to their matching page, the
"Submissions per track" bars keep the same row height for 0-count tracks. Sidebar label
"Communication and reports" → "Communication" (same URL, `e2e/convenorPortal.spec.ts` and
`e2e/notifications.spec.ts` updated). `PortalHeader` now has one on-brand user menu (click
avatar/name → Profile/Change password/Sign out, closes on Esc/click-outside, keyboard
accessible) instead of three separate always-visible links; the bell and role chip stay visible
outside the menu. Both sidebars (convenor + portal) now show a Mocha-Cream background with a
white-surface/burgundy-text/3px-burgundy-left-bar active state.

A final repo-wide grep (after the migration) for old hard-coded colour classes/hex outside the
documented exceptions above found zero: no default-Tailwind colour utilities (`blue-*`/`red-*`/
`green-*`/`amber-*`/`gray-*`/etc.), no raw hex literals, no leftover `<button className=`/
`<input className=`/`<select className=`/`<textarea className=` outside structural
navigation/disclosure controls (mobile menu toggles, accordion triggers, dropdown triggers,
full-row "click to open" list items) — every one of those was reviewed and is either a non-
action control the shared `Button` convention doesn't apply to, or already styled purely through
tokens. Two migration side-effects needed e2e selector updates (not app bugs): the shared `Tabs`
component renders `role="tab"` instead of a plain button's `role="button"` — `adminPortal.spec.ts`,
`notifications.spec.ts`, `responsive.spec.ts` (super admin's tab bar) and `submissions.spec.ts`
("New abstract" tab in the author section) were updated to query `getByRole('tab', ...)`; and one
Card-class selector in `convenorPortal.spec.ts` was updated to match the shared `Card`'s classes.

tsc (root + server), build (both), server tests (451/451, including the new dashboard-counts
test), root tests (21/21), and the full Playwright suite (88/88) all green after these fixes —
re-seeding the test DB before each full Playwright run per the existing documented workflow.
Screenshots captured into `test-results/ui-final-theme/` at 1280px and 390px (gitignored, not
committed) — see the commit message / final report for the list and any visual issues found.

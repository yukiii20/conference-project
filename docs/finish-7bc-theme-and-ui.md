STEP 7B+C: New colour theme + shared UI on every page (one run).
Frontend first. No SQL, no schema changes, no weakened tests, test DB only,
ports 4100/5273 for throwaway servers, no secrets in frontend/git.
Do NOT redesign the layout: keep the brick home hero, the portal structure, and every
CONFERENCE page keeps the convenor's own primary_color.
Order: PART A (colours as tokens) first, then PART B (move every page onto the shared
components so the new colours appear everywhere), then PART C (check + finish).
Change colours only through tokens (Tailwind 4 @theme in the main CSS + src/lib/status.ts),
never hard-coded hex values in pages.

======== PART A: COLOUR THEME ========

A1. COLOUR TOKENS (use exactly these)
Brand colours from the user:
- Cosmic Latte   #B7A89A  (RGB 183,168,154)
- Mocha Cream    #E8DCC6  (RGB 232,220,198)
- Deep Burgundy  #722F37  (RGB 114,47,55)

Tokens:
- --color-page-bg        #F7F2EA   (very light Mocha Cream: page background)
- --color-surface        #FFFDF9   (cards, tables, dialogs, inputs)
- --color-surface-muted  #E8DCC6   (Mocha Cream: table header row, sidebar background,
                                    selected/hover rows, tag backgrounds)
- --color-border         #B7A89A   (Cosmic Latte: card/input/table borders, dividers)
- --color-border-soft    #DDD1C2   (light dividers inside cards)
- --color-brand          #722F37   (Deep Burgundy: top bar, footer, page titles accent,
                                    active sidebar item text + left bar, active tab underline,
                                    links)
- --color-brand-hover    #5C252C
- --color-text           #2B2420   (main text)
- --color-text-muted     #6B5E52   (secondary text; NOT #B7A89A, too light for text)
- --color-on-brand       #FFFFFF   (text on burgundy/navy)

Buttons:
- Primary (Save/Create/Submit/Sign in/Register): NAVY #1E3A8A, hover #172F6E,
  active #13285C, white text, focus ring 2px #1E3A8A with 2px offset.
- Secondary/Cancel: surface #FFFDF9, border #B7A89A, text #2B2420, hover bg #E8DCC6.
- Outline (Export/Download): transparent, border #1E3A8A, text #1E3A8A, hover bg #E8EDF8.
- Danger (Delete/Revoke/Reject): #B42318, hover #912018, white text. Danger must stay a clear
  RED, different from the burgundy brand colour.
- Link buttons: #1E3A8A, underline on hover.
- Disabled: 50% opacity, no hover.

Status (src/lib/status.ts, always text + colour):
- Success / accepted / approved / confirmed / checked in / valid / released:
  text #166534 on bg #DCFCE7, border #86EFAC. Success toast + success alert = same green.
- Pending / draft / waiting: text #92400E on bg #FEF3C7.
- Submitted / under review / info: text #1E3A8A on bg #E0E7FF.
- Rejected / revoked / cancelled / error: text #991B1B on bg #FEE2E2. Error toast = this red.
- Withdrawn / inactive: text #57534E on bg #E7E5E4.

A2. WHERE IT APPLIES
- Home page (except the hero), login/signup/forgot/reset, /portal (all roles),
  convenor portal, super admin, /verify, check-in desk, header, footer, toasts, dialogs.
- Top bar and footer: Deep Burgundy background, white text. Avatar = Mocha Cream circle with
  burgundy initials. Bell and user menu white icons.
- Sidebar: Mocha Cream background; active item = white surface, burgundy text, 3px burgundy left
  bar; hover = #DDD1C2.
- Stat cards: surface white-cream, Cosmic Latte border, burgundy number, muted label.
- Charts/bars (e.g. submissions per track): burgundy bars on a Mocha Cream track.
- KEEP AS IS: the brick-wall home hero (its buttons may use navy primary / white outline),
  and every CONFERENCE page keeps the convenor's own primary_color theme.

======== PART B: SHARED UI ON EVERY PAGE ========
Step 7 built src/components/ui/ and src/lib/status.ts but left many pages using one-off
buttons/inputs/cards (see "Not done" in docs/progress.md). Finish that now.

B1. MIGRATE EVERYTHING to src/components/ui/
- Every page and tab (auth pages, home, conference page, /portal, convenor portal,
  super admin, verify, check-in): replace one-off <button>, <input>, <select>, <textarea>,
  cards, table headers, badges, spinners and "no results" texts with the shared
  Button, Input/Select/Textarea, FormField, Card, PageHeader, Table, StatusChip, Spinner/Skeleton,
  EmptyState, ErrorState.
- Same rule as Step 7: Save/Create/Submit = primary; Cancel/Back = secondary; Delete/Revoke/
  Reject = danger + ConfirmDialog; Export/Download = outline with icon; one primary per section,
  primary on the right.
- Every page starts with the shared PageHeader (title + short subtitle + actions on the right).
- At the end, grep src/ for leftover raw `<button className=` / `<input className=` and list any
  that remain with a reason.

B2. TOP BAR (PortalHeader and any other app header)
- Nothing may be cut off at the top at any width (check 1280, 1024, 768, 390).
- Avatar readable on the burgundy bar (Mocha Cream circle, burgundy initials).
- Put Profile, Change password and Sign out inside ONE user menu (click avatar/name ->
  dropdown, keyboard accessible, closes on Esc/click outside). Keep the bell and the role chip.
- Same header on convenor portal, /portal and super admin.

B3. CONVENOR DASHBOARD
- Stat cards: rename "Reviews assigned" to "Reviews pending" and check every number is counted
  correctly in SQL (pending = assigned and not yet submitted; done = submitted).
  Add a test for these counts.
- Stat cards same height, cards clickable to the matching page (Submissions -> Papers, etc.).
- Sidebar items on one line ("Communication and reports" -> "Communication"; keep the URL).
- "Submissions per track": show every track including 0 (empty bar), same row height.

======== PART C: CHECK AND FINISH ========
- grep src/ for old hard-coded colour classes/hex (old navy header, blue-600 buttons, gray
  backgrounds, old green/red) and switch them to tokens. Also list any leftover raw
  `<button className=` / `<input className=` with a reason.
- Contrast WCAG AA for every text/background pair (write ratios in docs/ui-audit.md; if one
  fails, darken it slightly and note it). Text >= 14px, inputs 16px on mobile, visible focus ring.
- Same spacing scale, card radius/shadow, table style and font sizes on every page.
- Nothing cut off in the header at 1280, 1024, 768, 390px.
- Screenshots at 1280px and 390px into test-results/ui-final-theme/: home, conference page,
  login, signup, /portal for each role, convenor (all 7 pages), super admin (all tabs), verify,
  a success toast, an error state, a delete dialog. Open them and fix anything that still looks
  mismatched before finishing.
- tsc (root + server), build, npm test (root + server), re-seed
  (cd server && npx tsx tests/e2eSeed.ts), npx playwright test: all pass (update colour
  assertions only if tests check exact colours; update texts like "Reviews pending").
- Commit + push "Step 7B+C: colour theme and shared UI on every page".
  Update docs/progress.md and docs/ui-audit.md.
- Show me the test totals, commit hash and the screenshot folder path.

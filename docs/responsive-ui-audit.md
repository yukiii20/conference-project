# Responsive UI/UX audit

Date: 2026-10-16. Scope: audit and fix responsive behavior across the
existing application (React 19 + Vite + Tailwind CSS 4 frontend, Express +
MySQL backend — no framework changes, no schema changes).

## Summary

The application's shared layouts (convenor/manager sidebar, the shared
`/portal` shell added in Step 6, data tables, modals) were already built with
solid responsive foundations from earlier work — mobile drawer navigation
with a "Menu"/"Close menu" toggle, every data table wrapped in its own
`overflow-x-auto` container, `fixed inset-0 … px-4` + `w-full max-w-*` modal
sizing, `prefers-reduced-motion` support on the animated hero, and a global
`:focus-visible` outline. The audit's job was therefore to find the gaps in
that foundation, not rebuild it — and it found several concrete, fixable
ones, listed below with the files changed.

## Phase A — Audit findings (checklist)

- [x] Route inventory: every route in `src/App.tsx` reviewed (public pages,
      auth pages, super-admin, convenor/manager portal + 7 sections, the
      shared `/portal` shell + 4 role sections, certificate verification).
- [x] Shared layout audit: `PortalHeader`, `ConvenorSidebar`/`PortalSidebar`
      mobile drawer pattern, `ConferenceNav` (public page nav).
- [x] Table audit: every `<table>` in the codebase (10 files) — all already
      wrapped in `overflow-x-auto`, confirmed by direct inspection.
- [x] Modal/dialog audit: all 3 modal overlays in the codebase inspected.
- [x] Form grid audit: every `grid-cols-2`/`grid-cols-3`/`grid-cols-4` usage
      grepped and inspected for narrow-screen risk (date/datetime-local
      inputs are the highest-risk case — browsers need real room for them).
- [x] Icon-only action audit: grepped for bare icon buttons — none found;
      every button in the app already uses a visible text label.
- [x] Automated viewport overflow testing added (`e2e/responsive.spec.ts`)
      and run at 320/375/390/430/768/1024/1440px against real routes.
- [x] Screenshots captured and visually inspected (not just overflow-checked)
      for home, conference detail, convenor, staff check-in, and super admin
      at representative widths — see "Screenshots inspected" below.

## Problems found and fixed

1. **Public conference page nav overflowed by up to 298px at 768–1024px.**
   `src/pages/conference/ConferenceNav.tsx`'s desktop nav row switched on at
   the `md:` breakpoint (768px), but its 10 fixed section links plus
   Sign in/Register need ~1066px to lay out in one row — so from 768px up to
   1065px it overflowed the page horizontally (confirmed empirically:
   `scrollWidth` 1066 vs `clientWidth` 768/1024). Root-caused with a small
   diagnostic script that walked the DOM for elements extending past the
   viewport edge, rather than guessing from CSS alone. **Fix:** moved both
   the desktop nav's `md:flex` and the mobile hamburger's `md:hidden` to the
   `xl:` breakpoint (1280px), so the two stay in sync and the hamburger
   covers the whole 768–1279px range where the full row doesn't fit.
   Verified with a one-off script that there's no overflow at 768/1024/1280/
   1440 after the fix, then via the new automated suite.

2. **Direct navigation to a role-gated portal route bounced to the
   dashboard.** `src/pages/PortalPage.tsx`'s `conferenceId` state started as
   `null` and was only resolved by a `useEffect` — so on the very first
   render (before that effect ran), routes like `/portal/author` evaluated
   `sectionIds.has('author') && conferenceId` as false and redirected to
   `/portal/dashboard` before the effect ever got a chance to set the real
   value. This broke the "old URL redirects into the shared portal" case
   and any notification whose `link_path` points straight at a section (the
   server already does, e.g. `/portal/author` on a new-submission
   notification). Not a layout bug, but a real navigation defect this audit's
   Playwright pass surfaced. **Fix:** `conferenceId` is now resolved with a
   synchronous `useState` lazy initializer from the `roles` already loaded
   by `ProtectedRoute` before `PortalPage` ever mounts, instead of only via
   the effect.

3. **Several form grids used a bare `grid-cols-2`/`grid-cols-3` with no
   narrow-screen fallback**, most riskily around `type="date"` and
   `type="datetime-local"` inputs, which need real width to render without
   clipping in Chromium. Changed to `grid-cols-1 … sm:grid-cols-N` (stacks
   below 640px) in:
   - `src/pages/convenor/KeyDatesTab.tsx` (deadline window opens/closes —
     the highest-traffic case, every conference's key dates use this)
   - `src/pages/convenor/ConferenceDetailsTab.tsx` (start/end date)
   - `src/pages/convenor/LocationTab.tsx` (city/country)
   - `src/pages/convenor/ProgrammeTab.tsx` (session start/end datetime)
   - `src/pages/convenor/CertificatesTab.tsx` (certificate type/name,
     signature-layout x/y/color, signatory name/title)
   - `src/pages/SuperAdminPage.tsx` (new-conference short name/code,
     start/end date, city/country/timezone — 3 grids)

4. **A confirm modal had no height/scroll safety net.**
   `src/pages/SuperAdminPage.tsx`'s "Anonymise this user?" dialog lacked the
   `max-h-full overflow-y-auto` + `py-8` outer padding the other two modals
   in the app already use, so on a short landscape phone viewport its
   content could in principle run past the screen with no way to scroll to
   the buttons. Brought in line with the existing `ProgrammeTab` modal
   pattern.

5. **Mobile menu toggles lacked `aria-expanded`/`aria-controls`.** The
   convenor/manager and shared-portal "Menu" buttons
   (`src/pages/ConvenorPage.tsx`, `src/pages/PortalPage.tsx`) only conveyed
   open/closed state via their visible text ("Menu" / "Close menu"), with no
   programmatic state for assistive tech — unlike `ConferenceNav`'s mobile
   toggle, which already had `aria-expanded`. Added `aria-expanded={open}`
   and `aria-controls` pointing at the sidebar/drawer region to both.

## Automated responsive testing

New file: `e2e/responsive.spec.ts`. For each of **320, 375, 390, 430, 768,
1024, 1440px** it asserts `document.documentElement.scrollWidth -
clientWidth <= 1px` (a strict, mechanical check for unintended page-level
horizontal scroll) across:

- Public pages: home, conference detail, login, signup, privacy, terms, and
  `/verify/:token` with a token that doesn't exist (the "not found" state).
- The conference detail page with its mobile menu opened (where present).
- The convenor portal dashboard and all 7 sections (setup, schedule-basics,
  people, papers, event, communication).
- The manager portal (same shell as convenor, different base path).
- Every super-admin tab (Dashboard, Conferences, Users, Admins, Platform
  settings, Email log).
- The shared `/portal` shell for author, reviewer, session chair, and staff:
  dashboard, each role's own section, My ticket, and My certificates — with
  the mobile drawer reopened before each click at narrow widths, since every
  `NavLink` click closes it again.

42 tests × clean pass across all 7 widths, run against the existing
throwaway backend (`:4100`)/frontend (`:5273`) instances and
`conference_cms_test` database, the same setup `docs/phase4-test-steps.md`
already documents — no new test infrastructure, no real email, no
production data.

## Screenshots inspected

Captured with Playwright (`fullPage: true`) and viewed directly, not just
overflow-checked:

| Page | Width | Result |
|---|---|---|
| Home | 390px | Hero wraps to 3 lines, stat row stays readable, badge/brick background holds; footer stacks to one column. Clean. |
| Home | 1440px | Full desktop nav row, 3-column conference card grid. Clean. |
| Conference detail | 390px | Hamburger menu, sections stack one per row, key-dates table readable. Clean. |
| Conference detail | 1024px | Hamburger menu (post-fix — this width is below the new 1280px desktop-nav cutover), no overflow, content column comfortably within the viewport. Clean. |
| Convenor → Event → Programme | 390px | "Menu" button present, the fixed room/time-slot/session forms all single-column post-fix, checkboxes wrap. Clean. |
| Staff check-in | 390px | Stat tiles, camera card, manual search, registrations filters all usable one-handed. Clean. |
| Super admin dashboard | 1024px | 8-tab row fits on one line (doesn't even need to wrap at this width), stat/health card grids clean. |

One pre-existing, non-responsive observation: the home page has a couple of
large pale `bg-landing-bg`-toned bands between sections (e.g. where
`Announcements` has zero items, that section is conditionally omitted
entirely by design — `{announcements.length > 0 ? <section>… : null}` in
`src/pages/HomePage.tsx`). This is content/empty-state behavior, identical
at every viewport width, not a layout defect — left untouched per "preserve
the current design direction, don't redesign the homepage."

## Regression testing (commands run and results)

| Command | Result |
|---|---|
| `npx tsc --noEmit` (root) | ✅ Pass |
| `cd server && npx tsc --noEmit` | ✅ Pass |
| `npm run build` (root → `dist/`) | ✅ Pass — main bundle 788 KB / 196 KB gzip, `CheckInPanel` chunk stays split at 481 KB (zxing lazy-loaded, unaffected by this audit) |
| `cd server && npm run build` | ✅ Pass |
| `npm test` (root, Vitest) | ✅ 21/21 passed |
| `cd server && npm test` (Vitest) | ✅ 441/445 passed, 1 pre-existing Windows worker-pool crash (exit code `3221226505`, documented in `docs/final-test-report.md`) in `roleRequests.test.ts`, unrelated to this audit — re-ran that file alone immediately after and it passed 4/4. Not caused by, or related to, any change in this pass. |
| `npx playwright test` (full suite incl. new `responsive.spec.ts`) | ✅ 88/88 passed |

The two genuine bugs this audit found (`ConferenceNav` breakpoint,
`PortalPage` conferenceId race) were root-caused and fixed, then verified
clean through the full suite above — not worked around in the tests.

## Files changed

Frontend:
- `src/pages/conference/ConferenceNav.tsx` — breakpoint fix (bug #1)
- `src/pages/PortalPage.tsx` — conferenceId race fix (bug #2) + aria-expanded
- `src/pages/ConvenorPage.tsx` — aria-expanded/aria-controls on Menu button
- `src/pages/SuperAdminPage.tsx` — modal scroll safety + 3 grid stacking fixes
- `src/pages/convenor/KeyDatesTab.tsx`, `ConferenceDetailsTab.tsx`,
  `LocationTab.tsx`, `ProgrammeTab.tsx`, `CertificatesTab.tsx` — grid
  stacking fixes

Tests:
- `e2e/responsive.spec.ts` (new) — the 42-test viewport/overflow suite above

## Remaining limitations (honest disclosure, not claimed as done)

- **1920px** is listed among the task's general target widths but the
  automated-testing section only required up to 1440px; 1440px passed with
  comfortable margin (desktop nav needs ~1066px of 1440 available) so 1920
  is very unlikely to regress, but it was not independently run through the
  automated check or screenshotted.
- **Real-device testing** (actual phones/tablets, real camera hardware for
  the staff QR scanner, real touch input) was not performed — this is a
  CLI/headless-Chromium environment, same limitation already noted in
  `docs/final-test-report.md` for the camera scanner and real SMTP.
  `CheckInPanel`'s "Camera scanning is not supported in this browser"
  fallback path exists and was read/confirmed in code, not exercised against
  a real denied-permission or no-camera device.
- **No automated accessibility scanner** (e.g. axe-core) was introduced —
  none existed in the project before this pass, and adding one is a bigger
  decision than a responsive-focused audit should make unilaterally. The
  accessibility work done here (aria-expanded/aria-controls on the two
  previously-silent menu toggles; confirming no icon-only buttons lack a
  label; confirming `:focus-visible` is global) was targeted, not a full
  WCAG 2.2 AA pass — no compliance claim is made.
- **Every admin sub-dialog/action row** was not individually
  screenshot-inspected at every width — the automated overflow check runs
  on every super-admin tab's default render, which is the highest-value,
  lowest-cost coverage; interactive states reached only via a specific
  button click (e.g. the anonymise-confirm modal, the idle-timeout warning)
  were read in code and fixed where a defect was found (item #4), not
  exhaustively screenshotted per width.
- `/verify/:token`'s **valid-token** rendering was checked for overflow only
  with an invalid token (same reachability limitation already documented in
  `docs/final-test-report.md` — a real token lives inside a downloaded PDF's
  QR code, not practical to drive from a browser test).

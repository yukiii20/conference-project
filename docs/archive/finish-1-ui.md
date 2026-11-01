STEP 1 — All pending UI changes in one go. Frontend only: no backend/database changes, no SQL.
Keep every existing feature working. Ignore any earlier instruction that conflicts with this file.

A. HOME PAGE HERO = BRICK WALL (src/pages/HomePage.tsx)
- The top hero ("Run your academic conference in one place", buttons, stats, animation card)
  currently has a NAVY background. Replace it with a red brick-wall background: inline SVG
  pattern (or CSS background with an inline SVG data URL), tile 80x40, running bond:
  mortar #E9E2DA; row 1 bricks x=2 and x=42, y=2; row 2 offset bricks x=-18, 22, 62, y=22;
  each 36x16 rx=3; brick colours #C4502F, #B5462A, #D0603A, #A83E26.
- Dark overlay rgba(42,14,7,0.55) so white text passes WCAG AA.
- "Browse conferences": white bg, text #7A2E1B. "Submit abstract": transparent, white border/text.
- The animation card itself (ConferenceOpeningScene) stays as it is, but it must replay every
  5 seconds (fix if stuck on the last frame). Header, other sections and footer unchanged.

B. CONFERENCE PAGES FOLLOW THE CONVENOR'S COLOUR (ConferencePage.tsx, ConferenceNav, badge)
- Remove ALL hard-coded brick/brown colours on conference pages. Use the conference
  primary_color (fallback DEFAULT_CONFERENCE_COLOR).
- With banner: overlay = darkened primary_color at ~0.65 opacity. Without banner: solid
  primary_color. Buttons/links/active nav use primary_color; text colour auto white/dark via
  color.ts contrast helpers.
- Conference logo in the TOP-LEFT of the conference header (36-40px); remove the big logo
  from the middle of the hero. No logo -> conference code in a small rounded square.
- Convenor can set the colour in Conference setup > Logo and branding: colour picker + hex
  input + live preview.

C. CONFERENCE BADGE ANIMATION (src/components/ConferenceBadgeAnimation.tsx)
- 6-second infinite loop, pure CSS keyframes: drop in from -140px and swing to 14deg;
  damped swing 14 -> -10 -> 7 -> -4 -> 2 -> 0; rest; a tick pops into the circle and a soft
  shine sweeps across (clipped to the badge); lift back up; repeat. Corner dot pulses with
  an expanding ring every 1.6 s. transform-box: fill-box; unique keyframe names.
- Round circle = conference LOGO (SVG clipPath circle, image xMidYMid slice, white ring);
  no logo -> conference initials.
- Grey placeholder lines -> conference short_name (fallback: name), bold, max 2 lines,
  shrink to min 9px then "...". Keep the code band (e.g. CS12) at the top.
- Colours from primary_color (lanyard lighter, band darker). ~150x190 desktop, 120x150 mobile.
- prefers-reduced-motion: static badge.

D. TEXT
- "Submit your research" -> "Submit abstract" everywhere.

E. CONVENOR SIDEBAR: 7 PAGES WITH TABS (src/pages/ConvenorPage.tsx)
1 Dashboard /convenor/dashboard
2 Conference setup /convenor/setup: Details | Logo and branding | Location | Supporters
3 Dates and tracks /convenor/dates: Key dates | Tracks
4 People /convenor/people: Role requests | Members and roles | Committees | Speakers
5 Papers /convenor/papers: Submissions | Reviews and decisions | Review settings
6 Event /convenor/event: Programme | Attendance | Certificates ("Coming soon" until built)
7 Communication and reports /convenor/communication: Announcements | Email templates |
  Email log | Reports | Activity log
- Each tab has its own URL; old URLs redirect; badges on People (pending requests) and
  Papers (waiting for reviewer/decision); hide tabs without permission; "Discard changes?"
  when leaving a tab with unsaved edits; mobile: menu button + horizontally scrollable tabs.

F. CHECK
- npx tsc --noEmit, npm run build, npm test, npx playwright test pass (update tests/links
  for the new URLs and texts).
- Screenshots at 1280px and 390px: home, two conferences with different colours (with and
  without banner), convenor portal -> test-results/ui-final/.

PRODUCT VIDEO: an animated, narrated 1080p product video of the REAL app, then show it on the home page.
Tools: the project's Playwright (already installed), edge-tts (run it as `python -m edge_tts`, NOT
`edge-tts`), ffmpeg/ffprobe (installed with winget). All video work lives in demo-video/.

SAFETY RULES
- Do not change app features. Only create files in demo-video/, plus the small home-page section
  in Part 4 and the video files in public/video/.
- Record ONLY against the local test setup: conference_cms_test, throwaway servers on 4100
  (EMAIL_MODE=console) and 5273. Never touch conference_cms, never the live Render/Vercel/Aiven
  site, never run SQL by hand, never change tables or triggers.
- Dummy data only (example.test emails, fake names). Passwords from demo-video/.env.demo
  (gitignored); typed into fields so they show as dots; never printed in logs, narration,
  subtitles or the video. No real emails sent.
- Gitignore demo-video/work/, demo-video/output/, demo-video/.env.demo.
- Never claim a scene works unless you saw it work while recording.
- Check docs/progress.md first: if Step 7B+C (new colour theme) is NOT done, stop and ask me
  whether to record now or after the theme step.

PART 1: CHECK + PLAN (stop after this and show me)
1. Check: node, npx playwright, ffmpeg, ffprobe, `python -m edge_tts --list-voices`.
2. For each scene, find the real route/button and confirm it exists: table Scene | Route | OK?
3. demo-video/demo-seed.ts (pattern of server/tests/e2eSeed.ts, re-runnable, test DB only):
   published conference "International Conference on Cyber Security 2026" (short CS26, logo,
   brand colour, 3 tracks, key dates, programme with 2 sessions), demo admin, convenor, author
   (with an accepted paper), reviewer, staff, attendee, 15 fake registrations (some checked in),
   one active certificate template with a demo background + signature (create simple demo images
   with sharp if needed).
4. demo-video/script.md: narration (friendly, professional, plain English, 2.5-3.5 min total),
   one or two short sentences per scene + the on-screen caption text for each scene.
   Offer 3 English voices (e.g. en-US-AriaNeural, en-US-GuyNeural, en-GB-SoniaNeural).
   WAIT for my OK.

SCENES (real app unless marked ANIMATED)
 1 ANIMATED intro (5 s): logo reveal + "Conference Management System" + tagline
   "Run your academic conference in one place". Burgundy/cream theme.
 2 Home page: hero, scroll to conferences, open CS26 page (dates, tracks, programme).
 3 ANIMATED feature card (3 s): "Submit & review" with 3 icons.
 4 Author signs in -> New abstract -> chooses track -> attaches PDF -> submits -> gets code.
 5 Reviewer: My reviews -> opens paper (no author names) -> submits review. Callout: "Blind review".
 6 Convenor dashboard (stat cards) -> Papers -> accepts the paper.
 7 Programme: session grid -> paper scheduled -> published on the public page.
 8 ANIMATED feature card (3 s): "Register & check in".
 9 Attendee registers -> My ticket with QR code.
10 Staff check-in desk: search attendee -> Check in -> green status, counts go up.
11 ANIMATED feature card (3 s): "Certificates in one click".
12 Convenor Certificates: template with background + signature -> Generate -> Release.
13 Attendee My certificates -> Download -> open the PDF in a tab (downloads are invisible in
   recordings) and show it 3 s.
14 /verify link -> "Valid"; convenor revokes -> verify shows "Revoked". Callout: "Tamper-proof QR".
15 Super admin dashboard (health card, conferences) - 4 s.
16 ANIMATED outro (5 s): feature checklist ticking in one by one + "Conference Management System"
   + "Abstracts · Reviews · Programme · Registration · Certificates".

PART 2: RECORD (after my OK)
- demo-video/record.ts: Chromium, viewport 1920x1080, recordVideo 1920x1080, one file per scene
  (`npx tsx demo-video/record.ts --scene 10` re-records one scene).
- Human feel: injected cursor overlay (dark dot with white ring, eased movement ~0.8 s, click
  ripple), typing ~60 ms/key, 0.8-1.5 s pauses, smooth scrolling, wait for real elements/network
  (no blind sleeps where a real wait works). Avoid native <select> popups and native dialogs.
- ANIMATED scenes: build them as small HTML pages in demo-video/animations/ using CSS keyframe
  animations in the app's theme (Deep Burgundy #722F37, Mocha Cream #E8DCC6, Cosmic Latte
  #B7A89A, navy #1E3A8A, green #166534, Inter font), and record them with the same Playwright
  recorder so they are real motion (fade/slide/scale, staggered icons, ticks drawing in).
- Callouts: small rounded label (cream background, burgundy text, soft shadow) that slides in
  near the relevant element for 2 s (inject into the page during recording).
- End of each scene: screenshot to demo-video/work/check/. Open them and fix anything broken.

PART 3: POLISH + EXPORT
- Voice: per scene `python -m edge_tts --voice <chosen> --rate=-5% --text "<line>"
  --write-media work/vo/NN.mp3 --write-subtitles work/vo/NN.srt`. Measure with ffprobe; if the
  scene is shorter than its narration, hold the last frame (tpad) until voice end + 0.4 s.
- Camera: on the 4-5 most important moments (submit button, review form, check-in click, QR,
  certificate PDF, verify result) add a smooth eased zoom to ~1.35x on the action area and back
  (ffmpeg zoompan/crop with easing, no jerky motion).
- Transitions: 0.5 s crossfade between real scenes, slide/wipe into and out of ANIMATED cards
  (ffmpeg xfade: fade, slideleft, smoothleft).
- Audio: narration normalised (loudnorm -16 LUFS). Background music ONLY if I put a royalty-free
  file at demo-video/assets/music.mp3 (then duck it under the voice to about -24 LUFS).
- Subtitles: merge per-scene SRTs with correct offsets -> demo.srt and demo.vtt.
- Outputs in demo-video/output/:
  product-video-1080p.mp4 (H.264 High, yuv420p, 30 fps, AAC 192k, +faststart, CRF ~20)
  product-video-1080p-subtitled.mp4 (burned-in subtitles, white text on dark rounded box)
  product-video-web.mp4 (1080p, CRF ~26, target <= 15 MB, +faststart) for the website
  demo.srt, demo.vtt, poster.jpg (nice frame from the intro, 1920x1080, < 200 KB)
- QA: duration, 1920x1080, audio present, no black frames/gaps, subtitles in sync (grab frames at
  5 points), file sizes. Report what you checked.

PART 4: SHOW IT ON THE HOME PAGE
- Copy product-video-web.mp4, demo.vtt and poster.jpg to public/video/ (web versions only).
- Home page: add a "See it in action" section right below the hero, in the current design and
  theme (shared components, tokens):
  heading "See it in action" + one-line subtitle, a 16:9 rounded card with soft shadow containing
  <video controls playsinline preload="none" poster="/video/poster.jpg"> with
  <track kind="captions" src="/video/demo.vtt" srclang="en" label="English" default>,
  no autoplay with sound, width 100% (max ~1100px), no layout shift (aspect-ratio 16/9).
  Add a "Watch the demo" button in the hero that smoothly scrolls to this section and focuses play.
- prefers-reduced-motion: no auto-scroll animation. Mobile 390px: full width, no horizontal scroll.
- Lighthouse on the home page must not get worse (video uses preload="none" so LCP is unaffected).
- Tests: Playwright checks the section exists, the video has a poster and captions track, and
  there is no horizontal scroll at 390px. tsc, build, npm test, re-seed, npx playwright test pass.
- Write demo-video/README.md (re-run steps, re-record one scene, swap voice/music).
- Stop throwaway servers. Commit + push "Product video and home page section"
  (commit public/video/ web files + scripts; NOT demo-video/work or output). Update progress.md.
  Show me the output file paths, durations and sizes.

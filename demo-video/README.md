# Product video pipeline

Self-contained scripts that produce the "See it in action" product video shown
on the home page. Never imported by `src/` or `server/src/` - see
`docs/product-video.md` for the full spec and safety rules this pipeline
follows (test database only, dummy data, no real emails, demo accounts'
password never logged or shown on screen).

## Layout

- `demo-seed.ts` - seeds `conference_cms_test` with the demo conference
  (CS26), accounts, submissions, programme, registrations, and certificate
  template. Re-runnable (wipes and re-inserts its own fixture rows only).
- `.env.demo` (gitignored, not committed) - `DEMO_PASSWORD`, the one shared
  password for every `demo-*@example.test` account. Copy `.env.demo.example`
  to create it.
- `record.ts` - drives a real Chromium browser (Playwright) through all 16
  scenes against the throwaway `:5273`/`:4100` servers, recording one `.webm`
  per scene into `work/raw/` and a screenshot into `work/check/`.
- `animations/` - the 5 ANIMATED scenes (intro, two feature cards, outro),
  plain HTML/CSS pages recorded the same way as the real-app scenes.
- `narration.json` - per-scene narration text, in sync with `script.md`.
- `gen-voice.ts` - generates `work/vo/NN.mp3` + `NN.srt` per scene via
  `edge-tts`. **Needs network access to `speech.platform.bing.com`**, which
  the default Claude Code Bash sandbox blocks - run with the sandbox
  disabled, or just run it normally in a regular terminal.
- `build.ts` - Part 3: speeds up/holds/zooms each scene to line up with its
  narration, crossfades them together, normalises audio, burns subtitles,
  and writes the final files to `output/` (gitignored - see below).
- `script.md` - the narration + caption text and the voice choice.

## Re-running the whole pipeline

From the repo root:

```bash
cd demo-video
npx tsx demo-seed.ts                         # 1. seed conference_cms_test
cd ..
# 2. start the throwaway backend (separate terminal)
cd server && DB_NAME=conference_cms_test NODE_ENV=test STORAGE_ROOT=storage-test-e2e \
  CLIENT_ORIGIN=http://localhost:5273 PORT=4100 EMAIL_MODE=console npm run dev
# 3. start the throwaway frontend (separate terminal)
cd .. && VITE_API_PROXY_TARGET=http://localhost:4100 npx vite --port 5273
# 4. record every scene
npx tsx demo-video/record.ts
# 5. generate narration (needs real network access - see note above)
npx tsx demo-video/gen-voice.ts
# 6. build the final exports
npx tsx demo-video/build.ts
```

Stop the two throwaway servers when done. Outputs land in `demo-video/output/`:
`product-video-1080p.mp4`, `product-video-1080p-subtitled.mp4`,
`product-video-web.mp4`, `demo.srt`, `demo.vtt`, `poster.jpg`. Copy the three
web-facing files (`product-video-web.mp4`, `demo.vtt`, `poster.jpg`) into
`public/video/` to update what the home page actually serves.

## Re-recording one scene

```bash
npx tsx demo-video/record.ts --scene 10
```

Each scene is seeded to a known starting state independent of the others
(see the comments in `demo-seed.ts` for why there are three separate
submission fixtures, not one shared across scenes 5/6/7) - re-record any
single scene without having to re-run the whole set first. After
re-recording, re-run `gen-voice.ts` only if that scene's narration text
changed, then `npx tsx demo-video/build.ts` to rebuild the final exports
(it re-derives every scene's speed/hold/zoom from `narration.json` and the
files in `work/raw/` + `work/vo/`, so a single changed scene doesn't require
hand-editing anything else).

## Swapping the voice

1. Edit `VOICE` at the top of `gen-voice.ts` (any `edge-tts` voice ID - run
   `python -m edge_tts --list-voices` for the full list; `script.md` lists
   three candidates that were considered).
2. Delete `work/vo/` and re-run `gen-voice.ts`.
3. Re-run `build.ts`.

## Adding background music

Put a royalty-free file at `demo-video/assets/music.mp3` (gitignored - not
committed) and re-run `build.ts`; it's absent by default and the build
skips music entirely when the file isn't there (never fetches one on its
own, per `docs/product-video.md`'s safety rules). If added, it's ducked
under the narration automatically.

## Gitignored (never committed)

`work/` (raw recordings, generated voice, intermediate render files),
`output/` (final exports - only the three web files get copied into
`public/video/` and committed from there), `.env.demo` (the real demo
password).

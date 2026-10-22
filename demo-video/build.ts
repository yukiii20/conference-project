// Polish + export pipeline (Part 3 of docs/product-video.md). Turns the raw
// Playwright recordings in work/raw/ + the edge-tts narration in work/vo/
// into the final files in output/.
//
// Run with: npx tsx demo-video/build.ts [--step=scenes|mux|concat|final|all]
// (default: all). Steps are separable so a failure partway through doesn't
// require re-running everything - scenes/mux/concat each write their own
// intermediate files under work/, safe to re-run.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RAW = path.join(__dirname, 'work/raw')
const VO = path.join(__dirname, 'work/vo')
const SCENES_FINAL = path.join(__dirname, 'work/scenes_final')
const MUXED = path.join(__dirname, 'work/muxed')
const OUT = path.join(__dirname, 'output')
for (const d of [SCENES_FINAL, MUXED, OUT]) mkdirSync(d, { recursive: true })

type Scene = {
  num: number
  name: string
  animated: boolean
  text: string
  rawDur: number
  narrDur: number
  zoom: boolean
}

// Measured once (ffprobe on work/raw/*.webm and work/vo/*.mp3), hardcoded
// here so the build is deterministic without re-probing every run. If a
// scene is re-recorded or re-voiced, update its rawDur/narrDur below (or
// just re-run `ffprobe -show_entries format=duration` on the new file).
const narration: Array<{ num: number; name: string; animated: boolean; text: string }> = JSON.parse(
  readFileSync(path.join(__dirname, 'narration.json'), 'utf8'),
)
const RAW_DUR: Record<number, number> = {
  1: 5.08, 2: 7.2, 3: 3.08, 4: 42.88, 5: 32.24, 6: 29.2, 7: 19.36, 8: 3.08,
  9: 15.4, 10: 16.84, 11: 3.12, 12: 18.56, 13: 44.32, 14: 20.36, 15: 10.72, 16: 5.08,
}
const NARR_DUR: Record<number, number> = {
  1: 6.216, 2: 7.872, 3: 4.872, 4: 9.528, 5: 6.336, 6: 7.416, 7: 7.392, 8: 4.608,
  9: 5.832, 10: 5.544, 11: 4.224, 12: 8.688, 13: 5.256, 14: 9.744, 15: 5.856, 16: 7.968,
}
// The 5 "most important moments" (submit button, review form, check-in,
// certificate PDF, verify result) get the eased zoom-in/out.
const ZOOM_SCENES = new Set([4, 5, 10, 13, 14])

const SCENES: Scene[] = narration.map((n) => ({
  ...n,
  rawDur: RAW_DUR[n.num]!,
  narrDur: NARR_DUR[n.num]!,
  zoom: ZOOM_SCENES.has(n.num),
}))

function nn(num: number): string {
  return String(num).padStart(2, '0')
}

function ffmpeg(args: string[]): void {
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: 'inherit' })
}

function ffprobeDuration(file: string): number {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ]).toString().trim()
  return Number(out)
}

/** Speed factor + final (post-speed, post-hold) duration for one scene. Animated scenes are never sped up (they're short, purpose-built loops). */
function planScene(s: Scene): { speed: number; preHoldDur: number; finalDur: number; pad: number } {
  if (s.animated) {
    const finalDur = Math.max(s.rawDur, s.narrDur + 0.4)
    return { speed: 1, preHoldDur: s.rawDur, finalDur, pad: Math.max(0, finalDur - s.rawDur) }
  }
  const desired = s.rawDur / (s.narrDur + 1.5)
  const speed = Math.min(3.5, Math.max(1, desired))
  const preHoldDur = s.rawDur / speed
  const finalDur = Math.max(preHoldDur, s.narrDur + 0.4)
  return { speed, preHoldDur, finalDur, pad: Math.max(0, finalDur - preHoldDur) }
}

function inputFor(s: Scene): string {
  return path.join(RAW, `${nn(s.num)}-${s.name.replace(/^\d+-/, '')}.webm`)
}

// --- Step 1: per-scene video (speed, hold, zoom, 30fps, 1920x1080) --------
function buildScenes(): void {
  for (const s of SCENES) {
    const { speed, finalDur, pad } = planScene(s)
    const input = inputFor(s)
    if (!existsSync(input)) throw new Error(`Missing raw recording for scene ${s.num}: ${input}`)

    const filters: string[] = [`setpts=PTS/${speed.toFixed(4)}`]
    if (s.zoom) {
      // Smooth eased zoom to ~1.35x and back, centred - see Part 3 verification notes.
      const D = (finalDur - pad).toFixed(3) // zoom runs over the pre-hold (real motion) portion only
      filters.push(
        `scale=w='iw*(1+0.35*sin(PI*min(t\\,${D})/${D}))':h='ih*(1+0.35*sin(PI*min(t\\,${D})/${D}))':eval=frame`,
        `crop=1920:1080:(in_w-1920)/2:(in_h-1080)/2`,
      )
    }
    if (pad > 0) {
      filters.push(`tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)}`)
    }
    filters.push('fps=30', 'format=yuv420p')

    const out = path.join(SCENES_FINAL, `${nn(s.num)}.mp4`)
    console.log(`[scenes] ${nn(s.num)} speed=${speed.toFixed(2)}x finalDur=${finalDur.toFixed(2)}s zoom=${s.zoom} pad=${pad.toFixed(2)}s`)
    ffmpeg(['-i', input, '-vf', filters.join(','), '-an', '-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', out])
    const actual = ffprobeDuration(out)
    if (Math.abs(actual - finalDur) > 0.3) {
      console.warn(`  ! scene ${nn(s.num)}: expected ~${finalDur.toFixed(2)}s, got ${actual.toFixed(2)}s`)
    }
  }
}

// --- Step 2: mux each scene's video with its narration ---------------------
function muxScenes(): void {
  for (const s of SCENES) {
    const video = path.join(SCENES_FINAL, `${nn(s.num)}.mp4`)
    const audio = path.join(VO, `${nn(s.num)}.mp3`)
    const out = path.join(MUXED, `${nn(s.num)}.mp4`)
    // Video stream dictates final duration (built >= narration+0.4 in planScene) -
    // apadding the audio with silence avoids an abrupt cut if ffmpeg's -shortest
    // logic ever disagrees with our own duration math by a frame or two.
    ffmpeg([
      '-i', video, '-i', audio,
      '-filter_complex', '[1:a]apad[a]',
      '-map', '0:v', '-map', '[a]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
      '-shortest',
      out,
    ])
  }
}

// --- Step 3: fold-concat with crossfades -----------------------------------
function transitionFor(a: Scene, b: Scene): string {
  return a.animated || b.animated ? 'smoothleft' : 'fade'
}

function concatScenes(): string {
  let accum = path.join(MUXED, `${nn(SCENES[0]!.num)}.mp4`)
  let accumDur = ffprobeDuration(accum)
  const XFADE = 0.5

  for (let i = 1; i < SCENES.length; i += 1) {
    const prev = SCENES[i - 1]!
    const cur = SCENES[i]!
    const nextClip = path.join(MUXED, `${nn(cur.num)}.mp4`)
    const offset = Math.max(0, accumDur - XFADE)
    const transition = transitionFor(prev, cur)
    const out = path.join(MUXED, `_accum_${i}.mp4`)
    console.log(`[concat] ${nn(prev.num)} -> ${nn(cur.num)} (${transition}, offset ${offset.toFixed(2)}s)`)
    ffmpeg([
      '-i', accum, '-i', nextClip,
      '-filter_complex',
      `[0:v][1:v]xfade=transition=${transition}:duration=${XFADE}:offset=${offset.toFixed(3)}[v];` +
        `[0:a][1:a]acrossfade=d=${XFADE}[a]`,
      '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '192k',
      out,
    ])
    accum = out
    accumDur = ffprobeDuration(accum)
  }
  const finalConcat = path.join(OUT, '_concat_raw.mp4')
  ffmpeg(['-i', accum, '-c', 'copy', finalConcat])
  console.log(`[concat] total duration: ${ffprobeDuration(finalConcat).toFixed(2)}s`)
  return finalConcat
}

// --- Step 4: subtitles (merged, cumulative-offset) --------------------------
function srtTimestamp(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const sec = Math.floor(totalSeconds % 60)
  const ms = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000)
  const p2 = (n: number) => String(n).padStart(2, '0')
  const p3 = (n: number) => String(n).padStart(3, '0')
  return `${p2(h)}:${p2(m)}:${p2(sec)},${p3(ms)}`
}

function buildSubtitles(): { srt: string; vtt: string } {
  const XFADE = 0.5
  let cursor = 0
  const entries: Array<{ idx: number; start: number; end: number; text: string }> = []
  for (let i = 0; i < SCENES.length; i += 1) {
    const s = SCENES[i]!
    const { finalDur } = planScene(s)
    const start = i === 0 ? 0 : cursor - XFADE
    const end = start + s.narrDur
    entries.push({ idx: i + 1, start: Math.max(0, start), end, text: s.text })
    cursor = (i === 0 ? finalDur : cursor - XFADE + finalDur)
  }

  const srtLines = entries
    .map((e) => `${e.idx}\n${srtTimestamp(e.start)} --> ${srtTimestamp(e.end)}\n${e.text}\n`)
    .join('\n')
  const srtPath = path.join(OUT, 'demo.srt')
  writeFileSync(srtPath, srtLines, 'utf8')

  const vttLines =
    'WEBVTT\n\n' +
    entries
      .map((e) => `${vttTs(e.start)} --> ${vttTs(e.end)}\n${e.text}\n`)
      .join('\n')
  const vttPath = path.join(OUT, 'demo.vtt')
  writeFileSync(vttPath, vttLines, 'utf8')
  return { srt: srtPath, vtt: vttPath }
}

function vttTs(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const sec = Math.floor(totalSeconds % 60)
  const ms = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000)
  const p2 = (n: number) => String(n).padStart(2, '0')
  const p3 = (n: number) => String(n).padStart(3, '0')
  return `${p2(h)}:${p2(m)}:${p2(sec)}.${p3(ms)}`
}

// --- Step 5: loudnorm + final exports ---------------------------------------
function finalExports(concatRaw: string): void {
  const normalized = path.join(OUT, '_normalized.mp4')
  ffmpeg([
    '-i', concatRaw,
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
    '-c:v', 'copy',
    normalized,
  ])

  const p1080 = path.join(OUT, 'product-video-1080p.mp4')
  ffmpeg([
    '-i', normalized,
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'slow', '-r', '30',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    p1080,
  ])

  const { srt } = buildSubtitles()
  const pSub = path.join(OUT, 'product-video-1080p-subtitled.mp4')
  const subFilterPath = srt.replace(/\\/g, '/').replace(':', '\\:')
  ffmpeg([
    '-i', normalized,
    '-vf',
    `subtitles='${subFilterPath}':force_style='FontName=Arial,FontSize=20,PrimaryColour=&H00FFFFFF,BackColour=&H90000000,BorderStyle=4,Outline=0,Shadow=0,Alignment=2,MarginV=40'`,
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'slow', '-r', '30',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    pSub,
  ])

  const pWeb = path.join(OUT, 'product-video-web.mp4')
  ffmpeg([
    '-i', normalized,
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '28', '-preset', 'slow', '-r', '30',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    pWeb,
  ])

  const poster = path.join(OUT, 'poster.jpg')
  ffmpeg(['-i', p1080, '-ss', '3', '-frames:v', '1', '-q:v', '4', poster])
}

const step = process.argv.find((a) => a.startsWith('--step='))?.slice('--step='.length) ?? 'all'

if (step === 'scenes' || step === 'all') buildScenes()
if (step === 'mux' || step === 'all') muxScenes()
if (step === 'concat' || step === 'final' || step === 'all') {
  const concatRaw = step === 'final' ? path.join(OUT, '_concat_raw.mp4') : concatScenes()
  if (step === 'final' || step === 'all') finalExports(concatRaw)
}
console.log('Build step(s) complete:', step)

// Generates per-scene narration audio + subtitles via edge-tts.
// Run with: npx tsx demo-video/gen-voice.ts   (needs network access to
// speech.platform.bing.com - run with the sandbox disabled).
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VOICE = 'en-US-AriaNeural'
const VO_DIR = path.join(__dirname, 'work/vo')
mkdirSync(VO_DIR, { recursive: true })

type Scene = { num: number; name: string; animated: boolean; text: string }
const scenes: Scene[] = JSON.parse(readFileSync(path.join(__dirname, 'narration.json'), 'utf8'))

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  for (const s of scenes) {
    const nn = String(s.num).padStart(2, '0')
    const mp3 = path.join(VO_DIR, `${nn}.mp3`)
    const srt = path.join(VO_DIR, `${nn}.srt`)
    let lastErr: unknown
    // speech.platform.bing.com occasionally resets the websocket mid-handshake -
    // a transient blip, not a real outage (confirmed in Part 1: works fine with
    // the sandbox disabled, just sometimes needs a retry).
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        console.log(`Scene ${nn}: generating voice (attempt ${attempt})...`)
        execFileSync(
          'python',
          ['-m', 'edge_tts', '--voice', VOICE, '--rate=-5%', '--text', s.text, '--write-media', mp3, '--write-subtitles', srt],
          { stdio: 'inherit' },
        )
        lastErr = undefined
        break
      } catch (err) {
        lastErr = err
        console.log(`Scene ${nn}: attempt ${attempt} failed, retrying...`)
        await sleep(2000)
      }
    }
    if (lastErr) throw lastErr
  }
  console.log('Done.')
}

main()

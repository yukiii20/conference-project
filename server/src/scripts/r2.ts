/**
 * Cloudflare R2 helper (see docs/cloudflare-r2-setup.md).
 *
 *   npm run r2 -- check    Proves the R2_* settings work: upload, read back, delete a test file.
 *   npm run r2 -- upload   Copies every file under the local storage folder (STORAGE_DIR, default
 *                          server/storage) into the bucket. Files already in the bucket are skipped,
 *                          so it is safe to run more than once. Nothing local is deleted.
 *
 * Needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET in server/.env.
 * STORAGE_DRIVER itself can stay 'local' while you run this.
 */
import 'dotenv/config'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { R2Driver, type StorageArea } from '../storage/driver.js'
import { PRIVATE_DIR, PUBLIC_DIR } from '../storage/paths.js'

const REQUIRED = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const

function driverFromEnv(): R2Driver {
  const missing = REQUIRED.filter((k) => !process.env[k])
  if (missing.length) {
    console.error(`Missing in server/.env: ${missing.join(', ')}`)
    process.exit(1)
  }
  return new R2Driver(process.env.R2_ACCOUNT_ID!, process.env.R2_ACCESS_KEY_ID!, process.env.R2_SECRET_ACCESS_KEY!, process.env.R2_BUCKET!)
}

async function check() {
  const r2 = driverFromEnv()
  const key = `_healthcheck/${Date.now()}.txt`
  const body = Buffer.from(`R2 check ${new Date().toISOString()}`)
  process.stdout.write(`Bucket "${process.env.R2_BUCKET}": upload... `)
  await r2.put('private', key, body, 'text/plain')
  process.stdout.write('read... ')
  const back = await r2.get('private', key)
  if (!back || !back.equals(body)) throw new Error('The file read back was different from the one uploaded.')
  process.stdout.write('delete... ')
  await r2.delete('private', key)
  if (await r2.exists('private', key)) throw new Error('The test file was not deleted.')
  console.log('OK. R2 is ready.')
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile()) yield full
  }
}

async function upload() {
  const r2 = driverFromEnv()
  let uploaded = 0
  let skipped = 0
  let failed = 0
  for (const [area, root] of [
    ['public', PUBLIC_DIR],
    ['private', PRIVATE_DIR],
  ] as Array<[StorageArea, string]>) {
    console.log(`\n${area}: ${root}`)
    for await (const full of walk(root)) {
      const key = path.relative(root, full).split(path.sep).join('/')
      try {
        if (await r2.exists(area, key)) {
          skipped++
          continue
        }
        await r2.put(area, key, await readFile(full))
        uploaded++
        console.log(`  + ${key}`)
      } catch (err) {
        failed++
        console.error(`  ! ${key}: ${(err as Error).message}`)
      }
    }
  }
  console.log(`\nDone: ${uploaded} uploaded, ${skipped} already in R2, ${failed} failed.`)
  if (failed) process.exit(1)
}

const command = process.argv[2]
const run = command === 'check' ? check : command === 'upload' ? upload : null
if (!run) {
  console.log('Usage: npm run r2 -- check | upload')
  process.exit(1)
}
run().catch((err) => {
  console.error(`\nFailed: ${(err as Error).message}`)
  process.exit(1)
})

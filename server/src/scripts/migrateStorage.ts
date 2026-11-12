/**
 * Copies a local storage folder (the old server/storage, or a copy of it) into the S3 bucket.
 *
 *   npm run migrate-storage                          dry run: lists what WOULD be copied
 *   npm run migrate-storage -- --apply               really copies
 *   npm run migrate-storage -- --from D:/backup/storage --apply
 *   npm run migrate-storage -- --apply --overwrite   also replaces files already in the bucket
 *
 * The folder must contain `public/` and/or `private/` (the layout the local driver writes).
 * Each file's key in the bucket is its path relative to that area folder - exactly the value
 * the database already stores - so no database change is needed. Nothing local is deleted.
 *
 * Bucket settings come from server/.env: S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID,
 * S3_SECRET_ACCESS_KEY (or the older R2_* set). STORAGE_DRIVER itself can stay 'local'.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { contentTypeFor, S3Driver, s3OptionsFromEnv, type StorageArea, type StorageDriver } from '../storage/driver.js'
import { STORAGE_ROOT } from '../storage/paths.js'

export type MigrateOptions = { from: string; apply: boolean; overwrite: boolean; log?: (line: string) => void }
export type MigrateSummary = { found: number; copied: number; skipped: number; failed: number; wouldCopy: number }

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

/** Core of the script, separated so it can be tested against any driver. */
export async function migrateStorage(target: StorageDriver, options: MigrateOptions): Promise<MigrateSummary> {
  const log = options.log ?? ((line: string) => console.log(line))
  const summary: MigrateSummary = { found: 0, copied: 0, skipped: 0, failed: 0, wouldCopy: 0 }
  for (const area of ['public', 'private'] as StorageArea[]) {
    const root = path.join(options.from, area)
    log(`\n${area}: ${root}`)
    for await (const full of walk(root)) {
      const key = path.relative(root, full).split(path.sep).join('/')
      summary.found++
      try {
        if (!options.overwrite && (await target.exists(area, key))) {
          summary.skipped++
          continue
        }
        if (!options.apply) {
          summary.wouldCopy++
          log(`  would copy ${key} (${(await stat(full)).size} bytes)`)
          continue
        }
        await target.put(area, key, await readFile(full), contentTypeFor(key))
        summary.copied++
        log(`  + ${key}`)
      } catch (err) {
        summary.failed++
        log(`  ! ${key}: ${(err as Error).message}`)
      }
    }
  }
  return summary
}

export function parseArgs(argv: string[]): MigrateOptions {
  const fromIndex = argv.indexOf('--from')
  const from = fromIndex >= 0 && argv[fromIndex + 1] ? path.resolve(argv[fromIndex + 1]!) : STORAGE_ROOT
  return { from, apply: argv.includes('--apply'), overwrite: argv.includes('--overwrite') }
}

export async function main(argv: string[]): Promise<number> {
  const options = parseArgs(argv)
  const s3 = s3OptionsFromEnv(process.env)
  if (!s3) {
    console.error('Bucket settings missing in server/.env: set S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and S3_ENDPOINT (or S3_REGION).')
    return 1
  }
  console.log(`${options.apply ? 'COPYING' : 'DRY RUN (nothing is copied; add --apply to copy)'}`)
  console.log(`from: ${options.from}`)
  console.log(`to:   bucket "${s3.bucket}"${s3.endpoint ? ` at ${s3.endpoint}` : ''}`)
  const summary = await migrateStorage(new S3Driver(s3), options)
  console.log(
    `\nFiles found: ${summary.found}. ` +
      (options.apply ? `Copied: ${summary.copied}. ` : `Would copy: ${summary.wouldCopy}. `) +
      `Already in the bucket (skipped): ${summary.skipped}. Failed: ${summary.failed}.`,
  )
  if (!options.apply && summary.wouldCopy > 0) console.log('Run again with --apply to copy them.')
  return summary.failed > 0 ? 1 : 0
}

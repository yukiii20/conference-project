import { mkdir } from 'node:fs/promises'
import path from 'node:path'

// STORAGE_DIR is the documented, production-facing override (see
// docs/deploy-guide.md) - point it at a Render persistent disk mount (e.g.
// /var/data/storage) so uploads/certificates survive a deploy or restart;
// Render wipes its normal filesystem on both. STORAGE_ROOT is kept only as
// the test suite's own override (tests/setup.ts) to a disposable directory,
// so it's checked second rather than renamed.
export const STORAGE_ROOT = path.resolve(process.cwd(), process.env.STORAGE_DIR || process.env.STORAGE_ROOT || 'storage')
export const PUBLIC_DIR = path.join(STORAGE_ROOT, 'public')
export const PRIVATE_DIR = path.join(STORAGE_ROOT, 'private')

export async function ensureStorageDirs(): Promise<void> {
  await mkdir(PUBLIC_DIR, { recursive: true })
  await mkdir(PRIVATE_DIR, { recursive: true })
}

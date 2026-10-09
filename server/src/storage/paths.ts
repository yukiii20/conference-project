import { mkdir } from 'node:fs/promises'
import path from 'node:path'

// Overridable so tests can point uploads at a disposable directory instead
// of the real server/storage used by the dev server.
export const STORAGE_ROOT = path.resolve(process.cwd(), process.env.STORAGE_ROOT || 'storage')
export const PUBLIC_DIR = path.join(STORAGE_ROOT, 'public')
export const PRIVATE_DIR = path.join(STORAGE_ROOT, 'private')

export async function ensureStorageDirs(): Promise<void> {
  await mkdir(PUBLIC_DIR, { recursive: true })
  await mkdir(PRIVATE_DIR, { recursive: true })
}

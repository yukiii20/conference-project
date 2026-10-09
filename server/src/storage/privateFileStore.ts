import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PRIVATE_DIR } from './paths.js'

/** `${folder}/${kind}-v${version}-${random}.${ext}` — never the original filename, per A3. */
export function buildPrivatePath(folder: string, kind: string, version: number, ext: string): string {
  const random = crypto.randomUUID().slice(0, 8)
  return `${folder}/${kind}-v${version}-${random}.${ext}`
}

export async function savePrivateFile(relativePath: string, buffer: Buffer): Promise<void> {
  const full = path.join(PRIVATE_DIR, relativePath)
  await mkdir(path.dirname(full), { recursive: true })
  await writeFile(full, buffer)
}

export function privateFileAbsolutePath(relativePath: string): string {
  return path.join(PRIVATE_DIR, relativePath)
}

/** Best-effort cleanup — a missing file is not an error here. */
export async function deletePrivateFile(relativePath: string | null | undefined): Promise<void> {
  if (!relativePath) return
  try {
    await unlink(path.join(PRIVATE_DIR, relativePath))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

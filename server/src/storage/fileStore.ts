import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PUBLIC_DIR } from './paths.js'

/** `${folder}/${uuid}.${ext}` — folder is always server-constructed (never from client input). */
export function buildPublicPath(folder: string, ext: string): string {
  return `${folder}/${crypto.randomUUID()}.${ext}`
}

export async function savePublicFile(relativePath: string, buffer: Buffer): Promise<void> {
  const full = path.join(PUBLIC_DIR, relativePath)
  await mkdir(path.dirname(full), { recursive: true })
  await writeFile(full, buffer)
}

/** Best-effort cleanup — a missing file (already deleted, or never existed) is not an error here. */
export async function deletePublicFile(relativePath: string | null | undefined): Promise<void> {
  if (!relativePath) return
  try {
    await unlink(path.join(PUBLIC_DIR, relativePath))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

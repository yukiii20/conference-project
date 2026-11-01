import { storage } from './driver.js'

/** `${folder}/${uuid}.${ext}` — folder is always server-constructed (never from client input). */
export function buildPublicPath(folder: string, ext: string): string {
  return `${folder}/${crypto.randomUUID()}.${ext}`
}

export async function savePublicFile(relativePath: string, buffer: Buffer): Promise<void> {
  await storage().put('public', relativePath, buffer)
}

/** The file's bytes, or null if it doesn't exist (e.g. a logo lost before storage moved to R2). */
export async function readPublicFile(relativePath: string | null | undefined): Promise<Buffer | null> {
  if (!relativePath) return null
  return storage().get('public', relativePath)
}

/** Best-effort cleanup — a missing file (already deleted, or never existed) is not an error here. */
export async function deletePublicFile(relativePath: string | null | undefined): Promise<void> {
  if (!relativePath) return
  await storage().delete('public', relativePath)
}

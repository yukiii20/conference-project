import { storage } from './driver.js'

/** `${folder}/${kind}-v${version}-${random}.${ext}` — never the original filename, per A3. */
export function buildPrivatePath(folder: string, kind: string, version: number, ext: string): string {
  const random = crypto.randomUUID().slice(0, 8)
  return `${folder}/${kind}-v${version}-${random}.${ext}`
}

export async function savePrivateFile(relativePath: string, buffer: Buffer): Promise<void> {
  await storage().put('private', relativePath, buffer)
}

/** Best-effort cleanup — a missing file is not an error here. */
export async function deletePrivateFile(relativePath: string | null | undefined): Promise<void> {
  if (!relativePath) return
  await storage().delete('private', relativePath)
}

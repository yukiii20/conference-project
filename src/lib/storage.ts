import { supabase } from './supabase'

const IMAGE_MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/** File extension for a given image mime type, or null if it's not one of the accepted types. */
export function imageExtension(mimeType: string): string | null {
  return IMAGE_MIME_TO_EXT[mimeType] ?? null
}

export type ImageValidationError = string

/** Checks an image file against the shared png/jpg/webp, size-limit rule. Returns an error message, or null if valid. */
export function validateImageFile(file: File, maxMb: number): ImageValidationError | null {
  const ext = IMAGE_MIME_TO_EXT[file.type]
  if (!ext) {
    return 'Use a PNG, JPG, or WEBP image.'
  }
  if (file.size > maxMb * 1024 * 1024) {
    return `Image must be ${maxMb} MB or smaller.`
  }
  return null
}

/**
 * Uploads an image to the public "public-assets" bucket under the given
 * folder (e.g. `conferences/{id}` or `conferences/{id}/supporters`), with a
 * random filename — never the user's original filename. Returns the storage
 * path to store on the row (not the public URL).
 */
export async function uploadPublicImage(
  file: File,
  folder: string,
  namePrefix = '',
): Promise<{ path: string | null; error: string | null }> {
  const ext = IMAGE_MIME_TO_EXT[file.type]
  if (!ext) {
    return { path: null, error: 'Use a PNG, JPG, or WEBP image.' }
  }

  const path = `${folder}/${namePrefix}${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('public-assets').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type,
  })

  if (error) {
    return { path: null, error: error.message }
  }
  return { path, error: null }
}

export function publicImageUrl(path: string | null): string | null {
  if (!path) return null
  return supabase.storage.from('public-assets').getPublicUrl(path).data.publicUrl
}

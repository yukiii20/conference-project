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

/** Turns a storage path returned by the API into the URL that serves it. */
export function publicImageUrl(path: string | null): string | null {
  if (!path) return null
  return `/files/public/${path}`
}

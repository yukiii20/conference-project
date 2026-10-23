import { decodeQrFromImageData, extractCheckinToken } from './qrDecode'

export const MAX_QR_IMAGE_BYTES = 5 * 1024 * 1024
export const ACCEPTED_QR_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']

export class QrImageError extends Error {}

export function validateQrImageFile(file: File): void {
  if (!ACCEPTED_QR_IMAGE_TYPES.includes(file.type)) {
    throw new QrImageError('Use a PNG, JPG or WEBP image.')
  }
  if (file.size > MAX_QR_IMAGE_BYTES) {
    throw new QrImageError('This image is too large — use one under 5 MB.')
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new QrImageError('Could not read this image file.'))
    img.src = url
  })
}

function renderAttempt(img: HTMLImageElement, scale: number, rotationDeg: 0 | 90 | 180 | 270): ImageData {
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const rotated = rotationDeg === 90 || rotationDeg === 270
  const canvas = document.createElement('canvas')
  canvas.width = rotated ? h : w
  canvas.height = rotated ? w : h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new QrImageError('Could not read this image file.')
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((rotationDeg * Math.PI) / 180)
  ctx.drawImage(img, -w / 2, -h / 2, w, h)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

// The original framing first (cheapest, and right most of the time for the
// app's own "Download QR (PNG)" file), then a couple of scales (a phone
// photo of a printed/on-screen ticket is rarely framed 1:1) and a couple of
// rotations (a sideways phone photo) — "a couple", not an exhaustive sweep,
// per the task's own scope.
const DECODE_ATTEMPTS: Array<{ scale: number; rotation: 0 | 90 | 180 | 270 }> = [
  { scale: 1, rotation: 0 },
  { scale: 1.5, rotation: 0 },
  { scale: 0.75, rotation: 0 },
  { scale: 1, rotation: 90 },
  { scale: 1, rotation: 180 },
  { scale: 1, rotation: 270 },
]

/**
 * Decodes an uploaded/dropped/pasted image into a check-in token, entirely
 * in the browser — the file itself is never sent to the server, only the
 * token this extracts from whatever QR code it finds. Throws QrImageError
 * (safe to show directly to the user) if the file is invalid or no QR code
 * could be found after every attempt.
 */
export async function decodeQrImageFile(file: File): Promise<string> {
  validateQrImageFile(file)
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    for (const { scale, rotation } of DECODE_ATTEMPTS) {
      const imageData = renderAttempt(img, scale, rotation)
      const text = decodeQrFromImageData(imageData.data, imageData.width, imageData.height)
      if (text) return extractCheckinToken(text)
    }
    throw new QrImageError('Could not find a QR code in this image. Try a clearer photo, or use Enter ticket code instead.')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The first image file in a clipboard paste event, if any — used for the Upload tab's Ctrl+V support. */
export function imageFileFromClipboard(e: ClipboardEvent): File | null {
  const items = e.clipboardData?.items
  if (!items) return null
  for (const item of Array.from(items)) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) return file
    }
  }
  return null
}

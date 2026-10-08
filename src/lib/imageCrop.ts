function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read image.'))
    img.src = url
  })
}

/**
 * Centre-crops an image to a square and resizes it to `size`x`size`,
 * re-encoding as JPEG. Re-encoding through canvas also strips the
 * original file's embedded metadata (e.g. phone camera GPS location).
 */
export async function cropToSquareJpeg(file: File, size = 512, quality = 0.85): Promise<File> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await loadImage(objectUrl)
    const side = Math.min(img.width, img.height)
    const sx = (img.width - side) / 2
    const sy = (img.height - side) / 2

    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not process image.')
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process image.'))), 'image/jpeg', quality)
    })

    return new File([blob], 'avatar.jpg', { type: 'image/jpeg' })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

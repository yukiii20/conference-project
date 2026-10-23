import {
  BinaryBitmap,
  ChecksumException,
  FormatException,
  HybridBinarizer,
  NotFoundException,
  QRCodeReader,
  RGBLuminanceSource,
} from '@zxing/library'

/**
 * Same grayscale math as @zxing/browser's HTMLCanvasElementLuminanceSource
 * (see node_modules/@zxing/browser/.../HTMLCanvasElementLuminanceSource.js) —
 * duplicated here rather than imported because that class is hard-wired to a
 * live HTMLCanvasElement, while this needs to run on any RGBA buffer
 * (canvas ImageData in the browser, a decoded PNG in a Node test). Keeping
 * the exact same weights means a result decoded here matches what the
 * camera-scanning path (which does use @zxing/browser) would have decoded.
 */
function toGrayscale(rgba: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(width * height)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    const alpha = rgba[i + 3]!
    if (alpha === 0) {
      gray[j] = 0xff
      continue
    }
    const r = rgba[i]!
    const g = rgba[i + 1]!
    const b = rgba[i + 2]!
    gray[j] = (306 * r + 601 * g + 117 * b + 0x200) >> 10
  }
  return gray
}

/**
 * Decodes a QR code from a plain RGBA pixel buffer (`width * height * 4`
 * bytes, same layout as canvas `ImageData.data` or a decoded PNG). Pure and
 * platform-independent on purpose — no DOM, no file I/O — so it can run
 * identically in the browser (fed from a `<canvas>`) and in a Vitest unit
 * test (fed from a PNG decoded with `pngjs`), see `qrDecode.test.ts`.
 * Returns null if no QR code was found (never throws for that — only a
 * genuinely unexpected decoder error propagates).
 */
export function decodeQrFromImageData(rgba: Uint8ClampedArray, width: number, height: number): string | null {
  const gray = toGrayscale(rgba, width, height)
  const source = new RGBLuminanceSource(gray, width, height)
  const bitmap = new BinaryBitmap(new HybridBinarizer(source))
  try {
    return new QRCodeReader().decode(bitmap).getText()
  } catch (err) {
    if (err instanceof NotFoundException || err instanceof FormatException || err instanceof ChecksumException) return null
    throw err
  }
}

/**
 * The check-in QR encodes a full URL (`${APP_URL}/checkin/<token>`, see
 * server's registration/routes.ts `my-registration/qr.png`) so that
 * scanning it with an ordinary phone camera app also works (opens a page,
 * not just raw text) — extract just the token for the check-in API calls.
 * Falls back to the raw decoded text for anything that isn't that shape,
 * so a plain token-only QR (e.g. hand-typed into a QR generator for
 * testing) still works.
 */
export function extractCheckinToken(decodedText: string): string {
  const match = decodedText.match(/\/checkin\/([A-Za-z0-9_-]+)$/)
  return match ? match[1]! : decodedText.trim()
}

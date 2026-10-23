import { describe, expect, it } from 'vitest'
import QRCode from 'qrcode'
import { PNG } from 'pngjs'
import { decodeQrFromImageData, extractCheckinToken } from './qrDecode'

/** Generates a real QR PNG (same library the server uses — qrcode) and decodes it back to raw RGBA with pngjs, the same shape a browser's canvas `getImageData()` returns. No DOM involved. */
async function generateQrImageData(text: string): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const buffer = await QRCode.toBuffer(text, { type: 'png', width: 300, margin: 2 })
  const png = PNG.sync.read(buffer)
  return { data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength), width: png.width, height: png.height }
}

describe('decodeQrFromImageData', () => {
  it('decodes a plain-text QR code back to its original text', async () => {
    const { data, width, height } = await generateQrImageData('hello-checkin-world')
    expect(decodeQrFromImageData(data, width, height)).toBe('hello-checkin-world')
  })

  it('decodes a check-in URL QR code (the real shape the app generates)', async () => {
    const url = 'https://example.com/checkin/AbCd1234_-token'
    const { data, width, height } = await generateQrImageData(url)
    expect(decodeQrFromImageData(data, width, height)).toBe(url)
  })

  it('returns null for an image with no QR code, instead of throwing', () => {
    const width = 100
    const height = 100
    const blank = new Uint8ClampedArray(width * height * 4).fill(255) // solid white
    expect(decodeQrFromImageData(blank, width, height)).toBeNull()
  })
})

describe('extractCheckinToken', () => {
  it('pulls the token out of a /checkin/<token> URL', () => {
    expect(extractCheckinToken('https://example.com/checkin/AbCd1234_-token')).toBe('AbCd1234_-token')
  })

  it('falls back to the raw trimmed text for anything that is not that URL shape', () => {
    expect(extractCheckinToken('  raw-token-value  ')).toBe('raw-token-value')
  })

  it('round-trips through a real generated QR code end to end', async () => {
    const url = 'https://example.com/checkin/zyx987'
    const { data, width, height } = await generateQrImageData(url)
    const decoded = decodeQrFromImageData(data, width, height)
    expect(decoded).not.toBeNull()
    expect(extractCheckinToken(decoded!)).toBe('zyx987')
  })
})

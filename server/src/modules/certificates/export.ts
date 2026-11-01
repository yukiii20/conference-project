import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { env } from '../../config/env.js'

const DEFAULT_ACCENT = '#B8913A'
const DEFAULT_TITLE = '#1F2328'
const DEFAULT_TEXT = '#5B6168'
const DEFAULT_PAPER = '#FFFDF8'
const INK = '#1F2328'

const CERTIFICATE_TYPE_WORDING: Record<string, string> = {
  participation: 'has participated in',
  presentation: 'has presented a paper at',
  speaker: 'has delivered an invited talk at',
  reviewer: 'has served as a reviewer for',
  session_chair: 'has chaired a session at',
  staff: 'has served as organising staff for',
  best_paper: 'has received the Best Paper Award at',
}

/** The line under the title. */
const CERTIFICATE_TYPE_SUBTITLE: Record<string, string> = {
  participation: 'of Participation',
  presentation: 'of Presentation',
  speaker: 'of Appreciation',
  reviewer: 'of Appreciation',
  session_chair: 'of Appreciation',
  staff: 'of Appreciation',
  best_paper: 'of Excellence',
}

/**
 * Everything a convenor can change on a certificate. Only `name` is required; every other field
 * is optional and falls back to the default design, so templates saved before these options
 * existed render exactly as before. Texts may use {conference} and {name} placeholders.
 */
export type CertificateLayout = {
  name: { y: number; font_size: number; color: string }
  texts?: {
    header?: string
    title?: string
    subtitle?: string
    intro?: string
    wording?: string
    event?: string
    seal?: string
  }
  colors?: { frame?: string; accent?: string; title?: string; text?: string; background?: string }
  show?: {
    logo?: boolean
    frame?: boolean
    header?: boolean
    subtitle?: boolean
    intro?: boolean
    seal?: boolean
    number?: boolean
    issued?: boolean
    qr?: boolean
  }
  font?: 'serif' | 'sans'
}
export type CertificateSignatory = { name: string; title: string; signature_path: string | null }

export type CertificateData = {
  recipientName: string
  conferenceName: string
  certificateType: string
  certificateNumber: string
  issuedAt: Date
  verificationToken: string
  backgroundBuffer: Buffer | null
  logoBuffer: Buffer | null
  primaryColor: string
  layout: CertificateLayout
  signatories: CertificateSignatory[]
  signatureBuffers: Array<Buffer | null>
}

type Doc = InstanceType<typeof PDFDocument>

/** Default wording for each text slot, for the editor's placeholders. */
export function defaultCertificateTexts(certificateType: string) {
  return {
    header: '{conference}',
    title: 'CERTIFICATE',
    subtitle: CERTIFICATE_TYPE_SUBTITLE[certificateType] ?? 'of Recognition',
    intro: 'This is to certify that',
    wording: CERTIFICATE_TYPE_WORDING[certificateType] ?? 'is recognised at',
    event: '{conference}',
  }
}

function isHex(value: string | undefined | null): value is string {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value)
}

/** Seal text: an acronym in brackets ("... 2026 (NITC)" -> "NITC"), else up to three initials. */
function initials(name: string): string {
  const acronym = name.match(/\(([A-Za-z]{2,5})\)/)
  if (acronym) return acronym[1]!.toUpperCase()
  const skip = new Set(['of', 'and', 'the', 'on', 'for', 'in', 'at', '&'])
  const letters = name
    .split(/\s+/)
    .filter((w) => w && !skip.has(w.toLowerCase()) && /^[A-Za-z]/.test(w))
    .map((w) => w[0]!.toUpperCase())
  return letters.slice(0, 3).join('') || 'C'
}

function formatIssued(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** Lighter tint of a hex colour (mix with white). */
function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const mix = (c: number) => Math.round(c + (255 - c) * amount)
  const r = mix((n >> 16) & 255)
  const g = mix((n >> 8) & 255)
  const b = mix(n & 255)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

/** Small diamond ornament centred on (x, y). */
function diamond(doc: Doc, x: number, y: number, r: number, color: string) {
  doc.moveTo(x, y - r).lineTo(x + r, y).lineTo(x, y + r).lineTo(x - r, y).closePath().fill(color)
}

/** A short rule with a diamond in the middle, centred on x. */
function ornamentRule(doc: Doc, x: number, y: number, halfWidth: number, color: string) {
  doc.lineWidth(0.8).strokeColor(color)
  doc.moveTo(x - halfWidth, y).lineTo(x - 8, y).stroke()
  doc.moveTo(x + 8, y).lineTo(x + halfWidth, y).stroke()
  diamond(doc, x, y, 3.2, color)
}

/** Rosette seal with short text in the middle. */
function seal(doc: Doc, cx: number, cy: number, text: string, color: string, boldFont: string) {
  const outer = 36
  const inner = 32
  const points = 36
  for (let i = 0; i <= points * 2; i++) {
    const angle = (Math.PI * i) / points
    const r = i % 2 === 0 ? outer : inner
    const px = cx + r * Math.cos(angle)
    const py = cy + r * Math.sin(angle)
    if (i === 0) doc.moveTo(px, py)
    else doc.lineTo(px, py)
  }
  doc.closePath().fill(color)
  doc.circle(cx, cy, 27).fill(tint(color, 0.35))
  doc.circle(cx, cy, 25).lineWidth(0.8).strokeColor('#FFFFFF').stroke()
  doc.circle(cx, cy, 21).lineWidth(0.5).strokeColor('#FFFFFF').stroke()
  const label = text.slice(0, 6)
  const size = label.length >= 5 ? 9 : label.length === 4 ? 11 : label.length === 3 ? 13 : 16
  doc
    .font(boldFont)
    .fontSize(size)
    .fillColor('#FFFFFF')
    .text(label, cx - 22, cy - size * 0.42, { width: 44, align: 'center', lineBreak: false })
}

/** Largest font size (from `size` down to `min`) at which `text` fits in `maxWidth` on one line. */
function fitSize(doc: Doc, font: string, text: string, size: number, min: number, maxWidth: number, characterSpacing = 0): number {
  doc.font(font)
  let s = size
  while (s > min && doc.fontSize(s).widthOfString(text, { characterSpacing }) > maxWidth) s -= 1
  return s
}

/** A4 landscape certificate PDF, collected into a Buffer (not streamed — the caller saves it to disk). */
export async function generateCertificatePdf(data: CertificateData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 })
  const chunks: Buffer[] = []
  doc.on('data', (chunk) => chunks.push(chunk))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  const { width, height } = doc.page
  const cx = width / 2
  const layout = data.layout
  const show = { logo: true, frame: true, header: true, subtitle: true, intro: true, seal: true, number: true, issued: true, qr: true, ...layout.show }
  const colors = layout.colors ?? {}
  const frameColor = isHex(colors.frame) ? colors.frame : isHex(data.primaryColor) ? data.primaryColor : '#1E3A5F'
  const accent = isHex(colors.accent) ? colors.accent : DEFAULT_ACCENT
  const titleColor = isHex(colors.title) ? colors.title : DEFAULT_TITLE
  const textColor = isHex(colors.text) ? colors.text : DEFAULT_TEXT
  const paper = isHex(colors.background) ? colors.background : DEFAULT_PAPER

  const sans = layout.font === 'sans'
  const F = {
    regular: sans ? 'Helvetica' : 'Times-Roman',
    bold: sans ? 'Helvetica-Bold' : 'Times-Bold',
    italic: sans ? 'Helvetica-Oblique' : 'Times-Italic',
    name: sans ? 'Helvetica-Bold' : 'Times-BoldItalic',
  }

  const defaults = defaultCertificateTexts(data.certificateType)
  const fill = (value: string) => value.replaceAll('{conference}', data.conferenceName).replaceAll('{name}', data.recipientName)
  const text = (key: keyof typeof defaults) => {
    const custom = layout.texts?.[key]?.trim()
    return fill(custom ? custom : defaults[key])
  }

  // ---------------------------------------------------------------- background + frame
  if (data.backgroundBuffer) {
    doc.image(data.backgroundBuffer, 0, 0, { width, height })
  } else {
    doc.rect(0, 0, width, height).fill(paper)
  }
  if (show.frame) {
    doc.lineWidth(10).strokeColor(frameColor).rect(20, 20, width - 40, height - 40).stroke()
    doc.lineWidth(1.2).strokeColor(accent).rect(34, 34, width - 68, height - 68).stroke()
    doc.lineWidth(0.5).strokeColor(accent).rect(39, 39, width - 78, height - 78).stroke()
    for (const [x, y] of [
      [36.5, 36.5],
      [width - 36.5, 36.5],
      [36.5, height - 36.5],
      [width - 36.5, height - 36.5],
    ] as const) {
      diamond(doc, x, y, 6, accent)
    }
  }

  // ---------------------------------------------------------------- header
  let y = 62
  if (show.logo && data.logoBuffer) {
    doc.image(data.logoBuffer, cx - 80, y, { fit: [160, 56], align: 'center', valign: 'center' })
    y += 66
  } else {
    y = 104
  }

  if (show.header) {
    doc
      .font(sans ? 'Helvetica-Bold' : 'Helvetica-Bold')
      .fontSize(9)
      .fillColor(frameColor)
      .text(text('header').toUpperCase(), 90, y, { width: width - 180, align: 'center', characterSpacing: 1.6, lineBreak: false, ellipsis: true })
  }

  const title = text('title')
  const titleSize = fitSize(doc, F.bold, title, 40, 18, width - 200, 7)
  doc
    .font(F.bold)
    .fontSize(titleSize)
    .fillColor(titleColor)
    .text(title, 100, y + 20 + (40 - titleSize) * 0.5, { width: width - 200, align: 'center', characterSpacing: 7, lineBreak: false })

  const subY = y + 72
  if (show.subtitle) {
    const subtitle = text('subtitle').toUpperCase()
    doc.font('Helvetica').fontSize(10.5)
    const subWidth = Math.min(doc.widthOfString(subtitle, { characterSpacing: 4 }), width - 360)
    doc.fillColor(accent).text(subtitle, 180, subY, { width: width - 360, align: 'center', characterSpacing: 4, lineBreak: false, ellipsis: true })
    doc.lineWidth(0.8).strokeColor(accent)
    doc.moveTo(cx - subWidth / 2 - 70, subY + 5).lineTo(cx - subWidth / 2 - 16, subY + 5).stroke()
    doc.moveTo(cx + subWidth / 2 + 16, subY + 5).lineTo(cx + subWidth / 2 + 70, subY + 5).stroke()
  }

  // ---------------------------------------------------------------- recipient
  const nameY = Math.max(layout.name.y, subY + 52)
  if (show.intro) {
    doc
      .font(F.italic)
      .fontSize(13)
      .fillColor(textColor)
      .text(text('intro'), 110, nameY - 28, { width: width - 220, align: 'center', lineBreak: false, ellipsis: true })
  }

  const nameSize = fitSize(doc, F.name, data.recipientName, layout.name.font_size, 20, width - 220)
  doc
    .font(F.name)
    .fontSize(nameSize)
    .fillColor(isHex(layout.name.color) ? layout.name.color : INK)
    .text(data.recipientName, 110, nameY, { width: width - 220, align: 'center', lineBreak: false, ellipsis: true })

  const ruleY = nameY + nameSize * 1.12 + 6
  ornamentRule(doc, cx, ruleY, 190, accent)

  doc
    .font(F.regular)
    .fontSize(13.5)
    .fillColor(textColor)
    .text(text('wording'), 120, ruleY + 14, { width: width - 240, align: 'center', lineBreak: false, ellipsis: true })
  doc
    .font(F.bold)
    .fontSize(16)
    .fillColor(frameColor)
    .text(text('event'), 120, ruleY + 34, { width: width - 240, align: 'center', lineGap: 2, height: 42, ellipsis: true })

  // ---------------------------------------------------------------- signatures + seal
  const sigLineY = height - 118
  const blockWidth = 170
  const signatories = data.signatories.filter((s) => s.name.trim() || s.title.trim()).slice(0, 2)
  let sigCentres: number[]
  let sealX: number
  if (signatories.length === 2) {
    sigCentres = show.seal ? [cx - 180, cx + 180] : [cx - 150, cx + 150]
    sealX = cx
  } else if (signatories.length === 1) {
    sigCentres = show.seal ? [cx + 95] : [cx]
    sealX = cx - 125
  } else {
    sigCentres = []
    sealX = cx
  }

  signatories.forEach((sig, i) => {
    const centre = sigCentres[i]!
    const x = centre - blockWidth / 2
    const sigBuffer = data.signatureBuffers[data.signatories.indexOf(sig)]
    if (sigBuffer) {
      doc.image(sigBuffer, centre - 60, sigLineY - 44, { fit: [120, 40], align: 'center', valign: 'bottom' })
    }
    doc.moveTo(x, sigLineY).lineTo(x + blockWidth, sigLineY).lineWidth(0.8).strokeColor(INK).stroke()
    doc
      .font(F.bold)
      .fontSize(12)
      .fillColor(INK)
      .text(sig.name, x - 10, sigLineY + 7, { width: blockWidth + 20, align: 'center', lineBreak: false, ellipsis: true })
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(textColor)
      .text(sig.title, x - 10, sigLineY + 23, { width: blockWidth + 20, align: 'center', lineBreak: false, ellipsis: true })
  })

  if (show.seal) {
    const sealText = layout.texts?.seal?.trim() || initials(data.conferenceName)
    seal(doc, sealX, sigLineY - 6, sealText.toUpperCase(), accent, F.bold)
  }

  // ---------------------------------------------------------------- footer: number, date, QR
  const footerX = 64
  const footerBottom = height - 60
  if (show.number) {
    doc.font('Helvetica').fontSize(7.5).fillColor(textColor)
    doc.text('CERTIFICATE NO.', footerX, footerBottom - 34, { characterSpacing: 0.8, lineBreak: false })
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(data.certificateNumber, footerX, footerBottom - 24, { lineBreak: false })
  }
  if (show.issued) {
    doc.font('Helvetica').fontSize(7.5).fillColor(textColor).text(`Issued ${formatIssued(data.issuedAt)}`, footerX, footerBottom - 10, { lineBreak: false })
  }

  if (show.qr) {
    const qrSize = 58
    const qrX = width - 64 - qrSize
    const qrY = footerBottom - qrSize - 4
    const qrBuffer = await QRCode.toBuffer(`${env.APP_URL}/verify/${data.verificationToken}`, {
      type: 'png',
      width: 240,
      margin: 0,
      color: { dark: INK, light: '#FFFFFF' },
    })
    doc.rect(qrX - 4, qrY - 4, qrSize + 8, qrSize + 8).fill('#FFFFFF')
    doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize })
    doc
      .font('Helvetica')
      .fontSize(6.5)
      .fillColor(textColor)
      .text('SCAN TO VERIFY', qrX - 20, qrY + qrSize + 6, { width: qrSize + 40, align: 'center', characterSpacing: 0.8, lineBreak: false })
  }

  doc.end()
  return done
}

import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { env } from '../../config/env.js'

const GOLD = '#B8913A'
const GOLD_LIGHT = '#D9BF7F'
const INK = '#1F2328'
const MUTED = '#5B6168'
const PAPER = '#FFFDF8'

const CERTIFICATE_TYPE_WORDING: Record<string, string> = {
  participation: 'has participated in',
  presentation: 'has presented a paper at',
  speaker: 'has delivered an invited talk at',
  reviewer: 'has served as a reviewer for',
  session_chair: 'has chaired a session at',
  staff: 'has served as organising staff for',
  best_paper: 'has received the Best Paper Award at',
}

/** The line under "CERTIFICATE". */
const CERTIFICATE_TYPE_TITLE: Record<string, string> = {
  participation: 'of Participation',
  presentation: 'of Presentation',
  speaker: 'of Appreciation',
  reviewer: 'of Appreciation',
  session_chair: 'of Appreciation',
  staff: 'of Appreciation',
  best_paper: 'of Excellence',
}

export type CertificateLayout = { name: { y: number; font_size: number; color: string } }
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

function isHex(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(value)
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

/** Small gold diamond ornament centred on (x, y). */
function diamond(doc: Doc, x: number, y: number, r: number) {
  doc.moveTo(x, y - r).lineTo(x + r, y).lineTo(x, y + r).lineTo(x - r, y).closePath().fill(GOLD)
}

/** A short gold rule with a diamond in the middle, centred on x. */
function ornamentRule(doc: Doc, x: number, y: number, halfWidth: number) {
  doc.lineWidth(0.8).strokeColor(GOLD)
  doc.moveTo(x - halfWidth, y).lineTo(x - 8, y).stroke()
  doc.moveTo(x + 8, y).lineTo(x + halfWidth, y).stroke()
  diamond(doc, x, y, 3.2)
}

/** Gold rosette seal with the conference initials. */
function seal(doc: Doc, cx: number, cy: number, text: string) {
  const outer = 36
  const inner = 32
  const points = 36
  // Serrated edge.
  for (let i = 0; i <= points * 2; i++) {
    const angle = (Math.PI * i) / points
    const r = i % 2 === 0 ? outer : inner
    const px = cx + r * Math.cos(angle)
    const py = cy + r * Math.sin(angle)
    if (i === 0) doc.moveTo(px, py)
    else doc.lineTo(px, py)
  }
  doc.closePath().fill(GOLD)
  doc.circle(cx, cy, 27).fill(GOLD_LIGHT)
  doc.circle(cx, cy, 25).lineWidth(0.8).strokeColor('#FFFFFF').stroke()
  doc.circle(cx, cy, 21).lineWidth(0.5).strokeColor('#FFFFFF').stroke()
  const size = text.length >= 4 ? 11 : text.length === 3 ? 13 : 16
  doc
    .font('Times-Bold')
    .fontSize(size)
    .fillColor('#FFFFFF')
    .text(text, cx - 21, cy - size * 0.42, { width: 42, align: 'center', lineBreak: false })
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
  const primary = isHex(data.primaryColor) ? data.primaryColor : '#1E3A5F'

  // ---------------------------------------------------------------- background + frame
  if (data.backgroundBuffer) {
    doc.image(data.backgroundBuffer, 0, 0, { width, height })
  } else {
    doc.rect(0, 0, width, height).fill(PAPER)
    // Outer band in the conference colour.
    doc.lineWidth(10).strokeColor(primary).rect(20, 20, width - 40, height - 40).stroke()
    // Double gold rule inside it.
    doc.lineWidth(1.2).strokeColor(GOLD).rect(34, 34, width - 68, height - 68).stroke()
    doc.lineWidth(0.5).strokeColor(GOLD).rect(39, 39, width - 78, height - 78).stroke()
    // Diamond ornaments on the corners of the inner rule.
    for (const [x, y] of [
      [36.5, 36.5],
      [width - 36.5, 36.5],
      [36.5, height - 36.5],
      [width - 36.5, height - 36.5],
    ] as const) {
      diamond(doc, x, y, 6)
    }
  }

  // ---------------------------------------------------------------- header
  let y = 62
  if (data.logoBuffer) {
    doc.image(data.logoBuffer, cx - 80, y, { fit: [160, 56], align: 'center', valign: 'center' })
    y += 66
  } else {
    y = 104
  }

  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(primary)
    .text(data.conferenceName.toUpperCase(), 90, y, { width: width - 180, align: 'center', characterSpacing: 1.6, lineBreak: false, ellipsis: true })

  doc
    .font('Times-Bold')
    .fontSize(40)
    .fillColor(INK)
    .text('CERTIFICATE', 0, y + 20, { width, align: 'center', characterSpacing: 7 })

  const subtitle = (CERTIFICATE_TYPE_TITLE[data.certificateType] ?? 'of Recognition').toUpperCase()
  doc.font('Helvetica').fontSize(10.5)
  const subWidth = doc.widthOfString(subtitle, { characterSpacing: 4 })
  const subY = y + 72
  doc.fillColor(GOLD).text(subtitle, 0, subY, { width, align: 'center', characterSpacing: 4 })
  doc.lineWidth(0.8).strokeColor(GOLD)
  doc.moveTo(cx - subWidth / 2 - 70, subY + 5).lineTo(cx - subWidth / 2 - 16, subY + 5).stroke()
  doc.moveTo(cx + subWidth / 2 + 16, subY + 5).lineTo(cx + subWidth / 2 + 70, subY + 5).stroke()

  // ---------------------------------------------------------------- recipient
  const nameY = Math.max(data.layout.name.y, subY + 52)
  doc
    .font('Times-Italic')
    .fontSize(13)
    .fillColor(MUTED)
    .text('This is to certify that', 0, nameY - 28, { width, align: 'center' })

  // Shrink long names so they always stay on one line inside the frame.
  let nameSize = data.layout.name.font_size
  doc.font('Times-BoldItalic')
  while (nameSize > 20 && doc.fontSize(nameSize).widthOfString(data.recipientName) > width - 220) nameSize -= 2
  doc
    .fontSize(nameSize)
    .fillColor(isHex(data.layout.name.color) ? data.layout.name.color : INK)
    .text(data.recipientName, 110, nameY, { width: width - 220, align: 'center', lineBreak: false, ellipsis: true })

  const ruleY = nameY + nameSize * 1.12 + 6
  ornamentRule(doc, cx, ruleY, 190)

  const wording = CERTIFICATE_TYPE_WORDING[data.certificateType] ?? 'is recognised at'
  doc
    .font('Times-Roman')
    .fontSize(13.5)
    .fillColor(MUTED)
    .text(wording, 0, ruleY + 14, { width, align: 'center' })
  doc
    .font('Times-Bold')
    .fontSize(16)
    .fillColor(primary)
    .text(data.conferenceName, 120, ruleY + 34, { width: width - 240, align: 'center', lineGap: 2 })

  // ---------------------------------------------------------------- signatures + seal
  const sigLineY = height - 118
  const blockWidth = 170
  const signatories = data.signatories.slice(0, 2)
  let sigCentres: number[]
  let sealX: number
  if (signatories.length === 2) {
    sigCentres = [cx - 180, cx + 180]
    sealX = cx
  } else if (signatories.length === 1) {
    sigCentres = [cx + 95]
    sealX = cx - 125
  } else {
    sigCentres = []
    sealX = cx
  }

  signatories.forEach((sig, i) => {
    const centre = sigCentres[i]!
    const x = centre - blockWidth / 2
    const sigBuffer = data.signatureBuffers[i]
    if (sigBuffer) {
      doc.image(sigBuffer, centre - 60, sigLineY - 44, { fit: [120, 40], align: 'center', valign: 'bottom' })
    }
    doc.moveTo(x, sigLineY).lineTo(x + blockWidth, sigLineY).lineWidth(0.8).strokeColor(INK).stroke()
    doc
      .font('Times-Bold')
      .fontSize(12)
      .fillColor(INK)
      .text(sig.name, x - 10, sigLineY + 7, { width: blockWidth + 20, align: 'center', lineBreak: false, ellipsis: true })
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(sig.title, x - 10, sigLineY + 23, { width: blockWidth + 20, align: 'center', lineBreak: false, ellipsis: true })
  })

  seal(doc, sealX, sigLineY - 6, initials(data.conferenceName))

  // ---------------------------------------------------------------- footer: number, date, QR
  const footerX = 64
  const footerBottom = height - 60
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
  doc.text('CERTIFICATE NO.', footerX, footerBottom - 34, { characterSpacing: 0.8, lineBreak: false })
  doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(data.certificateNumber, footerX, footerBottom - 24, { lineBreak: false })
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(`Issued ${formatIssued(data.issuedAt)}`, footerX, footerBottom - 10, { lineBreak: false })

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
    .fillColor(MUTED)
    .text('SCAN TO VERIFY', qrX - 20, qrY + qrSize + 6, { width: qrSize + 40, align: 'center', characterSpacing: 0.8, lineBreak: false })

  doc.end()
  return done
}

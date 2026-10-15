import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { env } from '../../config/env.js'

const GOLD = '#C9A24A'

const CERTIFICATE_TYPE_WORDING: Record<string, string> = {
  participation: 'has participated in',
  presentation: 'has presented a paper at',
  speaker: 'has delivered an invited talk at',
  reviewer: 'has served as a reviewer for',
  session_chair: 'has chaired a session at',
  staff: 'has served as organising staff for',
  best_paper: 'has received the Best Paper Award at',
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
  const primary = data.primaryColor

  if (data.backgroundBuffer) {
    doc.image(data.backgroundBuffer, 0, 0, { width, height })
  }

  // Double border: primary colour outer, gold inner.
  doc.lineWidth(6).strokeColor(primary).rect(24, 24, width - 48, height - 48).stroke()
  doc.lineWidth(2).strokeColor(GOLD).rect(40, 40, width - 80, height - 80).stroke()

  // Corner accents.
  const accent = 26
  doc.lineWidth(3).strokeColor(GOLD)
  for (const [cx, cy, dx, dy] of [
    [52, 52, 1, 1],
    [width - 52, 52, -1, 1],
    [52, height - 52, 1, -1],
    [width - 52, height - 52, -1, -1],
  ] as const) {
    doc
      .moveTo(cx, cy + accent * dy)
      .lineTo(cx, cy)
      .lineTo(cx + accent * dx, cy)
      .stroke()
  }

  if (data.logoBuffer) {
    doc.image(data.logoBuffer, width / 2 - 30, 64, { fit: [60, 60] })
  }

  doc
    .font('Times-Bold')
    .fontSize(30)
    .fillColor(primary)
    .text('Certificate', 0, 140, { align: 'center', width })
  doc
    .font('Times-Roman')
    .fontSize(14)
    .fillColor('#444')
    .text('of ' + (CERTIFICATE_TYPE_WORDING[data.certificateType] ? data.certificateType.replace('_', ' ') : 'Recognition'), 0, 182, {
      align: 'center',
      width,
    })

  doc
    .font('Times-Italic')
    .fontSize(data.layout.name.font_size)
    .fillColor(data.layout.name.color)
    .text(data.recipientName, 0, data.layout.name.y, { align: 'center', width })

  const wording = CERTIFICATE_TYPE_WORDING[data.certificateType] ?? 'is recognised at'
  doc
    .font('Times-Roman')
    .fontSize(13)
    .fillColor('#333')
    .text(`${wording} ${data.conferenceName}`, 80, data.layout.name.y + data.layout.name.font_size + 16, {
      align: 'center',
      width: width - 160,
    })

  // Signature blocks with a gold seal between them.
  const sigY = height - 150
  const blockWidth = 200
  const positions = data.signatories.length === 2 ? [width / 2 - 260, width / 2 + 60] : [width / 2 - 100]
  data.signatories.slice(0, 2).forEach((sig, i) => {
    const x = positions[i] ?? width / 2 - 100
    const sigBuffer = data.signatureBuffers[i]
    if (sigBuffer) {
      doc.image(sigBuffer, x + blockWidth / 2 - 40, sigY - 40, { fit: [80, 36] })
    }
    doc.moveTo(x, sigY).lineTo(x + blockWidth, sigY).lineWidth(1).strokeColor('#999').stroke()
    doc.font('Times-Bold').fontSize(11).fillColor('#222').text(sig.name, x, sigY + 6, { width: blockWidth, align: 'center' })
    doc.font('Times-Roman').fontSize(9).fillColor('#666').text(sig.title, x, sigY + 20, { width: blockWidth, align: 'center' })
  })

  doc
    .circle(width / 2, sigY - 20, 24)
    .lineWidth(2)
    .strokeColor(GOLD)
    .stroke()
  doc.font('Times-Bold').fontSize(8).fillColor(GOLD).text('SEAL', width / 2 - 24, sigY - 24, { width: 48, align: 'center' })

  doc
    .font('Times-Roman')
    .fontSize(9)
    .fillColor('#555')
    .text(`Certificate No: ${data.certificateNumber}`, 60, height - 56)
  doc.text(`Issued: ${data.issuedAt.toISOString().slice(0, 10)}`, 60, height - 42)

  const qrBuffer = await QRCode.toBuffer(`${env.APP_URL}/verify/${data.verificationToken}`, { type: 'png', width: 80, margin: 1 })
  doc.image(qrBuffer, width - 130, height - 110, { fit: [70, 70] })

  doc.end()
  return done
}

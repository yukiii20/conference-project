import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { env } from '../../config/env.js'

export type BadgeRoleLabel = 'Author' | 'Reviewer' | 'Staff' | 'Speaker' | 'Attendee'

const ROLE_BAND_COLORS: Record<BadgeRoleLabel, string> = {
  Speaker: '#B8860B',
  Author: '#2747A0',
  Reviewer: '#6B4FA0',
  Staff: '#555555',
  Attendee: '#2E8B57',
}

export type BadgePerson = {
  fullName: string
  affiliation: string | null
  roleLabel: BadgeRoleLabel
  qrToken: string
}

export type BadgeConference = {
  shortName: string
  primaryColor: string
  logoBuffer: Buffer | null
}

const PAGE_MARGIN = 24
const GUTTER = 10
const COLS = 2
const ROWS = 4

/** Shrinks the font as the name gets longer, so a long name never overflows its badge (pdfkit has no CSS-style auto-shrink, so this does it by character count instead of measuring). */
function nameFontSize(name: string): number {
  if (name.length <= 18) return 15
  if (name.length <= 26) return 13
  if (name.length <= 34) return 11
  return 9.5
}

function drawCutMarks(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number): void {
  doc.save().dash(3, { space: 3 }).lineWidth(0.75).strokeColor('#AAAAAA').rect(x, y, w, h).stroke().undash().restore()
}

function drawBadge(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  conference: BadgeConference,
  person: BadgePerson,
  qrBuffer: Buffer,
): void {
  drawCutMarks(doc, x, y, w, h)
  const pad = 10

  // Header: logo + conference short name, in the conference colour.
  let headerX = x + pad
  if (conference.logoBuffer) {
    doc.image(conference.logoBuffer, headerX, y + pad - 2, { fit: [20, 20] })
    headerX += 26
  }
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(conference.primaryColor)
    .text(conference.shortName, headerX, y + pad, { width: x + w - pad - headerX, ellipsis: true })

  // Role band.
  const bandY = y + pad + 22
  const bandColor = ROLE_BAND_COLORS[person.roleLabel]
  doc.roundedRect(x + pad, bandY, 70, 16, 3).fill(bandColor)
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF').text(person.roleLabel.toUpperCase(), x + pad, bandY + 4, { width: 70, align: 'center' })

  // Name + affiliation (left column), QR (right).
  const qrSize = Math.min(h - pad * 2 - 44, 70)
  const textWidth = w - pad * 2 - qrSize - 10
  doc
    .font('Helvetica-Bold')
    .fontSize(nameFontSize(person.fullName))
    .fillColor('#1A1A1A')
    .text(person.fullName, x + pad, bandY + 26, { width: textWidth })
  if (person.affiliation) {
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor('#555555')
      .text(person.affiliation, x + pad, y + h - pad - 22, { width: textWidth, ellipsis: true })
  }

  doc.image(qrBuffer, x + w - pad - qrSize, y + h - pad - qrSize, { width: qrSize, height: qrSize })
}

async function qrFor(qrToken: string): Promise<Buffer> {
  return QRCode.toBuffer(`${env.APP_URL}/checkin/${qrToken}`, { type: 'png', width: 200, margin: 1 })
}

/** A4 sheet of up to 8 badges (2 x 4), each ~90 x 60mm with cut marks. */
export async function generateBadgeSheetPdf(conference: BadgeConference, people: BadgePerson[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 0 })
  const chunks: Buffer[] = []
  doc.on('data', (chunk) => chunks.push(chunk))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  const { width, height } = doc.page
  const cellW = (width - PAGE_MARGIN * 2 - GUTTER * (COLS - 1)) / COLS
  const cellH = (height - PAGE_MARGIN * 2 - GUTTER * (ROWS - 1)) / ROWS
  const perPage = COLS * ROWS

  const qrBuffers = await Promise.all(people.map((p) => qrFor(p.qrToken)))

  for (let i = 0; i < people.length; i++) {
    const onPage = i % perPage
    if (i > 0 && onPage === 0) doc.addPage()
    const col = onPage % COLS
    const row = Math.floor(onPage / COLS)
    const x = PAGE_MARGIN + col * (cellW + GUTTER)
    const y = PAGE_MARGIN + row * (cellH + GUTTER)
    drawBadge(doc, x, y, cellW, cellH, conference, people[i]!, qrBuffers[i]!)
  }

  doc.end()
  return done
}

/** A single badge, centred on its own A4 page (same cell size as the sheet layout, so it matches). */
export async function generateSingleBadgePdf(conference: BadgeConference, person: BadgePerson): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 0 })
  const chunks: Buffer[] = []
  doc.on('data', (chunk) => chunks.push(chunk))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  const { width, height } = doc.page
  const cellW = width - PAGE_MARGIN * 2
  const cellH = (height - PAGE_MARGIN * 2 - GUTTER * (ROWS - 1)) / ROWS
  const qrBuffer = await qrFor(person.qrToken)
  drawBadge(doc, PAGE_MARGIN, (height - cellH) / 2, cellW, cellH, conference, person, qrBuffer)

  doc.end()
  return done
}

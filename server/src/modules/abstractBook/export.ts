import PDFDocument from 'pdfkit'

export type BookAuthor = { full_name: string; affiliation: string | null; presenting: boolean }

export type BookAbstract = {
  id: string
  submission_code: string | null
  title: string
  abstract: string
  keywords: string[]
  authors: BookAuthor[]
}

export type BookGroup = { heading: string; subheading?: string | null; abstracts: BookAbstract[] }

export type BookConference = {
  name: string
  dateRange: string
  venue: string | null
  logo: Buffer | null
}

const MARGIN = 56
const FOOTER_Y_OFFSET = 36
/** Contents lines that fit one A4 page at the sizes used below (group headings count as a line). */
const CONTENTS_LINES_PER_PAGE = 34

function contentsPageCount(groups: BookGroup[]): number {
  const lines = groups.reduce((n, g) => n + 1 + g.abstracts.length, 0)
  return Math.max(1, Math.ceil(lines / CONTENTS_LINES_PER_PAGE))
}

/** "Sharma, A." style index key, sorted by surname then the rest. */
function indexName(fullName: string): { key: string; label: string } {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) return { key: parts[0]!.toLowerCase(), label: parts[0]! }
  const surname = parts[parts.length - 1]!
  const rest = parts.slice(0, -1).join(' ')
  return { key: `${surname} ${rest}`.toLowerCase(), label: `${surname}, ${rest}` }
}

/**
 * Builds the whole book in memory and returns it with its page count.
 * Layout: cover (page 1) - contents (reserved up front, filled in at the
 * end once page numbers are known) - one abstract per page (a long one
 * flows onto the next) - author index. Every page but the cover gets a
 * page number in the footer.
 */
export async function generateAbstractBook(
  conference: BookConference,
  groups: BookGroup[],
): Promise<{ buffer: Buffer; pageCount: number }> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, info: { Title: `${conference.name} - Book of abstracts` } })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))
  const width = doc.page.width - MARGIN * 2

  // ---- Cover
  if (conference.logo) {
    try {
      doc.image(conference.logo, doc.page.width / 2 - 50, 120, { fit: [100, 100], align: 'center' })
    } catch {
      // An unreadable logo shouldn't stop the book from being generated.
    }
  }
  doc.y = 260
  doc.font('Helvetica-Bold').fontSize(26).fillColor('#111').text(conference.name, MARGIN, doc.y, { width, align: 'center' })
  doc.moveDown(0.6)
  doc.font('Helvetica').fontSize(18).fillColor('#444').text('Book of abstracts', { width, align: 'center' })
  doc.moveDown(2)
  doc.fontSize(13).fillColor('#222').text(conference.dateRange, { width, align: 'center' })
  if (conference.venue) {
    doc.moveDown(0.4)
    doc.text(conference.venue, { width, align: 'center' })
  }

  // ---- Contents (blank pages for now)
  const contentsPages = contentsPageCount(groups)
  const contentsStart = 1 // zero-based page index
  for (let i = 0; i < contentsPages; i++) doc.addPage()

  // ---- Abstracts
  const pageOf = new Map<string, number>() // abstract id -> 1-based page number
  const groupPage = new Map<number, number>()
  const authorPages = new Map<string, { label: string; pages: Set<number> }>()
  let abstractCount = 0

  groups.forEach((group, gi) => {
    group.abstracts.forEach((a, ai) => {
      doc.addPage()
      const pageNumber = doc.bufferedPageRange().start + doc.bufferedPageRange().count
      if (ai === 0) {
        groupPage.set(gi, pageNumber)
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#777').text(group.heading.toUpperCase(), { width })
        if (group.subheading) doc.font('Helvetica').fontSize(9).text(group.subheading, { width })
        doc.moveDown(0.8)
      } else {
        doc.font('Helvetica').fontSize(9).fillColor('#999').text(group.heading, { width })
        doc.moveDown(0.6)
      }
      pageOf.set(a.id, pageNumber)
      abstractCount++

      doc.font('Helvetica-Bold').fontSize(15).fillColor('#111').text(a.title, { width })
      if (a.submission_code) doc.font('Helvetica').fontSize(9).fillColor('#777').text(a.submission_code, { width })
      doc.moveDown(0.5)

      // Authors with numbered affiliations; presenting author underlined and starred.
      const affiliations: string[] = []
      const affIndex = (aff: string | null) => {
        if (!aff) return null
        let i = affiliations.indexOf(aff)
        if (i === -1) i = affiliations.push(aff) - 1
        return i + 1
      }
      // Built-in PDF fonts have no superscript glyphs, so affiliations are marked "(1)".
      a.authors.forEach((author, i) => {
        const n = affIndex(author.affiliation)
        const isLast = i === a.authors.length - 1
        const label = `${author.full_name}${author.presenting ? '*' : ''}${n ? ` (${n})` : ''}${isLast ? '' : ', '}`
        doc
          .font(author.presenting ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(11)
          .fillColor('#222')
          .text(label, { width, continued: !isLast })
        const entry = indexName(author.full_name)
        const existing = authorPages.get(entry.key) ?? { label: entry.label, pages: new Set<number>() }
        existing.pages.add(pageNumber)
        authorPages.set(entry.key, existing)
      })
      doc.moveDown(0.3)
      affiliations.forEach((aff, i) => {
        doc.font('Helvetica-Oblique').fontSize(9).fillColor('#555').text(`${i + 1} ${aff}`, { width })
      })
      if (a.authors.some((x) => x.presenting)) {
        doc.font('Helvetica').fontSize(8).fillColor('#777').text('* presenting author', { width })
      }
      doc.moveDown(0.8)

      doc.font('Helvetica').fontSize(10.5).fillColor('#111').text(a.abstract, { width, align: 'justify', lineGap: 2 })
      if (a.keywords.length > 0) {
        doc.moveDown(0.8)
        doc.font('Helvetica-Bold').fontSize(10).text('Keywords: ', { continued: true })
        doc.font('Helvetica').text(a.keywords.join(', '), { width })
      }
    })
  })

  // ---- Author index
  doc.addPage()
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#111').text('Author index', { width })
  doc.moveDown(0.8)
  const sortedAuthors = [...authorPages.entries()].sort(([a], [b]) => a.localeCompare(b))
  if (sortedAuthors.length === 0) {
    doc.font('Helvetica').fontSize(11).fillColor('#555').text('No authors.', { width })
  }
  for (const [, entry] of sortedAuthors) {
    const pages = [...entry.pages].sort((x, y) => x - y).join(', ')
    doc.font('Helvetica').fontSize(10).fillColor('#222').text(`${entry.label}  ......  ${pages}`, { width })
  }

  // ---- Fill in the contents now that page numbers are known
  doc.switchToPage(contentsStart)
  doc.y = MARGIN
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#111').text('Contents', { width })
  doc.moveDown(0.8)
  let lineOnPage = 0
  let contentsPage = contentsStart
  const nextLine = () => {
    lineOnPage++
    if (lineOnPage >= CONTENTS_LINES_PER_PAGE && contentsPage < contentsStart + contentsPages - 1) {
      contentsPage++
      doc.switchToPage(contentsPage)
      doc.y = MARGIN
      lineOnPage = 0
    }
  }
  const contentsLine = (label: string, page: number | undefined, bold: boolean) => {
    const y = doc.y
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 10).fillColor('#222')
    doc.text(label, bold ? MARGIN : MARGIN + 12, y, { width: width - 50, lineBreak: false, ellipsis: true })
    doc.text(page ? String(page) : '', MARGIN + width - 40, y, { width: 40, align: 'right', lineBreak: false })
    doc.y = y + (bold ? 18 : 15)
    nextLine()
  }
  if (groups.length === 0 || abstractCount === 0) {
    doc.font('Helvetica').fontSize(11).fillColor('#555').text('No abstracts match the chosen options.', MARGIN, doc.y, { width })
  }
  groups.forEach((group, gi) => {
    if (group.abstracts.length === 0) return
    contentsLine(group.heading, groupPage.get(gi), true)
    for (const a of group.abstracts) contentsLine(a.title, pageOf.get(a.id), false)
  })
  const indexPage = doc.bufferedPageRange().count
  contentsLine('Author index', indexPage, true)

  // ---- Page numbers (not on the cover)
  const range = doc.bufferedPageRange()
  for (let i = range.start + 1; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    const bottom = doc.page.height - FOOTER_Y_OFFSET
    // Writing inside the bottom margin would otherwise make pdfkit add a page.
    const savedMargin = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    doc.font('Helvetica').fontSize(9).fillColor('#777').text(String(i + 1), MARGIN, bottom, { width, align: 'center', lineBreak: false })
    doc.page.margins.bottom = savedMargin
  }

  const pageCount = range.count
  doc.end()
  return { buffer: await done, pageCount }
}

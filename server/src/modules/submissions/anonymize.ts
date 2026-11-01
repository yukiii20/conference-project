import JSZip from 'jszip'
import { PDFDocument, PDFName } from 'pdf-lib'

/**
 * Double-blind review helpers.
 *
 * Reviewers must never learn who wrote a paper. Two things can give it away besides the
 * author list (which the reviewer API already hides):
 *   1. the original filename ("Sharma_final_paper.pdf")      -> neutralFilename()
 *   2. the author fields inside the document's properties    -> stripDocumentMetadata()
 */

/** e.g. "S-0012-full_paper-v2.pdf" — no trace of the uploader's own filename. */
export function neutralFilename(submissionCode: string | null, kind: string, version: number, ext: string): string {
  const code = (submissionCode ?? 'paper').replace(/[^A-Za-z0-9_-]/g, '')
  return `${code || 'paper'}-${kind}-v${version}.${ext}`
}

function extensionOf(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? 'bin'
}

export function neutralFilenameFor(file: { file_kind: string; version: number; original_filename: string }, submissionCode: string | null): string {
  return neutralFilename(submissionCode, file.file_kind, file.version, extensionOf(file.original_filename))
}

/** PDF: blank the Info dictionary's identity fields and drop the XMP metadata stream. */
async function stripPdf(buffer: Buffer): Promise<Buffer> {
  const pdf = await PDFDocument.load(buffer, { updateMetadata: false })
  pdf.setAuthor('')
  pdf.setCreator('')
  pdf.setProducer('')
  pdf.setKeywords([])
  pdf.setSubject('')
  pdf.catalog.delete(PDFName.of('Metadata'))
  return Buffer.from(await pdf.save())
}

/** Word/PowerPoint (Office Open XML): blank creator / last-modified-by / company / manager. */
async function stripOfficeXml(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer)
  const blank = (xml: string, tags: string[]) =>
    tags.reduce((out, tag) => out.replace(new RegExp(`<${tag}(\\s[^>]*)?>[\\s\\S]*?</${tag}>`, 'g'), `<${tag}$1></${tag}>`), xml)

  const core = zip.file('docProps/core.xml')
  if (core) zip.file('docProps/core.xml', blank(await core.async('string'), ['dc:creator', 'cp:lastModifiedBy']))
  const app = zip.file('docProps/app.xml')
  if (app) zip.file('docProps/app.xml', blank(await app.async('string'), ['Company', 'Manager']))
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/**
 * Returns the file with author-identifying properties removed. Formats it doesn't handle
 * (images, legacy .doc/.ppt) and files it can't parse (e.g. encrypted PDFs) come back
 * unchanged — an upload is never rejected just because it couldn't be anonymised.
 */
export async function stripDocumentMetadata(buffer: Buffer, ext: string): Promise<{ buffer: Buffer; stripped: boolean }> {
  try {
    if (ext === 'pdf') return { buffer: await stripPdf(buffer), stripped: true }
    if (ext === 'docx' || ext === 'pptx') return { buffer: await stripOfficeXml(buffer), stripped: true }
  } catch {
    // fall through: keep the original
  }
  return { buffer, stripped: false }
}

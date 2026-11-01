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

/**
 * Identity-carrying attributes inside Word/PowerPoint parts, with the neutral value each gets:
 * tracked changes and comments (`w:author`, `w:initials`), the Word people list
 * (`w15:author`, `w15:userId`, `w15:providerId`) and PowerPoint's modern authors list
 * (`p188:author name/initials/userId/providerId`). The attribute names are only ever metadata,
 * never document text, so rewriting them can't change what the paper says.
 */
const IDENTITY_ATTRIBUTES: Array<[RegExp, string]> = [
  [/(\s[\w]+:author)=("[^"]*"|'[^']*')/g, '$1="Author"'],
  [/(\s[\w]+:initials)=("[^"]*"|'[^']*')/g, '$1="A"'],
  [/(\s[\w]+:userId)=("[^"]*"|'[^']*')/g, '$1="Author"'],
  [/(\s[\w]+:providerId)=("[^"]*"|'[^']*')/g, '$1="None"'],
]

/** PowerPoint comment authors: `<p:cmAuthor name=".." initials=".."/>` and `<p188:author name=".." .../>` (unprefixed attributes). */
function blankPresentationAuthors(xml: string): string {
  return xml.replace(/<([\w]+:(?:cmAuthor|author))\b([^>]*)>/g, (_m, tag: string, attrs: string) => {
    const cleaned = attrs
      .replace(/(\sname)=("[^"]*"|'[^']*')/g, '$1="Author"')
      .replace(/(\sinitials)=("[^"]*"|'[^']*')/g, '$1="A"')
      .replace(/(\suserId)=("[^"]*"|'[^']*')/g, '$1="Author"')
      .replace(/(\sproviderId)=("[^"]*"|'[^']*')/g, '$1="None"')
    return `<${tag}${cleaned}>`
  })
}

/**
 * Word/PowerPoint (Office Open XML): blank creator / last-modified-by / company / manager, every
 * custom document property's text value, and the author names on tracked changes, comments and
 * comment-author lists in every part of the document.
 */
async function stripOfficeXml(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer)
  const blank = (xml: string, tags: string[]) =>
    tags.reduce((out, tag) => out.replace(new RegExp(`<${tag}(\\s[^>]*)?>[\\s\\S]*?</${tag}>`, 'g'), `<${tag}$1></${tag}>`), xml)

  const core = zip.file('docProps/core.xml')
  if (core) zip.file('docProps/core.xml', blank(await core.async('string'), ['dc:creator', 'cp:lastModifiedBy']))
  const app = zip.file('docProps/app.xml')
  if (app) zip.file('docProps/app.xml', blank(await app.async('string'), ['Company', 'Manager']))
  // Custom properties ("Owner", "Department", ...): keep each property, empty its text value.
  const custom = zip.file('docProps/custom.xml')
  if (custom) zip.file('docProps/custom.xml', blank(await custom.async('string'), ['vt:lpwstr', 'vt:lpstr', 'vt:bstr']))

  const parts = Object.values(zip.files).filter((f) => !f.dir && /^(word|ppt)\/.*\.xml$/i.test(f.name))
  for (const part of parts) {
    const xml = await part.async('string')
    let out = IDENTITY_ATTRIBUTES.reduce((s, [pattern, replacement]) => s.replace(pattern, replacement), xml)
    if (part.name.startsWith('ppt/')) out = blankPresentationAuthors(out)
    if (out !== xml) zip.file(part.name, out)
  }
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

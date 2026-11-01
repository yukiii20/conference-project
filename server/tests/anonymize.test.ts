import JSZip from 'jszip'
import { PDFDocument, PDFName } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { neutralFilename, neutralFilenameFor, stripDocumentMetadata } from '../src/modules/submissions/anonymize.js'

const AUTHOR = 'Ram Bahadur Sharma'

async function pdfWithAuthor(): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  pdf.addPage().drawText('A study of things')
  pdf.setTitle('A study of things')
  pdf.setAuthor(AUTHOR)
  pdf.setCreator(`Word - ${AUTHOR}`)
  pdf.setProducer('Microsoft Word')
  // XMP metadata stream, as Word/Acrobat write it.
  const xmp = pdf.context.flateStream(`<x:xmpmeta><dc:creator>${AUTHOR}</dc:creator></x:xmpmeta>`, { Type: 'Metadata', Subtype: 'XML' })
  pdf.catalog.set(PDFName.of('Metadata'), pdf.context.register(xmp))
  return Buffer.from(await pdf.save({ useObjectStreams: false }))
}

async function docxWithAuthor(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types/>')
  zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Body text</w:t></w:r></w:p></w:body></w:document>')
  zip.file(
    'docProps/core.xml',
    `<cp:coreProperties><dc:title>A study</dc:title><dc:creator>${AUTHOR}</dc:creator><cp:lastModifiedBy>${AUTHOR}</cp:lastModifiedBy></cp:coreProperties>`,
  )
  zip.file('docProps/app.xml', '<Properties><Company>Tribhuvan University</Company><Manager>Dr. Boss</Manager><Pages>3</Pages></Properties>')
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('neutral filenames', () => {
  it('never contain the uploaded filename', () => {
    expect(neutralFilename('S-0012', 'full_paper', 2, 'pdf')).toBe('S-0012-full_paper-v2.pdf')
    expect(neutralFilenameFor({ file_kind: 'abstract', version: 1, original_filename: 'Sharma_final.DOCX' }, 'S-7')).toBe('S-7-abstract-v1.docx')
  })
  it('handles a missing code and strips unsafe characters', () => {
    expect(neutralFilename(null, 'abstract', 1, 'pdf')).toBe('paper-abstract-v1.pdf')
    expect(neutralFilename('../x y', 'abstract', 1, 'pdf')).toBe('xy-abstract-v1.pdf')
  })
})

describe('stripDocumentMetadata', () => {
  it('PDF: author, creator and XMP are removed; the page survives', async () => {
    const original = await pdfWithAuthor()
    expect((await PDFDocument.load(original, { updateMetadata: false })).getAuthor()).toBe(AUTHOR)

    const { buffer, stripped } = await stripDocumentMetadata(original, 'pdf')
    expect(stripped).toBe(true)
    const cleaned = await PDFDocument.load(buffer, { updateMetadata: false })
    expect(cleaned.getAuthor() ?? '').toBe('')
    expect(cleaned.getCreator() ?? '').toBe('')
    expect(cleaned.catalog.get(PDFName.of('Metadata'))).toBeUndefined()
    expect(cleaned.getPageCount()).toBe(1)
    expect(cleaned.getTitle()).toBe('A study of things')
    // No encoding of the name is left anywhere in the file (plain or UTF-16 hex as pdf-lib writes it).
    const hex = Buffer.from('﻿' + AUTHOR, 'utf16le').swap16().toString('hex').toUpperCase()
    const raw = buffer.toString('latin1')
    expect(raw.includes(AUTHOR)).toBe(false)
    expect(raw.toUpperCase().includes(hex.slice(4))).toBe(false)
  })

  it('DOCX: creator, last-modified-by, company and manager are blanked; content is kept', async () => {
    const { buffer, stripped } = await stripDocumentMetadata(await docxWithAuthor(), 'docx')
    expect(stripped).toBe(true)
    const zip = await JSZip.loadAsync(buffer)
    const core = await zip.file('docProps/core.xml')!.async('string')
    const app = await zip.file('docProps/app.xml')!.async('string')
    expect(core).not.toContain(AUTHOR)
    expect(core).toContain('<dc:creator></dc:creator>')
    expect(core).toContain('<dc:title>A study</dc:title>')
    expect(app).not.toContain('Tribhuvan')
    expect(app).not.toContain('Dr. Boss')
    expect(app).toContain('<Pages>3</Pages>')
    expect(await zip.file('word/document.xml')!.async('string')).toContain('Body text')
  })

  it('leaves files it cannot clean untouched instead of failing the upload', async () => {
    const notAPdf = Buffer.from('this is not really a pdf')
    expect(await stripDocumentMetadata(notAPdf, 'pdf')).toEqual({ buffer: notAPdf, stripped: false })
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    expect(await stripDocumentMetadata(image, 'png')).toEqual({ buffer: image, stripped: false })
  })

  it('DOCX: tracked changes, comments, the people list and custom properties lose the author', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types/>')
    zip.file(
      'word/document.xml',
      `<w:document><w:body><w:p><w:ins w:id="1" w:author="${AUTHOR}" w:date="2026-01-01T00:00:00Z"><w:r><w:t>Inserted text</w:t></w:r></w:ins>` +
        `<w:del w:id="2" w:author='${AUTHOR}'><w:r><w:delText>gone</w:delText></w:r></w:del></w:p></w:body></w:document>`,
    )
    zip.file('word/comments.xml', `<w:comments><w:comment w:id="0" w:author="${AUTHOR}" w:initials="RBS"><w:p><w:r><w:t>Note</w:t></w:r></w:p></w:comment></w:comments>`)
    zip.file('word/people.xml', `<w15:people><w15:person w15:author="${AUTHOR}"><w15:presenceInfo w15:providerId="AD" w15:userId="ram@tu.edu.np"/></w15:person></w15:people>`)
    zip.file('word/footer1.xml', `<w:ftr><w:p><w:ins w:author="${AUTHOR}"><w:r><w:t>Page</w:t></w:r></w:ins></w:p></w:ftr>`)
    zip.file('docProps/custom.xml', `<Properties><property name="Owner"><vt:lpwstr>${AUTHOR}</vt:lpwstr></property><property name="Rev"><vt:i4>3</vt:i4></property></Properties>`)

    const out = await JSZip.loadAsync((await stripDocumentMetadata(await zip.generateAsync({ type: 'nodebuffer' }), 'docx')).buffer)
    for (const name of ['word/document.xml', 'word/comments.xml', 'word/people.xml', 'word/footer1.xml', 'docProps/custom.xml']) {
      const xml = await out.file(name)!.async('string')
      expect(xml, name).not.toContain(AUTHOR)
      expect(xml, name).not.toContain('ram@tu.edu.np')
      expect(xml, name).not.toContain('RBS')
    }
    const doc = await out.file('word/document.xml')!.async('string')
    expect(doc).toContain('Inserted text')
    expect(doc).toContain('<w:delText>gone</w:delText>')
    expect(doc).toContain('w:author="Author"')
    expect(await out.file('word/comments.xml')!.async('string')).toContain('<w:t>Note</w:t>')
    expect(await out.file('docProps/custom.xml')!.async('string')).toContain('<vt:i4>3</vt:i4>')
  })

  it('PPTX: legacy and modern comment-author lists and slide comments lose the author', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types/>')
    zip.file('ppt/commentAuthors.xml', `<p:cmAuthorLst><p:cmAuthor id="0" name="${AUTHOR}" initials="RBS" lastIdx="1" clrIdx="0"/></p:cmAuthorLst>`)
    zip.file('ppt/authors.xml', `<p188:authorLst><p188:author id="{1}" name="${AUTHOR}" initials="RBS" userId="ram@tu.edu.np" providerId="AD"/></p188:authorLst>`)
    zip.file('ppt/slides/slide1.xml', '<p:sld><p:cSld><a:t>Slide title</a:t></p:cSld></p:sld>')
    zip.file('docProps/core.xml', `<cp:coreProperties><dc:creator>${AUTHOR}</dc:creator></cp:coreProperties>`)

    const out = await JSZip.loadAsync((await stripDocumentMetadata(await zip.generateAsync({ type: 'nodebuffer' }), 'pptx')).buffer)
    for (const name of ['ppt/commentAuthors.xml', 'ppt/authors.xml', 'docProps/core.xml']) {
      const xml = await out.file(name)!.async('string')
      expect(xml, name).not.toContain(AUTHOR)
      expect(xml, name).not.toContain('ram@tu.edu.np')
    }
    expect(await out.file('ppt/commentAuthors.xml')!.async('string')).toContain('lastIdx="1"')
    expect(await out.file('ppt/slides/slide1.xml')!.async('string')).toContain('Slide title')
  })
})

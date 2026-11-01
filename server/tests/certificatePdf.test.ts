import { inflateSync } from 'node:zlib'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { generateCertificatePdf, type CertificateData } from '../src/modules/certificates/export.js'
import { countPdfPages } from './pdfUtils.js'

/**
 * Pure rendering tests (no database): pdfkit output is parsed back. pdfkit Flate-compresses
 * page content and writes text as hex strings inside TJ arrays, so the helper inflates every
 * stream and joins each TJ array's hex runs into plain text.
 */
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1')
  const chunks: string[] = []
  const streamRe = /stream\r?\n/g
  let m: RegExpExecArray | null
  while ((m = streamRe.exec(raw))) {
    const start = m.index + m[0].length
    const end = raw.indexOf('endstream', start)
    if (end < 0) break
    try {
      chunks.push(inflateSync(pdf.subarray(start, end)).toString('latin1'))
    } catch {
      // not a Flate stream (e.g. an image) - skip
    }
    streamRe.lastIndex = end
  }
  const lines: string[] = []
  for (const content of chunks) {
    for (const tj of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      const text = [...tj[1]!.matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1]!, 'hex').toString('latin1')).join('')
      lines.push(text)
    }
  }
  return lines.join('\n')
}

function data(overrides: Partial<CertificateData> = {}): CertificateData {
  return {
    recipientName: 'Sita Kumari Shrestha',
    conferenceName: 'National IT Conference 2026 (NITC)',
    certificateType: 'participation',
    certificateNumber: 'NITC-2026-C0042',
    issuedAt: new Date('2026-11-01T20:30:00Z'), // 2 Nov in Nepal
    verificationToken: 'tok_abcdefghijklmnopqrstuvwxyz012345',
    backgroundBuffer: null,
    logoBuffer: null,
    primaryColor: '#101C32',
    layout: { name: { y: 260, font_size: 48, color: '#1A1A1A' } },
    signatories: [],
    signatureBuffers: [],
    ...overrides,
  }
}

describe('certificate PDF', () => {
  it('is a single A4 landscape page', async () => {
    const pdf = await generateCertificatePdf(data())
    const doc = await PDFDocument.load(pdf)
    expect(doc.getPageCount()).toBe(1)
    const { width, height } = doc.getPage(0).getSize()
    expect(Math.round(width)).toBe(842)
    expect(Math.round(height)).toBe(595)
  })

  it('prints the name, conference, number and the Nepal issue date', async () => {
    const text = pdfText(await generateCertificatePdf(data()))
    expect(text).toContain('Sita Kumari Shrestha')
    expect(text).toContain('National IT Conference 2026 (NITC)')
    expect(text).toContain('NITC-2026-C0042')
    expect(text).toContain('2 November 2026')
  })

  it('fills {name} / {conference} placeholders in custom wording', async () => {
    const text = pdfText(
      await generateCertificatePdf(
        data({ layout: { name: { y: 260, font_size: 48, color: '#1A1A1A' }, texts: { wording: 'presented a paper at {conference}' } } }),
      ),
    )
    expect(text).toContain('presented a paper at National IT Conference 2026 (NITC)')
    expect(text).not.toContain('{conference}')
  })

  it('hides parts that are switched off', async () => {
    const text = pdfText(
      await generateCertificatePdf(
        data({ layout: { name: { y: 260, font_size: 48, color: '#1A1A1A' }, show: { number: false, issued: false } } }),
      ),
    )
    expect(text).not.toContain('NITC-2026-C0042')
    expect(text).not.toContain('2 November 2026')
    expect(text).toContain('Sita Kumari Shrestha')
  })

  it('a very long name or conference never spills onto a second page', async () => {
    const pdf = await generateCertificatePdf(
      data({
        recipientName: 'Professor Doctor Ramchandra Bahadur Prasad Upadhyaya Sharma Koirala Adhikari Thapa Magar',
        conferenceName: 'International Conference on Sustainable Mountain Development, Climate Resilience and Digital Transformation 2026',
        signatories: [
          { name: 'Prof. Dr. A Very Long Signatory Name', title: 'Chair, Organising Committee', signature_path: null },
          { name: 'Dr. Another Signatory', title: 'Convenor', signature_path: null },
        ],
        signatureBuffers: [null, null],
      }),
    )
    expect(countPdfPages(pdf)).toBe(1)
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1)
  })
})

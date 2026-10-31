import { describe, expect, it } from 'vitest'
import { generateAbstractBook, type BookAbstract } from '../src/modules/abstractBook/export.js'
import { countPdfPages } from './pdfUtils.js'

// Pure PDF layout - no database rows involved.

function abstract(id: string, title: string, words = 80): BookAbstract {
  return {
    id,
    submission_code: `CODE-${id}`,
    title,
    abstract: Array.from({ length: words }, (_, i) => `word${i}`).join(' '),
    keywords: ['alpha', 'beta'],
    authors: [
      { full_name: 'Sita Sharma', affiliation: 'Tribhuvan University', presenting: true },
      { full_name: 'Ram Thapa', affiliation: 'Kathmandu University', presenting: false },
    ],
  }
}

const CONFERENCE = { name: 'Test Conference', dateRange: '15 November 2026 - 17 November 2026', venue: 'Hall, Kathmandu', logo: null }

describe('book of abstracts PDF', () => {
  it('is cover + contents + one page per short abstract + author index', async () => {
    const { buffer, pageCount } = await generateAbstractBook(CONFERENCE, [
      { heading: 'Track A', abstracts: [abstract('1', 'First paper'), abstract('2', 'Second paper')] },
      { heading: 'Track B', abstracts: [abstract('3', 'Third paper')] },
    ])
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pageCount).toBe(1 + 1 + 3 + 1)
    expect(countPdfPages(buffer)).toBe(pageCount)
  })

  it('a long abstract flows onto a second page instead of being cut off', async () => {
    const { pageCount } = await generateAbstractBook(CONFERENCE, [{ heading: 'Track A', abstracts: [abstract('1', 'Long paper', 1500)] }])
    expect(pageCount).toBeGreaterThanOrEqual(1 + 1 + 2 + 1)
  })

  it('reserves extra contents pages for a large book', async () => {
    const many = Array.from({ length: 50 }, (_, i) => abstract(String(i), `Paper ${i}`, 20))
    const { buffer, pageCount } = await generateAbstractBook(CONFERENCE, [{ heading: 'Track A', abstracts: many }])
    // 51 contents lines (1 heading + 50 titles) at 34 a page = 2 contents pages.
    expect(pageCount).toBe(1 + 2 + 50 + 1)
    expect(countPdfPages(buffer)).toBe(pageCount)
  })

  it('still produces a valid book when nothing matches', async () => {
    const { pageCount } = await generateAbstractBook(CONFERENCE, [])
    expect(pageCount).toBe(3) // cover, contents, author index
  })
})

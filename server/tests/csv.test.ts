import { describe, expect, it } from 'vitest'
import { csvCell, csvRow } from '../src/utils/csv.js'

describe('csvCell', () => {
  it('quotes every cell and doubles embedded quotes', () => {
    expect(csvCell('plain')).toBe('"plain"')
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"')
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"')
  })

  it('neutralises text a spreadsheet would run as a formula', () => {
    for (const evil of ['=HYPERLINK("http://x","click")', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1']) {
      expect(csvCell(evil).startsWith(`"'`), evil).toBe(true)
    }
    expect(csvCell('=1+1')).toBe(`"'=1+1"`)
  })

  it('leaves numbers, booleans and ordinary text alone', () => {
    expect(csvCell(-5)).toBe('"-5"')
    expect(csvCell(1500.5)).toBe('"1500.5"')
    expect(csvCell(true)).toBe('"true"')
    expect(csvCell('1500.00')).toBe('"1500.00"')
    expect(csvCell('Ram - Sita')).toBe('"Ram - Sita"')
  })

  it('writes empty for null/undefined, ISO for dates and JSON for objects', () => {
    expect(csvCell(null)).toBe('""')
    expect(csvCell(undefined)).toBe('""')
    expect(csvCell(new Date('2026-11-01T05:00:00Z'))).toBe('"2026-11-01T05:00:00.000Z"')
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"')
  })

  it('csvRow joins cells with commas', () => {
    expect(csvRow(['a', 1, null, '=x'])).toBe(`"a","1","","'=x"`)
  })
})

import { describe, expect, it } from 'vitest'
import { findClashes } from '../src/modules/agenda/service.js'
import { foldLine, generateIcs, localStamp, utcOffset } from '../src/modules/agenda/ics.js'

// Pure calendar logic - no database rows involved.

/** 2026-11-15 09:00 Asia/Kathmandu = 03:15 UTC. */
const NINE_AM_KTM = new Date('2026-11-15T03:15:00.000Z')

function at(minutesAfterNine: number): Date {
  return new Date(NINE_AM_KTM.getTime() + minutesAfterNine * 60_000)
}

/** Unfolds RFC 5545 continuation lines so assertions can match whole properties. */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n /g, '').split('\r\n')
}

describe('ics output', () => {
  it('writes Asia/Kathmandu wall-clock times with a matching +0545 VTIMEZONE', () => {
    expect(localStamp(NINE_AM_KTM, 'Asia/Kathmandu')).toBe('20261115T090000')
    expect(utcOffset('Asia/Kathmandu', NINE_AM_KTM)).toBe('+0545')

    const ics = generateIcs({
      name: 'Test',
      timezone: 'Asia/Kathmandu',
      events: [{ uid: 'a@x', startsAt: NINE_AM_KTM, endsAt: at(60), summary: 'Opening, keynote; welcome' }],
    })
    const lines = unfold(ics)
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines).toContain('VERSION:2.0')
    expect(lines).toContain('TZID:Asia/Kathmandu')
    expect(lines).toContain('TZOFFSETTO:+0545')
    expect(lines).toContain('DTSTART;TZID=Asia/Kathmandu:20261115T090000')
    expect(lines).toContain('DTEND;TZID=Asia/Kathmandu:20261115T100000')
    expect(lines).toContain('SUMMARY:Opening\\, keynote\\; welcome')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    // Every BEGIN has a matching END, in order.
    const stack: string[] = []
    for (const line of lines) {
      if (line.startsWith('BEGIN:')) stack.push(line.slice(6))
      if (line.startsWith('END:')) expect(stack.pop()).toBe(line.slice(4))
    }
    expect(stack).toEqual([])
  })

  it('folds long lines to at most 75 octets without splitting a UTF-8 character', () => {
    const line = `DESCRIPTION:${'नमस्ते '.repeat(40)}`
    const folded = foldLine(line)
    for (const physical of folded.split('\r\n')) {
      expect(Buffer.byteLength(physical, 'utf8')).toBeLessThanOrEqual(75)
    }
    expect(folded.replace(/\r\n /g, '')).toBe(line)
  })
})

describe('clash detection', () => {
  it('flags overlapping sessions but not back-to-back ones', () => {
    const clashes = findClashes([
      { id: 'a', starts_at: at(0), ends_at: at(60) },
      { id: 'b', starts_at: at(30), ends_at: at(90) },
      { id: 'c', starts_at: at(90), ends_at: at(120) },
    ])
    expect(clashes.get('a')).toEqual(['b'])
    expect(clashes.get('b')).toEqual(['a'])
    expect(clashes.has('c')).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { EMPTY_FILTERS, filterSessions, joinState, pickDefaultSession, programmeDays, type AudienceSession } from './audienceProgramme'

function session(overrides: Partial<AudienceSession>): AudienceSession {
  return {
    id: 'x',
    title: 'Untitled',
    session_type: 'paper',
    description: null,
    starts_at: '2026-11-20T04:15:00Z', // 10:00 in Kathmandu
    ends_at: '2026-11-20T05:15:00Z',
    status: 'published',
    delivery_mode: 'in_person',
    room: { id: 'r1', name: 'Hall A' },
    track: { id: 't1', name: 'Water' },
    chairs: [],
    presentations: [],
    starred: false,
    attended: false,
    online_window: null,
    ...overrides,
  }
}

const sessions = [
  session({ id: 'a', title: 'Opening keynote', starred: true }),
  session({ id: 'b', title: 'Glaciers', room: { id: 'r2', name: 'Hall B' }, presentations: [{ id: 'p', title: 'Ice', authors: ['Sita Rai'], speaker_name: null }] }),
  session({ id: 'c', title: 'Day two', starts_at: '2026-11-21T04:15:00Z', ends_at: '2026-11-21T05:00:00Z', track: { id: 't2', name: 'Energy' } }),
]

describe('programme filters', () => {
  it('lists the days in order', () => {
    expect(programmeDays(sessions)).toEqual(['2026-11-20', '2026-11-21'])
  })

  it('filters by day, track, room and My agenda', () => {
    expect(filterSessions(sessions, { ...EMPTY_FILTERS, day: '2026-11-21' }).map((s) => s.id)).toEqual(['c'])
    expect(filterSessions(sessions, { ...EMPTY_FILTERS, trackId: 't1' }).map((s) => s.id)).toEqual(['a', 'b'])
    expect(filterSessions(sessions, { ...EMPTY_FILTERS, roomId: 'r2' }).map((s) => s.id)).toEqual(['b'])
    expect(filterSessions(sessions, { ...EMPTY_FILTERS, onlyStarred: true }).map((s) => s.id)).toEqual(['a'])
  })

  it('searches titles and speaker/author names, ignoring case', () => {
    expect(filterSessions(sessions, { ...EMPTY_FILTERS, query: 'KEYNOTE' }).map((s) => s.id)).toEqual(['a'])
    expect(filterSessions(sessions, { ...EMPTY_FILTERS, query: 'sita' }).map((s) => s.id)).toEqual(['b'])
    expect(filterSessions(sessions, { ...EMPTY_FILTERS, query: 'nothing matches' })).toEqual([])
  })
})

describe('join online label', () => {
  const window = { opens_at: '2026-11-20T04:00:00Z', closes_at: '2026-11-20T05:15:00Z', open: false }
  it('follows the 15-minute window', () => {
    const s = session({ delivery_mode: 'online', online_window: window })
    expect(joinState(s, new Date('2026-11-20T03:59:00Z'))).toBe('soon')
    expect(joinState(s, new Date('2026-11-20T04:30:00Z'))).toBe('open')
    expect(joinState(s, new Date('2026-11-20T05:16:00Z'))).toBe('ended')
  })
  it('is none for in-person or cancelled sessions', () => {
    expect(joinState(session({}))).toBe('none')
    expect(joinState(session({ status: 'cancelled', online_window: window }))).toBe('none')
  })
})

describe('Q&A default session', () => {
  const list = [
    session({ id: 'past', starts_at: '2026-11-20T03:00:00Z', ends_at: '2026-11-20T04:00:00Z' }),
    session({ id: 'live', starts_at: '2026-11-20T04:15:00Z', ends_at: '2026-11-20T05:15:00Z' }),
    session({ id: 'next', starts_at: '2026-11-20T06:00:00Z', ends_at: '2026-11-20T07:00:00Z' }),
  ]
  it('picks the session in progress, else the next one, else the last one', () => {
    expect(pickDefaultSession(list, Date.parse('2026-11-20T04:30:00Z'))).toBe('live')
    expect(pickDefaultSession(list, Date.parse('2026-11-20T05:30:00Z'))).toBe('next')
    expect(pickDefaultSession(list, Date.parse('2026-11-21T00:00:00Z'))).toBe('next')
    expect(pickDefaultSession([], Date.now())).toBe('')
  })
})

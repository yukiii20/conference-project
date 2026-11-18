import { describe, expect, it } from 'vitest'
import { conferenceEndsAt, isConferenceEnded } from './conferenceEnded'

describe('isConferenceEnded (Nepal time)', () => {
  it('ends at midnight Nepal time after the end date', () => {
    // 2026-11-20 00:00 Asia/Kathmandu = 2026-11-19 18:15 UTC
    expect(conferenceEndsAt('2026-11-19').toISOString()).toBe('2026-11-19T18:15:00.000Z')
  })

  it('is still running during the last day, ended one second after it', () => {
    expect(isConferenceEnded('2026-11-19', new Date('2026-11-19T18:14:59.000Z'))).toBe(false)
    expect(isConferenceEnded('2026-11-19', new Date('2026-11-19T18:15:00.000Z'))).toBe(true)
  })

  it('treats a missing date as not ended', () => {
    expect(isConferenceEnded(null)).toBe(false)
    expect(isConferenceEnded(undefined)).toBe(false)
  })
})

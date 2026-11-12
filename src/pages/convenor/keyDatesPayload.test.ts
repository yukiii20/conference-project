import { describe, expect, it } from 'vitest'
import { buildKeyDatesPayload } from './keyDatesPayload'

const types = [
  { code: 'abstract_submission', name: 'Abstract submission', is_window: true },
  { code: 'notification', name: 'Notification of acceptance', is_window: false },
]
const empty = { opens_at: '', closes_at: '', is_public: true }

describe('buildKeyDatesPayload (one click on Save keeps every date)', () => {
  it('converts Nepal wall-clock values to UTC', () => {
    const out = buildKeyDatesPayload(types, {
      abstract_submission: { opens_at: '2026-12-01T00:00', closes_at: '2026-12-31T23:59', is_public: true },
      notification: { ...empty, closes_at: '2027-01-10T09:00' },
    })
    expect(out).toEqual({
      payload: [
        { deadline_type: 'abstract_submission', opens_at: '2026-11-30T18:15:00.000Z', closes_at: '2026-12-31T18:14:00.000Z', is_public: true },
        { deadline_type: 'notification', opens_at: '2027-01-10T03:15:00.000Z', closes_at: '2027-01-10T03:15:00.000Z', is_public: true },
      ],
    })
  })

  it('reports a closing date without an opening date instead of skipping it silently', () => {
    const out = buildKeyDatesPayload(types, { abstract_submission: { ...empty, closes_at: '2026-12-31T23:59' }, notification: empty })
    expect(out).toEqual({ error: 'Abstract submission: set the opening date too, or clear the closing date.' })
  })

  it('reports a half-typed date/time (the browser gives "") instead of skipping it silently', () => {
    const out = buildKeyDatesPayload(
      types,
      { abstract_submission: { ...empty, opens_at: '2026-12-01T09:00' }, notification: empty },
      new Set(['notification.closes_at']),
    )
    expect('error' in out && out.error).toMatch(/Notification of acceptance: enter both the date and the time/)
  })

  it('rejects closing before opening', () => {
    const out = buildKeyDatesPayload(types, {
      abstract_submission: { opens_at: '2026-12-02T00:00', closes_at: '2026-12-01T00:00', is_public: true },
    })
    expect(out).toEqual({ error: 'Abstract submission: the closing date must be on or after the opening date.' })
  })

  it('asks for at least one date when nothing is set', () => {
    expect(buildKeyDatesPayload(types, { abstract_submission: empty, notification: empty })).toEqual({ error: 'Set at least one date before saving.' })
  })
})

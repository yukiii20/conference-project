import { describe, expect, it } from 'vitest'
import { AUDIENCE_SECTION_IDS, isAudienceOnly, visibleSections } from './sidebarConfig'

describe('portal sidebar for the Audience role', () => {
  it('an Audience-only person sees exactly the Audience sections, in order', () => {
    const roles = new Set(['attendee'])
    const ids = visibleSections(roles, roles).map((s) => s.id)
    expect(ids).toEqual(AUDIENCE_SECTION_IDS)
    for (const forbidden of ['author', 'reviewer', 'session-chair', 'staff']) expect(ids).not.toContain(forbidden)
  })

  it('labels the feedback section "Feedback" for the Audience', () => {
    const roles = new Set(['attendee'])
    expect(visibleSections(roles, roles).find((s) => s.id === 'feedback')?.label).toBe('Feedback')
  })

  it('a person with another role keeps that role\'s sections next to the Audience ones', () => {
    const inConference = new Set(['attendee', 'author'])
    const ids = visibleSections(inConference, inConference).map((s) => s.id)
    expect(ids).toContain('author')
    expect(ids).toContain('ticket')
    expect(isAudienceOnly(inConference)).toBe(false)
  })

  it('no roles at all is not "Audience only"', () => {
    expect(isAudienceOnly(new Set())).toBe(false)
  })
})

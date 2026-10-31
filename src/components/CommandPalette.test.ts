import { describe, expect, it } from 'vitest'
import { isTypingTarget, rankSearchItems, type SearchItem } from './CommandPalette'

const items: SearchItem[] = [
  { id: 'a', label: 'Attendance', group: 'Event', keywords: ['qr', 'check-in', 'name badges'], to: '/convenor/event/attendance' },
  { id: 'b', label: 'Submissions', group: 'Papers', keywords: ['abstracts'], to: '/convenor/papers/submissions' },
  { id: 'c', label: 'Review settings', group: 'Papers', keywords: ['scoring'], to: '/convenor/papers/settings' },
  { id: 'd', label: 'Reviews and decisions', group: 'Papers', to: '/convenor/papers/reviews' },
]

describe('rankSearchItems', () => {
  it('returns everything for an empty query', () => {
    expect(rankSearchItems(items, '  ')).toBe(items)
  })

  it('finds items by keyword and group, not just label', () => {
    expect(rankSearchItems(items, 'qr').map((i) => i.id)).toEqual(['a'])
    expect(rankSearchItems(items, 'badges').map((i) => i.id)).toEqual(['a'])
    expect(rankSearchItems(items, 'papers').map((i) => i.id).sort()).toEqual(['b', 'c', 'd'])
  })

  it('ranks label prefix matches first', () => {
    expect(rankSearchItems(items, 'review').map((i) => i.id)).toEqual(['c', 'd'])
    expect(rankSearchItems(items, 'decisions').map((i) => i.id)).toEqual(['d'])
  })

  it('requires every word to match', () => {
    expect(rankSearchItems(items, 'review scoring').map((i) => i.id)).toEqual(['c'])
    expect(rankSearchItems(items, 'review qr')).toEqual([])
  })
})

describe('isTypingTarget', () => {
  it('ignores non-elements', () => {
    expect(isTypingTarget(null)).toBe(false)
  })
})

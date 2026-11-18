import { describe, expect, it } from 'vitest'
import { formatBytes, groupByTrack, type AbstractLike } from './audienceFiles'

describe('formatBytes', () => {
  it('uses B, KB and MB', () => {
    expect(formatBytes(12)).toBe('12 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB')
    expect(formatBytes(-1)).toBe('—')
  })
})

describe('groupByTrack', () => {
  const a = (title: string, track: string): AbstractLike => ({
    title,
    abstract: '',
    submission_code: null,
    keywords: [],
    track: { id: track, name: track },
    authors: [],
  })
  it('groups by track name alphabetically and keeps order inside a track', () => {
    const groups = groupByTrack([a('Two', 'Water'), a('One', 'Energy'), a('Three', 'Water')])
    expect(groups.map((g) => g.track)).toEqual(['Energy', 'Water'])
    expect(groups[1]!.items.map((i) => i.title)).toEqual(['Two', 'Three'])
  })
})

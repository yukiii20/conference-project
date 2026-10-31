import { describe, expect, it } from 'vitest'
import { average, buildResults, type ResultAnswer, type ResultQuestion, type ResultResponse } from '../src/modules/feedback/results.js'

const questions: ResultQuestion[] = [
  { id: 'q-comments', position: 1000, builtin_key: 'comments', kind: 'text', prompt: 'Comments', options: [] },
  { id: 'q-overall', position: 1, builtin_key: 'overall', kind: 'rating', prompt: 'Overall', options: [] },
  { id: 'q-best', position: 5, builtin_key: 'best_session', kind: 'session', prompt: 'Best session', options: [] },
  { id: 'q-lunch', position: 100, builtin_key: null, kind: 'choice', prompt: 'Lunch?', options: ['Good', 'Bad'] },
]
const responses: ResultResponse[] = [
  { id: 'r1', submitted_at: '2026-10-01T10:00:00.000Z', respondent_name: 'Asha' },
  { id: 'r2', submitted_at: '2026-10-02T10:00:00.000Z', respondent_name: null },
  { id: 'r3', submitted_at: '2026-10-03T10:00:00.000Z', respondent_name: 'Bikash' },
]
const a = (response_id: string, question_id: string, v: Partial<ResultAnswer>): ResultAnswer => ({
  response_id,
  question_id,
  rating: null,
  text_value: null,
  choice_value: null,
  session_id: null,
  ...v,
})
const answers: ResultAnswer[] = [
  a('r1', 'q-overall', { rating: 5 }),
  a('r2', 'q-overall', { rating: 4 }),
  a('r3', 'q-overall', { rating: 4 }),
  a('r1', 'q-best', { session_id: 's-keynote' }),
  a('r2', 'q-best', { session_id: 's-keynote' }),
  a('r3', 'q-best', { session_id: 's-panel' }),
  a('r1', 'q-lunch', { choice_value: 'Good' }),
  a('r2', 'q-comments', { text_value: '  Great event  ' }),
  a('r3', 'q-comments', { text_value: '   ' }),
  a('r-unknown', 'q-overall', { rating: 1 }), // not one of the survey's responses: ignored
]
const titles = new Map([
  ['s-keynote', 'Keynote'],
  ['s-panel', 'Panel'],
])

describe('feedback results maths', () => {
  it('averages to 2 decimals and is null with no answers', () => {
    expect(average([5, 4, 4])).toBe(4.33)
    expect(average([1, 2])).toBe(1.5)
    expect(average([])).toBeNull()
  })

  it('builds per-question results in question order', () => {
    const results = buildResults(questions, responses, answers, titles)
    expect(results.map((q) => q.id)).toEqual(['q-overall', 'q-best', 'q-lunch', 'q-comments'])

    const overall = results[0]!
    expect(overall.kind).toBe('rating')
    if (overall.kind !== 'rating') return
    expect(overall.answered).toBe(3)
    expect(overall.average).toBe(4.33)
    expect(overall.distribution).toEqual([0, 0, 0, 2, 1])

    const best = results[1]!
    if (best.kind !== 'session') throw new Error('expected session')
    expect(best.counts).toEqual([
      { session_id: 's-keynote', label: 'Keynote', count: 2 },
      { session_id: 's-panel', label: 'Panel', count: 1 },
    ])

    const lunch = results[2]!
    if (lunch.kind !== 'choice') throw new Error('expected choice')
    expect(lunch.answered).toBe(1)
    expect(lunch.counts).toEqual([
      { label: 'Good', count: 1 },
      { label: 'Bad', count: 0 },
    ])
  })

  it('lists non-blank comments, keeping anonymous ones nameless', () => {
    const comments = buildResults(questions, responses, answers, titles)[3]!
    if (comments.kind !== 'text') throw new Error('expected text')
    expect(comments.answered).toBe(1)
    expect(comments.comments).toEqual([{ text: 'Great event', submitted_at: '2026-10-02T10:00:00.000Z', respondent_name: null }])
  })
})

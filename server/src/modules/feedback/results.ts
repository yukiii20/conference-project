// Pure maths for the convenor's survey results — no database, so the
// averages/distributions are unit-tested directly.

export type QuestionKind = 'rating' | 'text' | 'choice' | 'session'

export type ResultQuestion = {
  id: string
  position: number
  builtin_key: string | null
  kind: QuestionKind
  prompt: string
  options: string[]
}

export type ResultAnswer = {
  response_id: string
  question_id: string
  rating: number | null
  text_value: string | null
  choice_value: string | null
  session_id: string | null
}

/** respondent_name is already null for anonymous responses — the caller never passes the name through. */
export type ResultResponse = { id: string; submitted_at: string; respondent_name: string | null }

export type QuestionResult =
  | (ResultQuestion & { kind: 'rating'; answered: number; average: number | null; distribution: number[] })
  | (ResultQuestion & { kind: 'choice'; answered: number; counts: Array<{ label: string; count: number }> })
  | (ResultQuestion & { kind: 'session'; answered: number; counts: Array<{ session_id: string; label: string; count: number }> })
  | (ResultQuestion & {
      kind: 'text'
      answered: number
      comments: Array<{ text: string; submitted_at: string; respondent_name: string | null }>
    })

/** Rounded to 2 decimals; null when nobody answered. */
export function average(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
}

export function buildResults(
  questions: ResultQuestion[],
  responses: ResultResponse[],
  answers: ResultAnswer[],
  sessionTitles: Map<string, string>,
): QuestionResult[] {
  const responseById = new Map(responses.map((r) => [r.id, r]))
  const byQuestion = new Map<string, ResultAnswer[]>()
  for (const a of answers) {
    if (!responseById.has(a.response_id)) continue
    const list = byQuestion.get(a.question_id) ?? []
    list.push(a)
    byQuestion.set(a.question_id, list)
  }

  return [...questions]
    .sort((a, b) => a.position - b.position)
    .map((q): QuestionResult => {
      const list = byQuestion.get(q.id) ?? []
      switch (q.kind) {
        case 'rating': {
          const ratings = list.map((a) => a.rating).filter((r): r is number => r !== null && r >= 1 && r <= 5)
          const distribution = [0, 0, 0, 0, 0]
          for (const r of ratings) distribution[r - 1]! += 1
          return { ...q, kind: 'rating', answered: ratings.length, average: average(ratings), distribution }
        }
        case 'choice': {
          const counts = new Map(q.options.map((o) => [o, 0]))
          for (const a of list) if (a.choice_value !== null && counts.has(a.choice_value)) counts.set(a.choice_value, counts.get(a.choice_value)! + 1)
          return {
            ...q,
            kind: 'choice',
            answered: list.filter((a) => a.choice_value !== null).length,
            counts: [...counts].map(([label, count]) => ({ label, count })),
          }
        }
        case 'session': {
          const counts = new Map<string, number>()
          for (const a of list) if (a.session_id) counts.set(a.session_id, (counts.get(a.session_id) ?? 0) + 1)
          return {
            ...q,
            kind: 'session',
            answered: [...counts.values()].reduce((a, b) => a + b, 0),
            counts: [...counts]
              .map(([session_id, count]) => ({ session_id, label: sessionTitles.get(session_id) ?? 'Removed session', count }))
              .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
          }
        }
        case 'text': {
          const comments = list
            .filter((a) => a.text_value && a.text_value.trim() !== '')
            .map((a) => {
              const r = responseById.get(a.response_id)!
              return { text: a.text_value!.trim(), submitted_at: r.submitted_at, respondent_name: r.respondent_name }
            })
            .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))
          return { ...q, kind: 'text', answered: comments.length, comments }
        }
      }
    })
}

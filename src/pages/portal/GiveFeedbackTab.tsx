import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, MessageSquareHeart } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'
import { useToast } from '../../components/ui/Toast'
import { useMyFeedback } from '../../components/feedback/useMyFeedback'
import { Alert, Button, Checkbox, EmptyState, FormField, PageHeader, Select, SkeletonText, Textarea } from '../../components/ui'

type Question = {
  id: string
  builtin_key: string | null
  kind: 'rating' | 'text' | 'choice' | 'session'
  prompt: string
  options: string[]
  is_required: boolean
}

type Form = {
  conference: { id: string; name: string }
  survey: { title: string; intro: string | null; closes_at: string; allow_anonymous: boolean }
  questions: Question[]
  sessions: Array<{ id: string; title: string; starts_at: string }>
  responded: boolean
}

type Answer = { rating?: number; text?: string; choice?: string; session_id?: string }

function RatingInput({ name, value, onChange }: { name: string; value: number | undefined; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {[1, 2, 3, 4, 5].map((n) => (
        <label
          key={n}
          className={`flex h-11 w-11 cursor-pointer items-center justify-center rounded-md border text-sm font-medium transition-colors ${
            value === n ? 'border-brand bg-brand text-white' : 'border-border bg-surface text-text hover:border-brand/60'
          }`}
        >
          <input type="radio" name={name} value={n} checked={value === n} onChange={() => onChange(n)} className="sr-only" aria-label={`${n} out of 5`} />
          {n}
        </label>
      ))}
      <span className="w-full text-xs text-text-muted">1 = poor, 5 = excellent</span>
    </div>
  )
}

/** Portal: answer the post-conference feedback survey (one response per person, optionally anonymous). */
export function GiveFeedbackTab() {
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { surveys, reload } = useMyFeedback()
  const [form, setForm] = useState<Form | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [anonymous, setAnonymous] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const requested = searchParams.get('c')
  const selected =
    surveys?.find((s) => s.conference_id === requested) ?? surveys?.find((s) => !s.responded) ?? surveys?.[0] ?? null
  const selectedId = selected?.conference_id ?? null

  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    setForm(null)
    setFormError(null)
    setAnswers({})
    setFieldErrors({})
    setAnonymous(false)
    api
      .get<Form>(`/conferences/${selectedId}/feedback-survey/form`)
      .then((d) => {
        if (!cancelled) setForm(d)
      })
      .catch((err) => {
        if (!cancelled) setFormError(err instanceof ApiError ? err.message : 'Could not load the survey.')
      })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  function setAnswer(questionId: string, patch: Answer) {
    setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], ...patch } }))
    setFieldErrors((prev) => {
      const next = { ...prev }
      delete next[questionId]
      return next
    })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form || !selectedId) return
    const missing: Record<string, string> = {}
    for (const q of form.questions) {
      const a = answers[q.id]
      const given = a && (a.rating !== undefined || a.text?.trim() || a.choice || a.session_id)
      if (q.is_required && !given) missing[q.id] = 'Please answer this question.'
    }
    if (Object.keys(missing).length > 0) {
      setFieldErrors(missing)
      showToast('Please answer the required questions.', 'error')
      return
    }
    setSubmitting(true)
    try {
      const res = await api.post<{ message: string }>(`/conferences/${selectedId}/feedback-survey/responses`, {
        is_anonymous: anonymous,
        answers: Object.entries(answers).map(([question_id, a]) => ({
          question_id,
          rating: a.rating ?? null,
          text: a.text?.trim() || null,
          choice: a.choice || null,
          session_id: a.session_id || null,
        })),
      })
      showToast(res.message, 'success')
      setForm({ ...form, responded: true })
      await reload()
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFieldErrors(err.fields)
      showToast(err instanceof ApiError ? err.message : 'Could not send your feedback.', 'error')
    }
    setSubmitting(false)
  }

  return (
    <div className="mt-6 max-w-2xl">
      <PageHeader title="Give feedback" subtitle="Tell the organisers how a conference you took part in went - it takes about two minutes." />

      {surveys === null ? (
        <SkeletonText lines={5} className="mt-4" />
      ) : surveys.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-border bg-surface">
          <EmptyState
            icon={<MessageSquareHeart aria-hidden />}
            title="No surveys to answer right now."
            message="After a conference you checked in to, chaired or presented at, its feedback survey shows up here (and we'll email you the link)."
            actionLabel="Back to dashboard"
            onAction={() => navigate('/portal/dashboard')}
          />
        </div>
      ) : (
        <>
          {surveys.length > 1 ? (
            <div className="mt-4 max-w-sm">
              <FormField label="Conference" htmlFor="feedback-conference">
                <Select id="feedback-conference" value={selectedId ?? ''} onChange={(e) => setSearchParams({ c: e.target.value })}>
                  {surveys.map((s) => (
                    <option key={s.conference_id} value={s.conference_id}>
                      {s.conference_name}
                      {s.responded ? ' (answered)' : ''}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
          ) : null}

          {formError ? (
            <div className="mt-4">
              <Alert variant="danger">{formError}</Alert>
            </div>
          ) : !form ? (
            <SkeletonText lines={6} className="mt-4" />
          ) : form.responded ? (
            <div className="mt-4 rounded-lg border border-border bg-surface">
              <EmptyState
                icon={<CheckCircle2 aria-hidden />}
                title="Thank you - your feedback is in."
                message={`You've already answered the survey for ${form.conference.name}. Each person can answer once.`}
                actionLabel="Back to dashboard"
                onAction={() => navigate('/portal/dashboard')}
              />
            </div>
          ) : (
            <form onSubmit={submit} className="mt-4 space-y-5 rounded-lg border border-border bg-surface p-4 sm:p-6" noValidate>
              <div>
                <h2 className="text-lg font-semibold text-text">{form.survey.title}</h2>
                <p className="text-sm text-text-muted">
                  {form.conference.name} · closes {formatKathmandu(form.survey.closes_at)}
                </p>
                {form.survey.intro ? <p className="mt-2 whitespace-pre-line text-sm text-text/80">{form.survey.intro}</p> : null}
              </div>

              {form.questions.map((q) => {
                const id = `fq-${q.id}`
                const a = answers[q.id] ?? {}
                return (
                  <FormField key={q.id} label={q.prompt} required={q.is_required} error={fieldErrors[q.id]} htmlFor={q.kind === 'rating' || q.kind === 'choice' ? undefined : id}>
                    {q.kind === 'rating' ? (
                      <RatingInput name={id} value={a.rating} onChange={(v) => setAnswer(q.id, { rating: v })} />
                    ) : q.kind === 'text' ? (
                      <Textarea id={id} rows={4} maxLength={5000} value={a.text ?? ''} onChange={(e) => setAnswer(q.id, { text: e.target.value })} />
                    ) : q.kind === 'session' ? (
                      <Select id={id} value={a.session_id ?? ''} onChange={(e) => setAnswer(q.id, { session_id: e.target.value })}>
                        <option value="">{form.sessions.length === 0 ? 'No sessions in the programme' : 'Choose a session'}</option>
                        {form.sessions.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.title} ({formatKathmandu(s.starts_at)})
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <div className="space-y-1.5" role="radiogroup">
                        {q.options.map((o) => (
                          <label key={o} className="flex cursor-pointer items-center gap-2 text-sm text-text">
                            <input type="radio" name={id} value={o} checked={a.choice === o} onChange={() => setAnswer(q.id, { choice: o })} />
                            {o}
                          </label>
                        ))}
                      </div>
                    )}
                  </FormField>
                )
              })}

              {form.survey.allow_anonymous ? (
                <div className="border-t border-border pt-4">
                  <Checkbox
                    label="Answer anonymously (the organisers won't see your name)"
                    checked={anonymous}
                    onChange={(e) => setAnonymous(e.target.checked)}
                  />
                </div>
              ) : (
                <p className="border-t border-border pt-4 text-xs text-text-muted">The organisers will see your name with your answers.</p>
              )}

              <Button type="submit" loading={submitting}>
                Send feedback
              </Button>
            </form>
          )}
        </>
      )}
    </div>
  )
}

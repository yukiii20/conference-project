import { useCallback, useEffect, useState } from 'react'
import { Download, Mail, MessageSquareHeart, Plus, Trash2 } from 'lucide-react'
import { API_BASE, api, ApiError } from '../../lib/api'
import { formatKathmandu, fromKathmanduInputValue, toKathmanduInputValue } from '../../lib/datetime'
import { useToast } from '../../components/ui/Toast'
import { ChartCard, MagnitudeBar, SimpleTable, StatTile } from '../../components/analytics/ChartPrimitives'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  Select,
  SkeletonText,
  Textarea,
  buttonClasses,
} from '../../components/ui'

type CustomKind = 'rating' | 'text' | 'choice'
type QuestionKind = CustomKind | 'session'

type Survey = {
  id: string
  title: string
  intro: string | null
  is_open: boolean
  opens_at: string | null
  closes_at: string | null
  allow_anonymous: boolean
  accepting_responses: boolean
}

type Question = { id: string; builtin_key: string | null; kind: QuestionKind; prompt: string; options: string[]; is_required: boolean }

type AdminData = {
  survey: Survey | null
  questions: Question[]
  builtin_questions: Array<{ key: string; kind: QuestionKind; prompt: string; is_required: boolean }>
  stats: { eligible: number; invited: number; responses: number; not_invited: number }
  quota: { dailyLimit: number; usedToday: number; remainingToday: number }
  conference: { end_date: string; has_ended: boolean }
}

type QuestionResult = Question & { answered: number } & (
    | { kind: 'rating'; average: number | null; distribution: number[] }
    | { kind: 'choice'; counts: Array<{ label: string; count: number }> }
    | { kind: 'session'; counts: Array<{ session_id: string; label: string; count: number }> }
    | { kind: 'text'; comments: Array<{ text: string; submitted_at: string; respondent_name: string | null }> }
  )

type Results = { response_count: number; eligible_count: number; overall_average: number | null; questions: QuestionResult[] }

type DraftQuestion = { kind: CustomKind; prompt: string; options: string; is_required: boolean }

const KIND_LABELS: Record<QuestionKind, string> = { rating: 'Rating 1-5', text: 'Free text', choice: 'Choice', session: 'Best session pick' }

function toDraft(q: Question): DraftQuestion {
  return { kind: q.kind as CustomKind, prompt: q.prompt, options: q.options.join('\n'), is_required: q.is_required }
}

function surveyState(s: Survey): { label: string; tone: 'success' | 'neutral' | 'warning' } {
  if (s.accepting_responses) return { label: 'Open for answers', tone: 'success' }
  if (s.is_open && s.opens_at && new Date(s.opens_at).getTime() > Date.now()) return { label: 'Opens later', tone: 'warning' }
  if (s.is_open) return { label: 'Past its closing date', tone: 'neutral' }
  return { label: 'Closed', tone: 'neutral' }
}

/** Convenor: build the post-conference feedback survey, open/close it, email the link, and read the results. */
export function FeedbackSurveyTab({ conferenceId }: { conferenceId: string }) {
  const { showToast } = useToast()
  const [data, setData] = useState<AdminData | null>(null)
  const [results, setResults] = useState<Results | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const [title, setTitle] = useState('Conference feedback')
  const [intro, setIntro] = useState('')
  const [opensAt, setOpensAt] = useState('')
  const [closesAt, setClosesAt] = useState('')
  const [allowAnonymous, setAllowAnonymous] = useState(true)
  const [custom, setCustom] = useState<DraftQuestion[]>([])
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const [confirmOpen, setConfirmOpen] = useState<boolean | null>(null)
  const [toggling, setToggling] = useState(false)
  const [confirmInvite, setConfirmInvite] = useState(false)
  const [inviting, setInviting] = useState(false)

  const fillForm = useCallback((d: AdminData) => {
    if (!d.survey) return
    setTitle(d.survey.title)
    setIntro(d.survey.intro ?? '')
    setOpensAt(toKathmanduInputValue(d.survey.opens_at))
    setClosesAt(toKathmanduInputValue(d.survey.closes_at))
    setAllowAnonymous(d.survey.allow_anonymous)
    setCustom(d.questions.filter((q) => q.builtin_key === null).map(toDraft))
  }, [])

  const load = useCallback(async () => {
    try {
      const d = await api.get<AdminData>(`/conferences/${conferenceId}/feedback-survey`)
      setData(d)
      fillForm(d)
      setError(null)
      if (d.survey && d.stats.responses > 0) {
        setResults(await api.get<Results>(`/conferences/${conferenceId}/feedback-survey/results`))
      } else {
        setResults(null)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the feedback survey.')
    }
  }, [conferenceId, fillForm])

  useEffect(() => {
    load()
  }, [load])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFieldErrors({})
    try {
      const d = await api.put<AdminData>(`/conferences/${conferenceId}/feedback-survey`, {
        title,
        intro: intro.trim() || null,
        opens_at: opensAt ? fromKathmanduInputValue(opensAt) : null,
        closes_at: closesAt ? fromKathmanduInputValue(closesAt) : null,
        allow_anonymous: allowAnonymous,
        custom_questions: custom.map((q) => ({
          kind: q.kind,
          prompt: q.prompt,
          options: q.kind === 'choice' ? q.options.split('\n').map((o) => o.trim()).filter(Boolean) : [],
          is_required: q.is_required,
        })),
      })
      setData(d)
      fillForm(d)
      setEditing(false)
      showToast('Survey saved.', 'success')
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFieldErrors(err.fields)
      showToast(err instanceof ApiError ? err.message : 'Could not save the survey.', 'error')
    }
    setSaving(false)
  }

  async function setOpen(isOpen: boolean) {
    setToggling(true)
    try {
      const d = await api.patch<AdminData>(`/conferences/${conferenceId}/feedback-survey/open`, { is_open: isOpen })
      setData(d)
      showToast(isOpen ? 'The survey is open.' : 'The survey is closed - no more answers are accepted.', 'success')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not change this.', 'error')
    }
    setToggling(false)
    setConfirmOpen(null)
  }

  async function invite() {
    setInviting(true)
    try {
      const res = await api.post<{ sent: number; still_to_invite: number; quota: AdminData['quota'] }>(
        `/conferences/${conferenceId}/feedback-survey/invite`,
      )
      showToast(
        res.still_to_invite > 0
          ? `Queued ${res.sent} invitation${res.sent === 1 ? '' : 's'}. ${res.still_to_invite} more can be sent tomorrow (daily email limit).`
          : `Queued ${res.sent} invitation${res.sent === 1 ? '' : 's'}.`,
        'success',
      )
      await load()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not send the invitations.', 'error')
    }
    setInviting(false)
    setConfirmInvite(false)
  }

  const survey = data?.survey ?? null
  const locked = (data?.stats.responses ?? 0) > 0
  const showForm = data && (!survey || editing)
  const toSend = data ? Math.min(data.stats.not_invited, data.quota.remainingToday) : 0

  function updateCustom(i: number, patch: Partial<DraftQuestion>) {
    setCustom((prev) => prev.map((q, j) => (j === i ? { ...q, ...patch } : q)))
  }

  return (
    <div className="mt-6 max-w-4xl">
      <PageHeader
        title="Feedback survey"
        subtitle="A short post-conference survey for everyone who checked in, chaired or presented - with averages, charts and comments."
      />
      {error ? (
        <div className="mt-4">
          <Alert variant="danger">{error}</Alert>
        </div>
      ) : null}

      {!data ? (
        error ? null : <SkeletonText lines={6} className="mt-4" />
      ) : (
        <>
          {!survey && !editing ? (
            <div className="mt-4 rounded-lg border border-dashed border-border bg-surface">
              <EmptyState
                icon={<MessageSquareHeart aria-hidden />}
                title="No feedback survey yet."
                message="Start from the standard questions (overall, organisation, venue, sessions, best session, comments) and add your own."
                actionLabel="Create the survey"
                onAction={() => setEditing(true)}
              />
            </div>
          ) : null}

          {survey && !editing ? (
            <section className="mt-4 rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-text">{survey.title}</p>
                  <p className="text-sm text-text-muted">
                    {survey.opens_at && survey.closes_at
                      ? `${formatKathmandu(survey.opens_at)} – ${formatKathmandu(survey.closes_at)}`
                      : 'No dates set yet'}
                    {' · '}
                    {data.questions.length} questions · {survey.allow_anonymous ? 'anonymous answers allowed' : 'names always shown'}
                  </p>
                  <div className="mt-2">
                    <Badge tone={surveyState(survey).tone}>{surveyState(survey).label}</Badge>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                  <Button type="button" variant={survey.is_open ? 'secondary' : 'primary'} onClick={() => setConfirmOpen(!survey.is_open)}>
                    {survey.is_open ? 'Close survey' : 'Open survey'}
                  </Button>
                </div>
              </div>
            </section>
          ) : null}

          {showForm ? (
            <form onSubmit={save} className="mt-4 space-y-4 rounded-lg border border-border bg-surface p-4" noValidate>
              <h2 className="font-medium text-text">{survey ? 'Edit survey' : 'New survey'}</h2>
              <FormField label="Title" htmlFor="fs-title" required error={fieldErrors.title}>
                <Input id="fs-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
              </FormField>
              <FormField label="Introduction (optional)" htmlFor="fs-intro" error={fieldErrors.intro}>
                <Textarea id="fs-intro" rows={3} maxLength={2000} value={intro} onChange={(e) => setIntro(e.target.value)} />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Opens (Nepal time)" htmlFor="fs-opens" error={fieldErrors.opens_at}>
                  <Input id="fs-opens" type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
                </FormField>
                <FormField label="Closes (Nepal time)" htmlFor="fs-closes" error={fieldErrors.closes_at}>
                  <Input id="fs-closes" type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
                </FormField>
              </div>
              <Checkbox
                label="Let people answer anonymously (their name is never shown to you)"
                checked={allowAnonymous}
                onChange={(e) => setAllowAnonymous(e.target.checked)}
              />

              <div>
                <p className="text-sm font-medium text-text">Standard questions</p>
                <ul className="mt-1 space-y-1 text-sm text-text-muted">
                  {data.builtin_questions.map((q) => (
                    <li key={q.key}>
                      {q.prompt} <span className="text-xs">({KIND_LABELS[q.kind]}{q.is_required ? ', required' : ''})</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-sm font-medium text-text">Your own questions</p>
                {locked ? (
                  <p className="mt-1 text-xs text-text-muted">People have already answered, so the questions are locked.</p>
                ) : null}
                <div className="mt-2 space-y-3">
                  {custom.map((q, i) => (
                    <div key={i} className="rounded-md border border-border p-3">
                      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                        <FormField label={`Question ${i + 1}`} htmlFor={`fs-q-${i}`}>
                          <Input id={`fs-q-${i}`} value={q.prompt} maxLength={300} disabled={locked} onChange={(e) => updateCustom(i, { prompt: e.target.value })} />
                        </FormField>
                        <FormField label="Type" htmlFor={`fs-k-${i}`}>
                          <Select id={`fs-k-${i}`} value={q.kind} disabled={locked} onChange={(e) => updateCustom(i, { kind: e.target.value as CustomKind })}>
                            <option value="rating">{KIND_LABELS.rating}</option>
                            <option value="text">{KIND_LABELS.text}</option>
                            <option value="choice">{KIND_LABELS.choice}</option>
                          </Select>
                        </FormField>
                      </div>
                      {q.kind === 'choice' ? (
                        <FormField label="Options (one per line)" htmlFor={`fs-o-${i}`}>
                          <Textarea id={`fs-o-${i}`} rows={3} value={q.options} disabled={locked} onChange={(e) => updateCustom(i, { options: e.target.value })} />
                        </FormField>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <Checkbox label="Required" checked={q.is_required} disabled={locked} onChange={(e) => updateCustom(i, { is_required: e.target.checked })} />
                        <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => setCustom((prev) => prev.filter((_, j) => j !== i))}>
                          <Trash2 aria-hidden className="h-4 w-4" /> Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                {!locked && custom.length < 10 ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="mt-2"
                    onClick={() => setCustom((prev) => [...prev, { kind: 'rating', prompt: '', options: '', is_required: false }])}
                  >
                    <Plus aria-hidden className="h-4 w-4" /> Add question
                  </Button>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="submit" loading={saving}>
                  Save survey
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setEditing(false)
                    setFieldErrors({})
                    fillForm(data)
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}

          {survey ? (
            <section className="mt-6 rounded-lg border border-border bg-surface p-4">
              <h2 className="font-medium text-text">Invitations</h2>
              <p className="mt-1 text-sm text-text-muted">
                {data.stats.eligible} eligible · {data.stats.invited} invited · {data.stats.responses} answered · {data.stats.not_invited} not invited yet
              </p>
              <p className="mt-1 text-xs text-text-muted">
                {data.quota.remainingToday} of {data.quota.dailyLimit} emails left today. Anyone over the limit can be invited tomorrow.
              </p>
              {!data.conference.has_ended ? (
                <p className="mt-2 text-sm text-text-muted">
                  Invitations can be sent from the last day of the conference ({formatKathmandu(`${data.conference.end_date}T12:00:00Z`, { dateOnly: true })}).
                </p>
              ) : !survey.accepting_responses ? (
                <p className="mt-2 text-sm text-text-muted">Open the survey (inside its dates) to send invitations.</p>
              ) : null}
              <Button
                type="button"
                className="mt-3"
                disabled={!data.conference.has_ended || !survey.accepting_responses || toSend === 0}
                onClick={() => setConfirmInvite(true)}
              >
                <Mail aria-hidden className="h-4 w-4" /> Email {toSend} {toSend === 1 ? 'person' : 'people'}
              </Button>
            </section>
          ) : null}

          {survey ? (
            <section className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-medium text-text">Results</h2>
                {results ? (
                  <a href={`${API_BASE}/conferences/${conferenceId}/feedback-survey/results.xlsx`} className={buttonClasses('secondary', 'sm')}>
                    <Download aria-hidden className="h-4 w-4" /> Download Excel
                  </a>
                ) : null}
              </div>
              {!results ? (
                <div className="mt-3 rounded-lg border border-dashed border-border bg-surface">
                  <EmptyState
                    title="No answers yet."
                    message={
                      survey.accepting_responses
                        ? 'Send the invitations above - answers appear here as they come in.'
                        : 'Open the survey so people can answer; it also shows on their portal dashboard.'
                    }
                  />
                </div>
              ) : (
                <ResultsView results={results} />
              )}
            </section>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={confirmOpen !== null}
        title={confirmOpen ? 'Open the survey?' : 'Close the survey?'}
        message={
          confirmOpen
            ? 'Eligible people will see a "Give feedback" card in their portal while the survey is inside its dates.'
            : 'Nobody can answer after this. You can open it again later.'
        }
        confirmLabel={confirmOpen ? 'Open' : 'Close'}
        confirmVariant={confirmOpen ? 'primary' : 'danger'}
        busy={toggling}
        onConfirm={() => setOpen(Boolean(confirmOpen))}
        onCancel={() => setConfirmOpen(null)}
      />
      <ConfirmDialog
        open={confirmInvite}
        title={`Email ${toSend} ${toSend === 1 ? 'person' : 'people'}?`}
        message={`Each eligible person who hasn't been invited or answered yet gets one email with the survey link. This uses ${toSend} of today's ${data?.quota.remainingToday ?? 0} remaining emails.`}
        confirmLabel="Send"
        confirmVariant="primary"
        busy={inviting}
        onConfirm={invite}
        onCancel={() => setConfirmInvite(false)}
      />
    </div>
  )
}

function ResultsView({ results }: { results: Results }) {
  const rate = results.eligible_count > 0 ? Math.round((results.response_count / results.eligible_count) * 100) : 0
  return (
    <div className="mt-3 space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Responses" value={String(results.response_count)} />
        <StatTile label="Response rate" value={`${rate}%`} />
        <StatTile label="Overall rating" value={results.overall_average !== null ? `${results.overall_average.toFixed(2)} / 5` : '—'} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {results.questions
          .filter((q) => q.kind !== 'text')
          .map((q) => {
            if (q.kind === 'rating') {
              const rows = q.distribution.map((count, i) => ({ score: `${i + 1}`, count }))
              return (
                <ChartCard
                  key={q.id}
                  title={q.prompt}
                  subtitle={q.average !== null ? `Average ${q.average.toFixed(2)} / 5 · ${q.answered} answers` : 'No answers yet'}
                  empty={q.answered === 0}
                  table={<SimpleTable columns={['Score', 'Answers']} rows={rows.map((r) => [r.score, r.count])} />}
                >
                  <MagnitudeBar data={rows} xKey="score" yKey="count" yLabel="Answers" />
                </ChartCard>
              )
            }
            if (q.kind === 'choice' || q.kind === 'session') {
              const rows = q.counts.map((c) => ({ label: c.label, count: c.count }))
              return (
                <ChartCard
                  key={q.id}
                  title={q.prompt}
                  subtitle={`${q.answered} answers`}
                  empty={q.answered === 0}
                  table={<SimpleTable columns={['Answer', 'Count']} rows={rows.map((r) => [r.label, r.count])} />}
                >
                  <MagnitudeBar data={rows} xKey="label" yKey="count" yLabel="Answers" />
                </ChartCard>
              )
            }
            return null
          })}
      </div>
      {results.questions
        .filter((q) => q.kind === 'text')
        .map((q) =>
          q.kind === 'text' ? (
            <div key={q.id} className="rounded-lg border border-border bg-surface p-4">
              <h3 className="text-sm font-semibold text-text">{q.prompt}</h3>
              {q.comments.length === 0 ? (
                <p className="mt-2 text-sm text-text-muted">No comments yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border">
                  {q.comments.map((c, i) => (
                    <li key={i} className="py-2">
                      <p className="whitespace-pre-line text-sm text-text">{c.text}</p>
                      <p className="mt-0.5 text-xs text-text-muted">
                        {c.respondent_name ?? 'Anonymous'} · {formatKathmandu(c.submitted_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null,
        )}
    </div>
  )
}

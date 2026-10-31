import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Timer } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { useToast } from '../../components/ui/Toast'
import { Button, FormField, Input, SkeletonText, buttonClasses } from '../../components/ui'

type Timing = { talk_minutes: number; qa_minutes: number }

/** Conference-wide talk + Q&A time the session timer uses unless a session overrides it. */
export function TimerDefaultsSection({ conferenceId }: { conferenceId: string }) {
  const { showToast } = useToast()
  const [talk, setTalk] = useState('')
  const [qa, setQa] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fields, setFields] = useState<Record<string, string>>({})

  useEffect(() => {
    api
      .get<Timing>(`/conferences/${conferenceId}/timer-defaults`)
      .then((d) => {
        setTalk(String(d.talk_minutes))
        setQa(String(d.qa_minutes))
      })
      .catch((err) => showToast(err instanceof ApiError ? err.message : 'Could not load timer settings.', 'error'))
      .finally(() => setLoading(false))
  }, [conferenceId, showToast])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFields({})
    try {
      await api.put(`/conferences/${conferenceId}/timer-defaults`, { talk_minutes: talk, qa_minutes: qa })
      showToast('Timer defaults saved.', 'success')
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields)
      showToast(err instanceof ApiError ? err.message : 'Could not save timer defaults.', 'error')
    }
    setSaving(false)
  }

  return (
    <div className="mt-10">
      <h2 className="font-display text-xl font-semibold text-brand">Session timer</h2>
      <p className="mt-1 text-sm text-text-muted">
        Talk and Q&amp;A time for every talk on the session chairs' full-screen timer. Override it for one session from
        that session's <strong>Manage</strong> panel.
      </p>
      {loading ? (
        <SkeletonText lines={2} className="mt-3" />
      ) : (
        <form onSubmit={save} className="mt-3 flex flex-wrap items-end gap-3">
          <FormField label="Talk (minutes)" htmlFor="timer-default-talk" error={fields.talk_minutes}>
            <Input id="timer-default-talk" type="number" min={1} max={240} value={talk} onChange={(e) => setTalk(e.target.value)} className="w-32" />
          </FormField>
          <FormField label="Q&A (minutes)" htmlFor="timer-default-qa" error={fields.qa_minutes}>
            <Input id="timer-default-qa" type="number" min={0} max={120} value={qa} onChange={(e) => setQa(e.target.value)} className="w-32" />
          </FormField>
          <Button type="submit" variant="primary" loading={saving}>
            Save timer defaults
          </Button>
        </form>
      )}
    </div>
  )
}

/** Per-session override + "Open timer", shown inside the session's Manage panel. */
export function SessionTimerFields({ conferenceId, sessionId }: { conferenceId: string; sessionId: string }) {
  const { showToast } = useToast()
  const [defaults, setDefaults] = useState<Timing | null>(null)
  const [talk, setTalk] = useState('')
  const [qa, setQa] = useState('')
  const [saving, setSaving] = useState(false)
  const [fields, setFields] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ defaults: Timing; overrides: { talk_minutes: number | null; qa_minutes: number | null } }>(
        `/conferences/${conferenceId}/sessions/${sessionId}/timer`,
      )
      setDefaults(d.defaults)
      setTalk(d.overrides.talk_minutes === null ? '' : String(d.overrides.talk_minutes))
      setQa(d.overrides.qa_minutes === null ? '' : String(d.overrides.qa_minutes))
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not load timer settings.', 'error')
    }
  }, [conferenceId, sessionId, showToast])

  useEffect(() => {
    load()
  }, [load])

  async function save() {
    setSaving(true)
    setFields({})
    try {
      await api.put(`/conferences/${conferenceId}/sessions/${sessionId}/timer-settings`, {
        talk_minutes: talk.trim() === '' ? null : talk,
        qa_minutes: qa.trim() === '' ? null : qa,
      })
      showToast('Session timer saved.', 'success')
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields)
      showToast(err instanceof ApiError ? err.message : 'Could not save the session timer.', 'error')
    }
    setSaving(false)
  }

  return (
    <div className="mt-5 border-t border-border pt-4">
      <p className="text-sm font-medium text-text">Session timer</p>
      <p className="mt-1 text-xs text-text-muted">
        Leave blank to use the conference default
        {defaults ? ` (${defaults.talk_minutes} min talk + ${defaults.qa_minutes} min Q&A)` : ''}.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <FormField label="Talk (min)" htmlFor={`timer-talk-${sessionId}`} error={fields.talk_minutes}>
          <Input
            id={`timer-talk-${sessionId}`}
            type="number"
            min={1}
            max={240}
            value={talk}
            placeholder={defaults ? String(defaults.talk_minutes) : ''}
            onChange={(e) => setTalk(e.target.value)}
            className="w-24"
          />
        </FormField>
        <FormField label="Q&A (min)" htmlFor={`timer-qa-${sessionId}`} error={fields.qa_minutes}>
          <Input
            id={`timer-qa-${sessionId}`}
            type="number"
            min={0}
            max={120}
            value={qa}
            placeholder={defaults ? String(defaults.qa_minutes) : ''}
            onChange={(e) => setQa(e.target.value)}
            className="w-24"
          />
        </FormField>
        <Button type="button" variant="secondary" size="sm" onClick={save} loading={saving}>
          Save timer
        </Button>
        <Link to={`/timer/${conferenceId}/${sessionId}`} className={buttonClasses('outline', 'sm')}>
          <Timer aria-hidden className="h-4 w-4" /> Open timer
        </Link>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { Eye, Send } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { RECIPIENT_GROUP_LABELS, bulkEmailSchema, type RecipientGroup } from '../../lib/validation'
import { formatKathmandu } from '../../lib/datetime'
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, FormField, Input, PageHeader, Spinner, Textarea } from '../../components/ui'
import { Icon } from '../../components/ui/Icon'
import { useToast } from '../../components/ui/Toast'

/** changes-nov2, Part 5: Communication -> Post-conference email (sent through the existing bulk email queue). */
type SentEmail = {
  id: string
  subject: string
  recipient_groups: RecipientGroup[]
  recipient_count: number
  sent_count: number
  failed_count: number
  created_by_name: string
  sent_at: string | null
}

type State = {
  ended: boolean
  end_date: string
  groups: RecipientGroup[]
  defaults: { subject: string; body_html: string }
  sent: SentEmail[]
}

export function PostConferenceEmailTab({ conferenceId }: { conferenceId: string }) {
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [groups, setGroups] = useState<RecipientGroup[]>(['attendees_registered'])
  const [count, setCount] = useState<number | null>(null)
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState<'preview' | 'send' | null>(null)
  const { showToast } = useToast()

  const load = useCallback(async (resetForm: boolean) => {
    try {
      const res = await api.get<State>(`/conferences/${conferenceId}/post-conference-email`)
      setState(res)
      if (resetForm) {
        setSubject(res.defaults.subject)
        setBody(res.defaults.body_html)
      }
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the post-conference email.')
    }
  }, [conferenceId])

  useEffect(() => {
    load(true)
  }, [load])

  useEffect(() => {
    if (groups.length === 0) {
      setCount(0)
      return
    }
    let cancelled = false
    api
      .post<{ count: number }>(`/conferences/${conferenceId}/bulk-email/recipients-preview`, { groups })
      .then((r) => {
        if (!cancelled) setCount(r.count)
      })
      .catch(() => {
        if (!cancelled) setCount(null)
      })
    return () => {
      cancelled = true
    }
  }, [conferenceId, groups])

  function toggle(g: RecipientGroup) {
    setGroups((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]))
  }

  function validated() {
    const parsed = bulkEmailSchema.safeParse({ subject, body_html: body, recipient_groups: groups })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form.')
      return null
    }
    return parsed.data
  }

  async function showPreview() {
    const data = validated()
    if (!data) return
    setBusy('preview')
    setError(null)
    try {
      setPreview(await api.post<{ subject: string; html: string }>(`/conferences/${conferenceId}/bulk-email/content-preview`, data))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not build the preview.')
    } finally {
      setBusy(null)
    }
  }

  async function send() {
    const data = validated()
    setConfirming(false)
    if (!data) return
    setBusy('send')
    setError(null)
    try {
      const res = await api.post<{ recipient_count: number }>(`/conferences/${conferenceId}/post-conference-email/send`, data)
      showToast(`Queued for ${res.recipient_count} ${res.recipient_count === 1 ? 'person' : 'people'}.`, 'success')
      setPreview(null)
      await load(false)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not send the email.'
      setError(message)
      showToast(message, 'error')
    } finally {
      setBusy(null)
    }
  }

  if (!state) {
    return error ? (
      <div className="mt-6">
        <Alert variant="danger">{error}</Alert>
      </div>
    ) : (
      <div className="mt-6 flex items-center gap-2 text-sm text-text-muted">
        <Spinner size="sm" /> Loading…
      </div>
    )
  }

  const disabled = !state.ended

  return (
    <div className="mt-6 max-w-3xl space-y-6">
      <PageHeader
        title="Post-conference email"
        subtitle="Thank everyone after the conference and point them to certificates, the report, publication details and the archive."
      />

      {disabled ? (
        <div data-testid="post-conference-disabled">
          <Alert variant="info">
            You can send this email once the conference has ended (after {formatKathmandu(state.end_date, { dateOnly: true })}, Nepal time).
          </Alert>
        </div>
      ) : null}
      {state.sent.length > 0 ? (
        <Alert variant="warning">
          A post-conference email has already been sent ({state.sent.length === 1 ? 'once' : `${state.sent.length} times`}). Sending again emails people a second time.
        </Alert>
      ) : null}
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <Card>
        <fieldset disabled={disabled || busy === 'send'} className="space-y-4 disabled:opacity-60">
          <div>
            <p className="text-sm font-medium text-text">Recipients</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {state.groups.map((g) => (
                <Checkbox key={g} label={RECIPIENT_GROUP_LABELS[g] ?? g} checked={groups.includes(g)} onChange={() => toggle(g)} />
              ))}
            </div>
            <p className="mt-2 text-xs text-text-muted" aria-live="polite">
              {count === null ? 'Counting recipients…' : `${count} ${count === 1 ? 'person' : 'people'} (each person once, even in several groups)`}
            </p>
          </div>
          <FormField label="Subject" htmlFor="pc-subject">
            <Input id="pc-subject" value={subject} maxLength={300} onChange={(e) => setSubject(e.target.value)} />
          </FormField>
          <FormField label="Message (HTML)" htmlFor="pc-body" help="Placeholders: {{first_name}}, {{conference_name}}, {{conference_url}}">
            <Textarea id="pc-body" rows={12} value={body} onChange={(e) => setBody(e.target.value)} />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" loading={busy === 'preview'} onClick={showPreview} iconLeft={<Icon icon={Eye} size={16} />}>
              Preview
            </Button>
            <Button
              type="button"
              loading={busy === 'send'}
              disabled={!preview || groups.length === 0 || count === 0}
              onClick={() => setConfirming(true)}
              iconLeft={<Icon icon={Send} size={16} />}
            >
              Send
            </Button>
          </div>
          {!preview && !disabled ? <p className="text-xs text-text-muted">Preview the email before sending.</p> : null}
        </fieldset>
        {preview ? (
          <div className="mt-4">
            <p className="text-sm font-medium text-text">{preview.subject}</p>
            <iframe title="Post-conference email preview" sandbox="" srcDoc={preview.html} className="mt-2 h-80 w-full rounded-md border border-border bg-surface" />
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Sent" />
        {state.sent.length === 0 ? (
          <p className="text-sm text-text-muted">Nothing sent yet.</p>
        ) : (
          <ul className="divide-y divide-border-soft text-sm" data-testid="post-conference-sent">
            {state.sent.map((s) => {
              const queued = s.recipient_count - s.sent_count - s.failed_count
              return (
                <li key={s.id} className="py-3">
                  <p className="font-medium text-text">{s.subject}</p>
                  <p className="mt-1 text-xs text-text-muted">
                    {s.sent_at ? formatKathmandu(s.sent_at) : ''} · by {s.created_by_name} · {s.recipient_groups.map((g) => RECIPIENT_GROUP_LABELS[g] ?? g).join(', ')}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge tone="neutral">{s.recipient_count} queued</Badge>
                    <Badge tone="success">{s.sent_count} sent</Badge>
                    {queued > 0 ? <Badge tone="info">{queued} waiting</Badge> : null}
                    {s.failed_count > 0 ? <Badge tone="danger">{s.failed_count} failed</Badge> : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={confirming}
        title="Send the post-conference email?"
        message={
          <>
            This queues the email for {count ?? 0} {count === 1 ? 'person' : 'people'}. It cannot be undone.
            {state.sent.length > 0 ? ' A post-conference email was already sent - people will receive another one.' : ''}
          </>
        }
        confirmLabel="Send"
        confirmVariant="primary"
        busy={busy === 'send'}
        onConfirm={send}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}

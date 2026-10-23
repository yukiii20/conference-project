import { useCallback, useEffect, useState } from 'react'
import { Save, Send, Trash2 } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { ANNOUNCEMENT_AUDIENCES, announcementSchema, type AnnouncementInput } from '../../lib/validation'
import { PageHeader, Card, Badge, Button, Input, Textarea, Checkbox, Alert, Spinner } from '../../components/ui'
import { Icon } from '../../components/ui/Icon'

type Announcement = {
  id: string
  title: string
  body: string
  audience: string[]
  status: 'draft' | 'scheduled' | 'published' | 'archived'
  publish_at: string | null
  send_email: boolean
  created_at: string
}

const AUDIENCE_LABELS: Record<(typeof ANNOUNCEMENT_AUDIENCES)[number], string> = {
  all: 'Everyone',
  authors: 'Authors',
  reviewers: 'Reviewers',
  session_chairs: 'Session chairs',
  staff: 'Staff',
}

const STATUS_LABELS: Record<Announcement['status'], string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  published: 'Published',
  archived: 'Archived',
}

const EMPTY: AnnouncementInput = { title: '', body: '', audience: ['all'], status: 'draft', publish_at: '', send_email: false }

export function AnnouncementsTab({ conferenceId }: { conferenceId: string }) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [form, setForm] = useState<AnnouncementInput>(EMPTY)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ announcements: Announcement[] }>(`/conferences/${conferenceId}/announcements`)
      setAnnouncements(data.announcements)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load announcements.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load])

  function toggleAudience(aud: (typeof ANNOUNCEMENT_AUDIENCES)[number]) {
    setForm((p) => ({
      ...p,
      audience: p.audience.includes(aud) ? p.audience.filter((a) => a !== aud) : [...p.audience, aud],
    }))
  }

  async function handleSubmit(e: React.FormEvent, status: 'draft' | 'scheduled' | 'published') {
    e.preventDefault()
    setFormError(null)
    const candidate = { ...form, status, publish_at: status === 'scheduled' ? form.publish_at : undefined }
    const parsed = announcementSchema.safeParse(candidate)
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Please check the form.')
      return
    }
    if (status === 'scheduled' && !parsed.data.publish_at) {
      setFormError('Set a publish date for a scheduled announcement.')
      return
    }
    setSaving(true)
    try {
      await api.post(`/conferences/${conferenceId}/announcements`, {
        ...parsed.data,
        publish_at: parsed.data.publish_at ? new Date(parsed.data.publish_at).toISOString() : undefined,
      })
      setForm(EMPTY)
      await load()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save this announcement.')
    } finally {
      setSaving(false)
    }
  }

  async function handlePublishNow(a: Announcement) {
    setBusyId(a.id)
    try {
      await api.post(`/conferences/${conferenceId}/announcements/${a.id}/publish`)
      await load()
    } catch {
      // Row stays as-is; the convenor can retry.
    } finally {
      setBusyId(null)
    }
  }

  async function handleArchive(a: Announcement) {
    setBusyId(a.id)
    try {
      await api.post(`/conferences/${conferenceId}/announcements/${a.id}/archive`)
      await load()
    } catch {
      // Row stays as-is; the convenor can retry.
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(a: Announcement) {
    setBusyId(a.id)
    try {
      await api.del(`/conferences/${conferenceId}/announcements/${a.id}`)
      await load()
    } catch {
      // Row stays as-is; the convenor can retry.
    } finally {
      setBusyId(null)
    }
  }

  if (loading)
    return (
      <div className="mt-6 flex items-center gap-2 text-sm text-text-muted">
        <Spinner size="sm" /> Loading…
      </div>
    )

  return (
    <div className="mt-6 max-w-3xl space-y-6">
      <PageHeader title="Announcements" subtitle="Draft, schedule, and publish announcements to the conference." />
      {error ? <Alert variant="danger">{error}</Alert> : null}

      {announcements.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-sm text-text-muted">No announcements yet.</p>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => (
            <Card key={a.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-text">{a.title}</p>
                <Badge tone="neutral">{STATUS_LABELS[a.status]}</Badge>
              </div>
              <p className="mt-1 whitespace-pre-line text-sm text-text-muted">{a.body}</p>
              <p className="mt-2 text-xs text-text-muted">
                Audience: {a.audience.map((aud) => AUDIENCE_LABELS[aud as keyof typeof AUDIENCE_LABELS] ?? aud).join(', ')}
                {a.status === 'scheduled' && a.publish_at ? ` · publishes ${new Date(a.publish_at).toLocaleString()}` : ''}
              </p>
              {(a.status === 'draft' || a.status === 'scheduled') && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handlePublishNow(a)}
                    disabled={busyId === a.id}
                    iconLeft={<Icon icon={Send} size={16} />}
                  >
                    Publish now
                  </Button>
                  {a.status === 'draft' ? (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDelete(a)}
                      disabled={busyId === a.id}
                      iconLeft={<Icon icon={Trash2} size={16} />}
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              )}
              {a.status === 'published' ? (
                <Button variant="secondary" size="sm" className="mt-3" onClick={() => handleArchive(a)} disabled={busyId === a.id}>
                  Archive
                </Button>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      <form className="rounded-lg border border-dashed border-border bg-surface p-4">
        <p className="font-medium text-text">New announcement</p>
        {formError ? (
          <div className="mt-2">
            <Alert variant="danger">{formError}</Alert>
          </div>
        ) : null}
        <Input
          value={form.title}
          onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
          placeholder="Title"
          className="mt-3"
        />
        <Textarea
          value={form.body}
          onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))}
          placeholder="Announcement text"
          rows={3}
          className="mt-3"
        />
        <div className="mt-3 flex flex-wrap gap-3">
          {ANNOUNCEMENT_AUDIENCES.map((aud) => (
            <Checkbox key={aud} label={AUDIENCE_LABELS[aud]} checked={form.audience.includes(aud)} onChange={() => toggleAudience(aud)} />
          ))}
        </div>
        <div className="mt-3">
          <Checkbox
            label="Also send an email"
            checked={form.send_email}
            onChange={(e) => setForm((p) => ({ ...p, send_email: e.target.checked }))}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            type="datetime-local"
            value={form.publish_at}
            onChange={(e) => setForm((p) => ({ ...p, publish_at: e.target.value }))}
            className="w-auto"
          />
          <Button type="button" variant="secondary" disabled={saving} onClick={(e) => handleSubmit(e, 'scheduled')}>
            Schedule
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={(e) => handleSubmit(e, 'draft')}
            iconLeft={<Icon icon={Save} size={16} />}
          >
            Save as draft
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={saving}
            loading={saving}
            onClick={(e) => handleSubmit(e, 'published')}
            iconLeft={<Icon icon={Send} size={16} />}
          >
            {saving ? 'Publishing…' : 'Publish now'}
          </Button>
        </div>
      </form>
    </div>
  )
}

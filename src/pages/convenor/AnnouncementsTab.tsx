import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { ANNOUNCEMENT_AUDIENCES, announcementSchema, type AnnouncementInput } from '../../lib/validation'

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

  if (loading) return <p className="mt-6 text-sm text-ink/60">Loading…</p>

  return (
    <div className="mt-6 max-w-3xl space-y-6">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {announcements.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">No announcements yet.</p>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => (
            <div key={a.id} className="rounded-lg border border-line bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-ink">{a.title}</p>
                <span className="rounded-full bg-background px-2 py-0.5 text-xs text-ink/70">{STATUS_LABELS[a.status]}</span>
              </div>
              <p className="mt-1 whitespace-pre-line text-sm text-ink/70">{a.body}</p>
              <p className="mt-2 text-xs text-ink/50">
                Audience: {a.audience.map((aud) => AUDIENCE_LABELS[aud as keyof typeof AUDIENCE_LABELS] ?? aud).join(', ')}
                {a.status === 'scheduled' && a.publish_at ? ` · publishes ${new Date(a.publish_at).toLocaleString()}` : ''}
              </p>
              {(a.status === 'draft' || a.status === 'scheduled') && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => handlePublishNow(a)} disabled={busyId === a.id} className="rounded-md bg-button px-3 py-1 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
                    Publish now
                  </button>
                  {a.status === 'draft' ? (
                    <button type="button" onClick={() => handleDelete(a)} disabled={busyId === a.id} className="rounded-md border border-red-200 px-3 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">
                      Delete
                    </button>
                  ) : null}
                </div>
              )}
              {a.status === 'published' ? (
                <button type="button" onClick={() => handleArchive(a)} disabled={busyId === a.id} className="mt-3 rounded-md border border-line px-3 py-1 text-sm hover:bg-background disabled:opacity-50">
                  Archive
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <form className="rounded-lg border border-dashed border-line bg-white p-4">
        <p className="font-medium text-ink">New announcement</p>
        {formError ? <p className="mt-2 text-sm text-red-600">{formError}</p> : null}
        <input
          value={form.title}
          onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
          placeholder="Title"
          className="mt-3 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        <textarea
          value={form.body}
          onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))}
          placeholder="Announcement text"
          rows={3}
          className="mt-3 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        <div className="mt-3 flex flex-wrap gap-3">
          {ANNOUNCEMENT_AUDIENCES.map((aud) => (
            <label key={aud} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={form.audience.includes(aud)} onChange={() => toggleAudience(aud)} />
              {AUDIENCE_LABELS[aud]}
            </label>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={form.send_email} onChange={(e) => setForm((p) => ({ ...p, send_email: e.target.checked }))} />
          Also send an email
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="datetime-local"
            value={form.publish_at}
            onChange={(e) => setForm((p) => ({ ...p, publish_at: e.target.value }))}
            className="rounded-md border border-line px-3 py-2 text-sm focus:border-button"
          />
          <button type="button" disabled={saving} onClick={(e) => handleSubmit(e, 'scheduled')} className="rounded-md border border-line px-4 py-2 text-sm font-medium hover:bg-background disabled:opacity-50">
            Schedule
          </button>
          <button type="button" disabled={saving} onClick={(e) => handleSubmit(e, 'draft')} className="rounded-md border border-line px-4 py-2 text-sm font-medium hover:bg-background disabled:opacity-50">
            Save as draft
          </button>
          <button type="button" disabled={saving} onClick={(e) => handleSubmit(e, 'published')} className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {saving ? 'Publishing…' : 'Publish now'}
          </button>
        </div>
      </form>
    </div>
  )
}

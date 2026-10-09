import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { reviewSettingsSchema, type ReviewSettingsInput } from '../../lib/validation'

type Settings = {
  review_mode: 'open' | 'single_blind' | 'double_blind'
  reviews_required: number
  max_submissions_per_author: number | null
  max_abstract_words: number
  max_file_size_mb: number
  allowed_file_types: string[]
  authors_see_review_comments: boolean
}

const REVIEW_MODE_LABELS: Record<Settings['review_mode'], string> = {
  open: 'Open — reviewers and authors see each other',
  single_blind: 'Single-blind — reviewers see authors, authors do not see reviewers',
  double_blind: 'Double-blind — neither side sees the other',
}

export function ReviewSettingsTab({ conferenceId }: { conferenceId: string }) {
  const [form, setForm] = useState<Settings | null>(null)
  const [fileTypesText, setFileTypesText] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ settings: Settings }>(`/conferences/${conferenceId}/settings`)
      setForm(data.settings)
      setFileTypesText(data.settings.allowed_file_types.join(', '))
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load review settings.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    setFormError(null)
    setSaved(false)

    const candidate: ReviewSettingsInput = {
      ...form,
      allowed_file_types: fileTypesText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    }
    const parsed = reviewSettingsSchema.safeParse(candidate)
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (typeof key === 'string' && !(key in fieldErrors)) fieldErrors[key] = issue.message
      }
      setErrors(fieldErrors)
      return
    }
    setErrors({})
    setSaving(true)
    try {
      await api.patch(`/conferences/${conferenceId}/settings`, parsed.data)
      setSaved(true)
      await load()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save these settings.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="mt-6 text-sm text-ink/60">Loading…</p>
  if (loadError || !form) return <p className="mt-6 text-sm text-red-600">{loadError ?? 'Could not load review settings.'}</p>

  return (
    <form onSubmit={handleSubmit} className="mt-6 max-w-2xl space-y-5">
      {formError ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {formError}
        </div>
      ) : null}
      {saved ? <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">Saved.</div> : null}

      <div>
        <label className="block text-sm font-medium text-ink">Review mode</label>
        <p className="mt-1 text-xs text-ink/50">Whether reviewers and authors can see each other's identity.</p>
        <select
          value={form.review_mode}
          onChange={(e) => setForm({ ...form, review_mode: e.target.value as Settings['review_mode'] })}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        >
          {(['double_blind', 'single_blind', 'open'] as const).map((m) => (
            <option key={m} value={m}>
              {REVIEW_MODE_LABELS[m]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-ink">Reviews required per paper</label>
        <p className="mt-1 text-xs text-ink/50">How many submitted reviews before a decision is expected.</p>
        <input
          type="number"
          min={1}
          max={10}
          value={form.reviews_required}
          onChange={(e) => setForm({ ...form, reviews_required: Number(e.target.value) })}
          className="mt-1 w-32 rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.reviews_required ? <p className="mt-1 text-sm text-red-600">{errors.reviews_required}</p> : null}
      </div>

      <div>
        <label className="block text-sm font-medium text-ink">Max submissions per author</label>
        <p className="mt-1 text-xs text-ink/50">Leave blank for no limit.</p>
        <input
          type="number"
          min={1}
          value={form.max_submissions_per_author ?? ''}
          onChange={(e) => setForm({ ...form, max_submissions_per_author: e.target.value ? Number(e.target.value) : null })}
          className="mt-1 w-32 rounded-md border border-line px-3 py-2 focus:border-button"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink">Max abstract words</label>
        <p className="mt-1 text-xs text-ink/50">Enforced when an author submits an abstract.</p>
        <input
          type="number"
          min={50}
          max={2000}
          value={form.max_abstract_words}
          onChange={(e) => setForm({ ...form, max_abstract_words: Number(e.target.value) })}
          className="mt-1 w-32 rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.max_abstract_words ? <p className="mt-1 text-sm text-red-600">{errors.max_abstract_words}</p> : null}
      </div>

      <div>
        <label className="block text-sm font-medium text-ink">Max file size (MB)</label>
        <p className="mt-1 text-xs text-ink/50">Applies to every file an author or reviewer uploads.</p>
        <input
          type="number"
          min={1}
          max={100}
          value={form.max_file_size_mb}
          onChange={(e) => setForm({ ...form, max_file_size_mb: Number(e.target.value) })}
          className="mt-1 w-32 rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.max_file_size_mb ? <p className="mt-1 text-sm text-red-600">{errors.max_file_size_mb}</p> : null}
      </div>

      <div>
        <label className="block text-sm font-medium text-ink">Allowed file types</label>
        <p className="mt-1 text-xs text-ink/50">Comma-separated extensions, e.g. pdf, doc, docx.</p>
        <input
          value={fileTypesText}
          onChange={(e) => setFileTypesText(e.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.allowed_file_types ? <p className="mt-1 text-sm text-red-600">{errors.allowed_file_types}</p> : null}
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={form.authors_see_review_comments}
          onChange={(e) => setForm({ ...form, authors_see_review_comments: e.target.checked })}
        />
        Authors can see reviewers' comments (never confidential comments or reviewer names)
      </label>

      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save settings'}
      </button>
    </form>
  )
}

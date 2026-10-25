import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { fromKathmanduInputValue, toKathmanduInputValue } from '../../lib/datetime'
import { reviewSettingsSchema, type ReviewSettingsInput } from '../../lib/validation'
import { useToast } from '../../components/ui/Toast'
import { PageHeader, FormField, Select, Input, Checkbox, Button, Alert, Spinner } from '../../components/ui'

type Settings = {
  review_mode: 'open' | 'single_blind' | 'double_blind'
  reviews_required: number
  max_submissions_per_author: number | null
  max_abstract_words: number
  max_file_size_mb: number
  allowed_file_types: string[]
  authors_see_review_comments: boolean
  bidding_enabled: boolean
  bidding_start_at: string | null
  bidding_end_at: string | null
  registration_requires_payment: boolean
  session_attendance_enabled: boolean
  certificate_min_sessions: number | null
  default_currency: string
  review_reminders_enabled: boolean
  review_reminder_days_before: number[]
  review_overdue_reminder_enabled: boolean
}

const REVIEW_MODE_LABELS: Record<Settings['review_mode'], string> = {
  open: 'Open — reviewers and authors see each other',
  single_blind: 'Single-blind — reviewers see authors, authors do not see reviewers',
  double_blind: 'Double-blind — neither side sees the other',
}

export function ReviewSettingsTab({ conferenceId }: { conferenceId: string }) {
  const [form, setForm] = useState<Settings | null>(null)
  const [fileTypesText, setFileTypesText] = useState('')
  const [biddingStartLocal, setBiddingStartLocal] = useState('')
  const [biddingEndLocal, setBiddingEndLocal] = useState('')
  const [reminderDaysText, setReminderDaysText] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { showToast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ settings: Settings }>(`/conferences/${conferenceId}/settings`)
      setForm(data.settings)
      setFileTypesText(data.settings.allowed_file_types.join(', '))
      setBiddingStartLocal(data.settings.bidding_start_at ? toKathmanduInputValue(data.settings.bidding_start_at) : '')
      setBiddingEndLocal(data.settings.bidding_end_at ? toKathmanduInputValue(data.settings.bidding_end_at) : '')
      setReminderDaysText(data.settings.review_reminder_days_before.join(', '))
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

    const candidate: ReviewSettingsInput = {
      ...form,
      allowed_file_types: fileTypesText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      bidding_start_at: biddingStartLocal ? fromKathmanduInputValue(biddingStartLocal) : null,
      bidding_end_at: biddingEndLocal ? fromKathmanduInputValue(biddingEndLocal) : null,
      review_reminder_days_before: reminderDaysText
        .split(',')
        .map((t) => Number(t.trim()))
        .filter((n) => Number.isFinite(n) && n > 0),
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
      showToast('Saved.', 'success')
      await load()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not save these settings.'
      setFormError(message)
      showToast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading)
    return (
      <div className="mt-6 flex items-center gap-2 text-sm text-text-muted">
        <Spinner size="sm" /> Loading…
      </div>
    )
  if (loadError || !form) return <Alert variant="danger">{loadError ?? 'Could not load review settings.'}</Alert>

  return (
    <form onSubmit={handleSubmit} className="mt-6 max-w-2xl space-y-5">
      <PageHeader title="Review settings" subtitle="How papers are reviewed, assigned, and decided for this conference." className="mb-0" />
      {formError ? <Alert variant="danger">{formError}</Alert> : null}

      <FormField label="Review mode" help="Whether reviewers and authors can see each other's identity.">
        <Select
          value={form.review_mode}
          onChange={(e) => setForm({ ...form, review_mode: e.target.value as Settings['review_mode'] })}
        >
          {(['double_blind', 'single_blind', 'open'] as const).map((m) => (
            <option key={m} value={m}>
              {REVIEW_MODE_LABELS[m]}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField
        label="Reviews required per paper"
        help={errors.reviews_required ? undefined : 'How many submitted reviews before a decision is expected.'}
        error={errors.reviews_required}
      >
        <Input
          type="number"
          min={1}
          max={10}
          value={form.reviews_required}
          onChange={(e) => setForm({ ...form, reviews_required: Number(e.target.value) })}
          className="w-32"
          error={Boolean(errors.reviews_required)}
        />
      </FormField>

      <FormField label="Max submissions per author" help="Leave blank for no limit.">
        <Input
          type="number"
          min={1}
          value={form.max_submissions_per_author ?? ''}
          onChange={(e) => setForm({ ...form, max_submissions_per_author: e.target.value ? Number(e.target.value) : null })}
          className="w-32"
        />
      </FormField>

      <FormField
        label="Max abstract words"
        help={errors.max_abstract_words ? undefined : 'Enforced when an author submits an abstract.'}
        error={errors.max_abstract_words}
      >
        <Input
          type="number"
          min={50}
          max={2000}
          value={form.max_abstract_words}
          onChange={(e) => setForm({ ...form, max_abstract_words: Number(e.target.value) })}
          className="w-32"
          error={Boolean(errors.max_abstract_words)}
        />
      </FormField>

      <FormField
        label="Max file size (MB)"
        help={errors.max_file_size_mb ? undefined : 'Applies to every file an author or reviewer uploads.'}
        error={errors.max_file_size_mb}
      >
        <Input
          type="number"
          min={1}
          max={100}
          value={form.max_file_size_mb}
          onChange={(e) => setForm({ ...form, max_file_size_mb: Number(e.target.value) })}
          className="w-32"
          error={Boolean(errors.max_file_size_mb)}
        />
      </FormField>

      <FormField
        label="Allowed file types"
        help={errors.allowed_file_types ? undefined : 'Comma-separated extensions, e.g. pdf, doc, docx.'}
        error={errors.allowed_file_types}
      >
        <Input value={fileTypesText} onChange={(e) => setFileTypesText(e.target.value)} error={Boolean(errors.allowed_file_types)} />
      </FormField>

      <Checkbox
        label="Authors can see reviewers' comments (never confidential comments or reviewer names)"
        checked={form.authors_see_review_comments}
        onChange={(e) => setForm({ ...form, authors_see_review_comments: e.target.checked })}
      />

      <div className="border-t border-border pt-5">
        <h2 className="text-sm font-semibold text-text">Reviewer bidding</h2>
        <p className="mt-1 text-sm text-text-muted">
          While a bidding period is open, reviewers can say which papers they want, can, or don't want to review from
          the "Bid on papers" screen in their portal.
        </p>

        <div className="mt-3">
          <Checkbox
            label="Enable a bidding period"
            checked={form.bidding_enabled}
            onChange={(e) => setForm({ ...form, bidding_enabled: e.target.checked })}
          />
        </div>

        {form.bidding_enabled ? (
          <div className="mt-3 flex flex-wrap gap-3">
            <FormField label="Bidding opens" error={errors.bidding_start_at}>
              <Input
                type="datetime-local"
                value={biddingStartLocal}
                onChange={(e) => setBiddingStartLocal(e.target.value)}
                error={Boolean(errors.bidding_start_at)}
              />
            </FormField>
            <FormField label="Bidding closes" error={errors.bidding_end_at}>
              <Input
                type="datetime-local"
                value={biddingEndLocal}
                onChange={(e) => setBiddingEndLocal(e.target.value)}
                error={Boolean(errors.bidding_end_at)}
              />
            </FormField>
          </div>
        ) : null}
      </div>

      <div className="border-t border-border pt-5">
        <h2 className="text-sm font-semibold text-text">Review reminders</h2>
        <p className="mt-1 text-sm text-text-muted">
          An automatic hourly check nudges reviewers who haven't submitted yet. "Send reminder now" and "Remind all" on
          the Reviewers tab always send regardless of this switch.
        </p>

        <div className="mt-3">
          <Checkbox
            label="Send automatic reminders before a review is due"
            checked={form.review_reminders_enabled}
            onChange={(e) => setForm({ ...form, review_reminders_enabled: e.target.checked })}
          />
        </div>

        {form.review_reminders_enabled ? (
          <div className="mt-3">
            <FormField
              label="Days before due date"
              help={errors.review_reminder_days_before ? undefined : 'Comma-separated, e.g. 3, 1.'}
              error={errors.review_reminder_days_before}
            >
              <Input
                value={reminderDaysText}
                onChange={(e) => setReminderDaysText(e.target.value)}
                className="w-40"
                error={Boolean(errors.review_reminder_days_before)}
              />
            </FormField>
          </div>
        ) : null}

        <div className="mt-3">
          <Checkbox
            label="Also send one reminder after a review becomes overdue"
            checked={form.review_overdue_reminder_enabled}
            onChange={(e) => setForm({ ...form, review_overdue_reminder_enabled: e.target.checked })}
          />
        </div>
      </div>

      <div className="border-t border-border pt-5">
        <h2 className="text-sm font-semibold text-text">Registration, attendance and certificates</h2>

        <div className="mt-3">
          <Checkbox
            label='Registration requires payment (leaves new registrations "pending" until confirmed manually)'
            checked={form.registration_requires_payment}
            onChange={(e) => setForm({ ...form, registration_requires_payment: e.target.checked })}
          />
        </div>

        <div className="mt-3">
          <Checkbox
            label="Enable per-session attendance check-in"
            checked={form.session_attendance_enabled}
            onChange={(e) => setForm({ ...form, session_attendance_enabled: e.target.checked })}
          />
        </div>

        <div className="mt-3">
          <FormField label="Minimum sessions for a participation certificate" help="Leave blank to require only a conference check-in.">
            <Input
              type="number"
              min={1}
              value={form.certificate_min_sessions ?? ''}
              onChange={(e) => setForm({ ...form, certificate_min_sessions: e.target.value ? Number(e.target.value) : null })}
              className="w-32"
            />
          </FormField>
        </div>

        <div className="mt-3">
          <FormField label="Default currency" error={errors.default_currency}>
            <Input
              value={form.default_currency}
              onChange={(e) => setForm({ ...form, default_currency: e.target.value })}
              maxLength={3}
              className="w-24 uppercase"
              error={Boolean(errors.default_currency)}
            />
          </FormField>
        </div>
      </div>

      <Button type="submit" variant="primary" disabled={saving} loading={saving}>
        {saving ? 'Saving…' : 'Save settings'}
      </Button>
    </form>
  )
}

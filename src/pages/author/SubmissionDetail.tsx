import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'
import { downloadSubmissionFile, uploadSubmissionFile, validateSubmissionFile, SUBMISSION_FILE_RULES } from '../../lib/submissionFiles'
import { buildSubmissionSchema, coAuthorSchema, type CoAuthorInput } from '../../lib/validation'
import {
  FILE_KIND_LABELS,
  SUBMISSION_STATUS_LABELS,
  statusBadgeClass,
} from '../../lib/submissionDisplay'

type Track = { id: string; name: string }

type Author = {
  id: string
  author_order: number
  full_name: string
  email: string
  affiliation: string | null
  country: string | null
  is_corresponding: boolean
}

type FileRow = {
  id: string
  file_kind: string
  version: number
  status: string
  original_filename: string
  uploaded_at: string
}

type HistoryRow = {
  id: number
  from_status: string | null
  to_status: string
  reason: string | null
  changed_at: string
}

type Feedback = {
  decisions: Array<{ stage: string; decision: string; comments_to_author: string | null; decided_at: string }>
  reviews: Array<{ review_number: number; comments_to_author: string | null; overall_score: number | null; recommendation: string | null }>
}

type CanUpload = { abstract: boolean; full_paper: boolean; slides: boolean; camera_ready: boolean }

type SubmissionDetailData = {
  id: string
  submission_code: string | null
  title: string
  abstract: string
  keywords: string[]
  presentation_preference: 'oral' | 'poster' | 'either'
  track_id: string
  status: string
  authors: Author[]
  files: FileRow[]
  status_history: HistoryRow[]
  feedback: Feedback
  can_edit: boolean
  can_delete: boolean
  can_withdraw: boolean
  can_upload: CanUpload
}

const EMPTY_CORE = {
  track_id: '',
  title: '',
  abstract: '',
  presentation_preference: 'oral' as 'oral' | 'poster' | 'either',
}

const EMPTY_CO_AUTHOR = { full_name: '', email: '', affiliation: '', country: '', is_corresponding: false }

export function SubmissionDetail({
  conferenceId,
  submissionId,
  tracks,
  maxAbstractWords,
  onSaved,
}: {
  conferenceId: string
  submissionId: string | null
  tracks: Track[]
  maxAbstractWords: number
  onSaved: (id: string) => void
}) {
  const [id, setId] = useState<string | null>(submissionId)
  const [core, setCore] = useState(EMPTY_CORE)
  const [keywords, setKeywords] = useState<string[]>([])
  const [keywordInput, setKeywordInput] = useState('')
  const [status, setStatus] = useState('draft')
  const [submissionCode, setSubmissionCode] = useState<string | null>(null)
  const [authors, setAuthors] = useState<Author[]>([])
  const [files, setFiles] = useState<FileRow[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [feedback, setFeedback] = useState<Feedback>({ decisions: [], reviews: [] })
  const [canEdit, setCanEdit] = useState(true)
  const [canDelete, setCanDelete] = useState(false)
  const [canWithdraw, setCanWithdraw] = useState(false)
  const [canUpload, setCanUpload] = useState<CanUpload>({ abstract: false, full_paper: false, slides: false, camera_ready: false })

  const [loading, setLoading] = useState(Boolean(submissionId))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawReason, setWithdrawReason] = useState('')
  const [showWithdraw, setShowWithdraw] = useState(false)

  const [newAuthor, setNewAuthor] = useState(EMPTY_CO_AUTHOR)
  const [authorError, setAuthorError] = useState<string | null>(null)
  const [authorBusy, setAuthorBusy] = useState<string | null>(null)

  const [uploadingKind, setUploadingKind] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const abstractFileInputRef = useRef<HTMLInputElement>(null)
  const fullPaperFileInputRef = useRef<HTMLInputElement>(null)
  const slidesFileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async (sid: string) => {
    setLoading(true)
    try {
      const data = await api.get<SubmissionDetailData>(`/submissions/${sid}`)
      setCore({
        track_id: data.track_id,
        title: data.title,
        abstract: data.abstract,
        presentation_preference: data.presentation_preference,
      })
      setKeywords(data.keywords ?? [])
      setStatus(data.status)
      setSubmissionCode(data.submission_code)
      setAuthors(data.authors)
      setFiles(data.files)
      setHistory(data.status_history)
      setFeedback(data.feedback)
      setCanEdit(data.can_edit)
      setCanDelete(data.can_delete)
      setCanWithdraw(data.can_withdraw)
      setCanUpload(data.can_upload)
      setFormError(null)
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not load this submission.')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (submissionId) {
      setId(submissionId)
      load(submissionId)
    } else {
      setId(null)
      setCore(EMPTY_CORE)
      setKeywords([])
      setStatus('draft')
      setAuthors([])
      setFiles([])
      setHistory([])
      setFeedback({ decisions: [], reviews: [] })
      setCanEdit(true)
      setCanDelete(false)
      setCanWithdraw(false)
      setCanUpload({ abstract: false, full_paper: false, slides: false, camera_ready: false })
    }
  }, [submissionId, load])

  const [presentation, setPresentation] = useState<{
    session_title: string
    room_name: string
    starts_at: string
    ends_at: string
  } | null>(null)

  useEffect(() => {
    if (status !== 'scheduled' && status !== 'presented') {
      setPresentation(null)
      return
    }
    let cancelled = false
    api
      .get<{
        presentations: Array<{ session_title: string; room_name: string; starts_at: string; ends_at: string; title: string }>
      }>(`/conferences/${conferenceId}/my-presentations`)
      .then((data) => {
        if (cancelled) return
        setPresentation(data.presentations.find((p) => p.title === core.title) ?? null)
      })
      .catch(() => {
        if (!cancelled) setPresentation(null)
      })
    return () => {
      cancelled = true
    }
  }, [status, conferenceId, core.title])

  function addKeyword() {
    const v = keywordInput.trim()
    if (!v) return
    if (keywords.includes(v)) {
      setKeywordInput('')
      return
    }
    setKeywords((prev) => [...prev, v])
    setKeywordInput('')
  }

  function removeKeyword(k: string) {
    setKeywords((prev) => prev.filter((x) => x !== k))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const schema = buildSubmissionSchema(maxAbstractWords)
    const parsed = schema.safeParse({ ...core, keywords })
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (typeof key === 'string' && !(key in nextErrors)) nextErrors[key] = issue.message
      }
      setErrors(nextErrors)
      return
    }
    setErrors({})
    setSaving(true)

    try {
      if (!id) {
        const created = await api.post<{ id: string }>(`/conferences/${conferenceId}/submissions`, {
          track_id: parsed.data.track_id,
          title: parsed.data.title,
          abstract: parsed.data.abstract,
          keywords: parsed.data.keywords,
          presentation_preference: parsed.data.presentation_preference,
        })
        setId(created.id)
        onSaved(created.id)
        await load(created.id)
      } else {
        await api.patch(`/submissions/${id}`, {
          track_id: parsed.data.track_id,
          title: parsed.data.title,
          abstract: parsed.data.abstract,
          keywords: parsed.data.keywords,
          presentation_preference: parsed.data.presentation_preference,
        })
        await load(id)
      }
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save this submission.')
    }
    setSaving(false)
  }

  async function handleSubmitForReview() {
    if (!id) return
    if (!window.confirm('Submit this abstract for review? You can withdraw it later if needed.')) return
    setSubmitting(true)
    setFormError(null)
    setNotice(null)
    try {
      await api.post(`/submissions/${id}/submit`)
      setNotice('Submitted.')
      await load(id)
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not submit this abstract.')
    }
    setSubmitting(false)
  }

  async function handleWithdraw() {
    if (!id) return
    setWithdrawing(true)
    try {
      await api.post(`/submissions/${id}/withdraw`, { reason: withdrawReason.trim() || undefined })
      setShowWithdraw(false)
      setWithdrawReason('')
      await load(id)
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not withdraw this submission.')
    }
    setWithdrawing(false)
  }

  async function handleDelete() {
    if (!id) return
    if (!window.confirm('Delete this submission? This cannot be undone.')) return
    setDeleting(true)
    try {
      await api.del(`/submissions/${id}`)
      onSaved('')
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not delete this submission.')
      setDeleting(false)
    }
  }

  async function handleAddAuthor(e: React.FormEvent) {
    e.preventDefault()
    if (!id) return
    setAuthorError(null)
    const parsed = coAuthorSchema.safeParse(newAuthor)
    if (!parsed.success) {
      setAuthorError(parsed.error.issues[0]?.message ?? 'Invalid value.')
      return
    }
    setAuthorBusy('new')
    try {
      await api.post(`/submissions/${id}/authors`, {
        full_name: parsed.data.full_name,
        email: parsed.data.email,
        affiliation: parsed.data.affiliation,
        country: parsed.data.country,
        is_corresponding: parsed.data.is_corresponding,
      })
      setNewAuthor(EMPTY_CO_AUTHOR)
      await load(id)
    } catch (err) {
      setAuthorError(err instanceof ApiError ? err.message : 'Could not add this co-author.')
    }
    setAuthorBusy(null)
  }

  async function handleRemoveAuthor(author: Author) {
    if (!id) return
    if (!window.confirm(`Remove ${author.full_name}?`)) return
    setAuthorBusy(author.id)
    try {
      await api.del(`/submissions/${id}/authors/${author.id}`)
      await load(id)
    } catch (err) {
      setAuthorError(err instanceof ApiError ? err.message : 'Could not remove this author.')
    }
    setAuthorBusy(null)
  }

  async function handleMakeCorresponding(author: Author) {
    if (!id) return
    setAuthorBusy(author.id)
    try {
      await api.patch(`/submissions/${id}/authors/${author.id}`, { is_corresponding: true })
      await load(id)
    } catch (err) {
      setAuthorError(err instanceof ApiError ? err.message : 'Could not update.')
    }
    setAuthorBusy(null)
  }

  async function handleMoveAuthor(author: Author, direction: 'up' | 'down') {
    if (!id) return
    const sorted = [...authors].sort((a, b) => a.author_order - b.author_order)
    const index = sorted.findIndex((a) => a.id === author.id)
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= sorted.length) return
    const other = sorted[swapIndex]!
    setAuthorBusy(author.id)
    try {
      await api.patch(`/submissions/${id}/authors/${author.id}`, { author_order: other.author_order })
      await load(id)
    } catch (err) {
      setAuthorError(err instanceof ApiError ? err.message : 'Could not reorder.')
    }
    setAuthorBusy(null)
  }

  const fileInputRefs = {
    abstract: abstractFileInputRef,
    full_paper: fullPaperFileInputRef,
    slides: slidesFileInputRef,
  } as const

  async function handleFilePick(kind: 'abstract' | 'full_paper' | 'slides', file: File | undefined) {
    if (!id || !file) return
    setUploadError(null)
    const ref = fileInputRefs[kind].current

    const validationError = validateSubmissionFile(kind, file)
    if (validationError) {
      setUploadError(validationError)
      if (ref) ref.value = ''
      return
    }

    setUploadingKind(kind)
    const error = await uploadSubmissionFile(id, kind, file)
    setUploadingKind(null)
    if (ref) ref.value = ''
    if (error) {
      setUploadError(error)
      return
    }
    await load(id)
  }

  function handleDownload(fileId: string) {
    if (!id) return
    downloadSubmissionFile(id, fileId)
  }

  if (loading) {
    return <p className="mt-6 text-sm text-ink/60">Loading…</p>
  }

  const words = core.abstract.trim() ? core.abstract.trim().split(/\s+/).filter(Boolean).length : 0
  const sortedAuthors = [...authors].sort((a, b) => a.author_order - b.author_order)
  const editable = !id || canEdit

  return (
    <div className="mt-6 max-w-3xl space-y-8">
      {id ? (
        <div className="flex flex-wrap items-center gap-3">
          {submissionCode ? <span className="font-mono text-sm text-ink/60">{submissionCode}</span> : null}
          <span className={statusBadgeClass(status)}>{SUBMISSION_STATUS_LABELS[status] ?? status}</span>
        </div>
      ) : null}

      {presentation ? (
        <div className="rounded-md border border-line bg-white px-4 py-3 text-sm">
          <p className="font-medium text-ink">Your presentation</p>
          <p className="mt-1 text-ink/70">
            {presentation.session_title} · {presentation.room_name}
          </p>
          <p className="text-ink/70">
            {formatKathmandu(presentation.starts_at)} – {formatKathmandu(presentation.ends_at)}
          </p>
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</div>
      ) : null}

      <form onSubmit={handleSave} className="space-y-4 rounded-lg border border-line bg-white p-5">
        {formError ? (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {formError}
          </div>
        ) : null}

        <fieldset disabled={Boolean(id) && !editable} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink">Track</label>
            <select
              value={core.track_id}
              onChange={(e) => setCore((p) => ({ ...p, track_id: e.target.value }))}
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 focus:border-button"
            >
              <option value="">Choose a track</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {errors.track_id ? <p className="mt-1 text-sm text-red-600">{errors.track_id}</p> : null}
          </div>

          <div>
            <label className="block text-sm font-medium text-ink">Title</label>
            <input
              value={core.title}
              onChange={(e) => setCore((p) => ({ ...p, title: e.target.value }))}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
            />
            {errors.title ? <p className="mt-1 text-sm text-red-600">{errors.title}</p> : null}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-ink">Abstract</label>
              <span className={`text-xs ${words > maxAbstractWords ? 'text-red-600' : 'text-ink/50'}`}>
                {words} / {maxAbstractWords} words
              </span>
            </div>
            <textarea
              value={core.abstract}
              onChange={(e) => setCore((p) => ({ ...p, abstract: e.target.value }))}
              rows={8}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
            />
            {errors.abstract ? <p className="mt-1 text-sm text-red-600">{errors.abstract}</p> : null}
          </div>

          <div>
            <label className="block text-sm font-medium text-ink">Abstract file (optional)</label>
            <p className="mt-1 text-xs text-ink/50">
              You can type the abstract above, upload it as a file, or both. PDF, Word, or an image (PNG/JPG/WEBP).
              {!id ? ' Save a draft first to enable the upload.' : ''}
            </p>
            <div className="mt-1">
              <input
                ref={abstractFileInputRef}
                type="file"
                accept={SUBMISSION_FILE_RULES.abstract.accept}
                disabled={!id || !canUpload.abstract || uploadingKind === 'abstract'}
                onChange={(e) => handleFilePick('abstract', e.target.files?.[0])}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => abstractFileInputRef.current?.click()}
                disabled={!id || !canUpload.abstract || uploadingKind === 'abstract'}
                className="rounded-md bg-button px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {uploadingKind === 'abstract' ? 'Uploading…' : 'Upload abstract file'}
              </button>
            </div>
            {uploadError ? <p className="mt-1 text-sm text-red-600">{uploadError}</p> : null}
          </div>

          <div>
            <label className="block text-sm font-medium text-ink">Keywords</label>
            <div className="mt-1 flex gap-2">
              <input
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addKeyword()
                  }
                }}
                placeholder="Add a keyword and press Enter"
                className="flex-1 rounded-md border border-line px-3 py-2 focus:border-button"
              />
              <button type="button" onClick={addKeyword} className="rounded-md border border-line px-3 py-2 text-sm hover:bg-background">
                Add
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {keywords.map((k) => (
                <span key={k} className="flex items-center gap-1 rounded-full bg-button/10 px-3 py-1 text-sm text-button">
                  {k}
                  <button type="button" onClick={() => removeKeyword(k)} className="text-button/70 hover:text-button">
                    ×
                  </button>
                </span>
              ))}
            </div>
            {errors.keywords ? <p className="mt-1 text-sm text-red-600">{errors.keywords}</p> : null}
          </div>

          <div>
            <label className="block text-sm font-medium text-ink">Presentation preference</label>
            <div className="mt-1 flex gap-4 text-sm">
              {(['oral', 'poster', 'either'] as const).map((pref) => (
                <label key={pref} className="flex items-center gap-1.5 capitalize">
                  <input
                    type="radio"
                    name="pref"
                    checked={core.presentation_preference === pref}
                    onChange={() => setCore((p) => ({ ...p, presentation_preference: pref }))}
                  />
                  {pref}
                </label>
              ))}
            </div>
          </div>
        </fieldset>

        {!id || editable ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : id ? 'Save draft' : 'Create draft'}
            </button>
            {id ? (
              <button
                type="button"
                onClick={handleSubmitForReview}
                disabled={submitting}
                className="rounded-md border border-button px-4 py-2 text-sm font-medium text-button hover:bg-button/5 disabled:opacity-50"
              >
                {submitting ? 'Submitting…' : 'Submit for review'}
              </button>
            ) : null}
          </div>
        ) : null}
      </form>

      {id ? (
        <>
          <div className="rounded-lg border border-line bg-white p-5">
            <h3 className="font-medium text-ink">Authors</h3>
            {authorError ? <p className="mt-2 text-sm text-red-600">{authorError}</p> : null}
            <ul className="mt-3 divide-y divide-line">
              {sortedAuthors.map((a, i) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="text-sm">
                    <p className="font-medium text-ink">
                      {a.full_name} {a.is_corresponding ? <span className="text-xs text-button">(corresponding)</span> : null}
                    </p>
                    <p className="text-ink/60">
                      {a.email}
                      {a.affiliation ? ` · ${a.affiliation}` : ''}
                      {a.country ? ` · ${a.country}` : ''}
                    </p>
                  </div>
                  {editable ? (
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleMoveAuthor(a, 'up')}
                        disabled={authorBusy === a.id || i === 0}
                        className="rounded-md border border-line px-2 py-1 text-xs hover:bg-background disabled:opacity-40"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveAuthor(a, 'down')}
                        disabled={authorBusy === a.id || i === sortedAuthors.length - 1}
                        className="rounded-md border border-line px-2 py-1 text-xs hover:bg-background disabled:opacity-40"
                      >
                        ↓
                      </button>
                      {!a.is_corresponding ? (
                        <button
                          type="button"
                          onClick={() => handleMakeCorresponding(a)}
                          disabled={authorBusy === a.id}
                          className="rounded-md border border-line px-2 py-1 text-xs hover:bg-background disabled:opacity-50"
                        >
                          Make corresponding
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => handleRemoveAuthor(a)}
                        disabled={authorBusy === a.id}
                        className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>

            {editable ? (
              <form onSubmit={handleAddAuthor} className="mt-4 space-y-2 rounded-md border border-dashed border-line p-3">
                <p className="text-sm font-medium text-ink">Add a co-author</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    value={newAuthor.full_name}
                    onChange={(e) => setNewAuthor((p) => ({ ...p, full_name: e.target.value }))}
                    placeholder="Full name"
                    className="rounded-md border border-line px-3 py-2 text-sm focus:border-button"
                  />
                  <input
                    value={newAuthor.email}
                    onChange={(e) => setNewAuthor((p) => ({ ...p, email: e.target.value }))}
                    placeholder="Email"
                    className="rounded-md border border-line px-3 py-2 text-sm focus:border-button"
                  />
                  <input
                    value={newAuthor.affiliation}
                    onChange={(e) => setNewAuthor((p) => ({ ...p, affiliation: e.target.value }))}
                    placeholder="Affiliation"
                    className="rounded-md border border-line px-3 py-2 text-sm focus:border-button"
                  />
                  <input
                    value={newAuthor.country}
                    onChange={(e) => setNewAuthor((p) => ({ ...p, country: e.target.value }))}
                    placeholder="Country"
                    className="rounded-md border border-line px-3 py-2 text-sm focus:border-button"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={newAuthor.is_corresponding}
                    onChange={(e) => setNewAuthor((p) => ({ ...p, is_corresponding: e.target.checked }))}
                  />
                  Corresponding author
                </label>
                <p className="text-xs text-ink/50">The corresponding author must already have an account.</p>
                {authorError ? <p className="text-sm text-red-600">{authorError}</p> : null}
                <button
                  type="submit"
                  disabled={authorBusy === 'new'}
                  className="rounded-md bg-button px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {authorBusy === 'new' ? 'Adding…' : 'Add author'}
                </button>
              </form>
            ) : null}
          </div>

          <div className="rounded-lg border border-line bg-white p-5">
            <h3 className="font-medium text-ink">Files</h3>
            <p className="mt-1 text-xs text-ink/50">The abstract file upload is above, with the abstract text.</p>
            {uploadError ? <p className="mt-2 text-sm text-red-600">{uploadError}</p> : null}

            {canUpload.full_paper || canUpload.slides ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm text-ink/70">Full paper</label>
                  <p className="mt-1 text-xs text-ink/50">{SUBMISSION_FILE_RULES.full_paper.helpText}</p>
                  <div className="mt-1">
                    <input
                      ref={fullPaperFileInputRef}
                      type="file"
                      accept={SUBMISSION_FILE_RULES.full_paper.accept}
                      disabled={!canUpload.full_paper || uploadingKind === 'full_paper'}
                      onChange={(e) => handleFilePick('full_paper', e.target.files?.[0])}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fullPaperFileInputRef.current?.click()}
                      disabled={!canUpload.full_paper || uploadingKind === 'full_paper'}
                      className="rounded-md bg-button px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {uploadingKind === 'full_paper' ? 'Uploading…' : 'Upload full paper'}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-ink/70">Presentation</label>
                  <p className="mt-1 text-xs text-ink/50">{SUBMISSION_FILE_RULES.slides.helpText}</p>
                  <div className="mt-1">
                    <input
                      ref={slidesFileInputRef}
                      type="file"
                      accept={SUBMISSION_FILE_RULES.slides.accept}
                      disabled={!canUpload.slides || uploadingKind === 'slides'}
                      onChange={(e) => handleFilePick('slides', e.target.files?.[0])}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => slidesFileInputRef.current?.click()}
                      disabled={!canUpload.slides || uploadingKind === 'slides'}
                      className="rounded-md bg-button px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {uploadingKind === 'slides' ? 'Uploading…' : 'Upload presentation'}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {files.length === 0 ? (
              <p className="mt-3 text-sm text-ink/60">No files uploaded yet.</p>
            ) : (
              <ul className="mt-4 divide-y divide-line">
                {files.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <div>
                      <p className="text-ink">
                        {FILE_KIND_LABELS[f.file_kind] ?? f.file_kind} · v{f.version}{' '}
                        <span className="text-ink/50">({f.status})</span>
                      </p>
                      <p className="text-ink/60">{f.original_filename}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDownload(f.id)}
                      className="rounded-md border border-line px-3 py-1 text-xs hover:bg-background"
                    >
                      Download
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-ink/50">
              Uploading a new file keeps earlier versions on record — it doesn't delete them. Files can't be deleted
              once uploaded.
            </p>
          </div>

          {history.length > 0 ? (
            <div className="rounded-lg border border-line bg-white p-5">
              <h3 className="font-medium text-ink">Timeline</h3>
              <ul className="mt-3 space-y-2 text-sm">
                {history.map((h) => (
                  <li key={h.id} className="text-ink/70">
                    <span className="font-medium text-ink">{SUBMISSION_STATUS_LABELS[h.to_status] ?? h.to_status}</span>{' '}
                    — {new Date(h.changed_at).toLocaleString()}
                    {h.reason ? <span className="block text-ink/60">{h.reason}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {feedback.decisions.length > 0 || feedback.reviews.length > 0 ? (
            <div className="rounded-lg border border-line bg-white p-5">
              <h3 className="font-medium text-ink">Feedback</h3>
              <ul className="mt-3 space-y-4">
                {feedback.decisions.map((d, i) => (
                  <li key={`decision-${i}`} className="rounded-md border border-line p-3 text-sm">
                    <p className="font-medium text-ink capitalize">
                      {d.stage.replace('_', ' ')} decision: {d.decision.replace('_', ' ')}
                    </p>
                    {d.comments_to_author ? <p className="mt-1 text-ink/70">{d.comments_to_author}</p> : null}
                  </li>
                ))}
                {feedback.reviews.map((r) => (
                  <li key={`review-${r.review_number}`} className="rounded-md border border-line p-3 text-sm">
                    <p className="font-medium text-ink">
                      Review #{r.review_number}
                      {r.overall_score !== null ? ` — overall ${r.overall_score}/5` : ''}
                    </p>
                    {r.comments_to_author ? <p className="mt-1 text-ink/70">{r.comments_to_author}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {canWithdraw ? (
            <div className="rounded-lg border border-line bg-white p-5">
              {showWithdraw ? (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-ink">Reason (optional)</label>
                  <textarea
                    value={withdrawReason}
                    onChange={(e) => setWithdrawReason(e.target.value)}
                    rows={2}
                    className="w-full rounded-md border border-line px-3 py-2 text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleWithdraw}
                      disabled={withdrawing}
                      className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {withdrawing ? 'Withdrawing…' : 'Confirm withdraw'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowWithdraw(false)}
                      className="rounded-md border border-line px-3 py-1.5 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowWithdraw(true)}
                  className="rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  Withdraw submission
                </button>
              )}
            </div>
          ) : null}

          {canDelete ? (
            <div className="rounded-lg border border-line bg-white p-5">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete submission'}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

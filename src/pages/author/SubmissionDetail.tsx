import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'
import { downloadSubmissionFile, uploadSubmissionFile, validateSubmissionFile, SUBMISSION_FILE_RULES } from '../../lib/submissionFiles'
import { buildSubmissionSchema, coAuthorSchema, type CoAuthorInput } from '../../lib/validation'
import {
  FILE_KIND_LABELS,
  SUBMISSION_STATUS_LABELS,
} from '../../lib/submissionDisplay'
import {
  StatusChip,
  ConfirmDialog,
  Button,
  Input,
  Select,
  Textarea,
  Checkbox,
  FormField,
  Card,
  CardHeader,
  Alert,
  Spinner,
  UploadIcon,
  DownloadIcon,
} from '../../components/ui'

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
  const [confirmingSubmit, setConfirmingSubmit] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [removingAuthor, setRemovingAuthor] = useState<Author | null>(null)

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
    setConfirmingSubmit(false)
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
    setConfirmingDelete(false)
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
    setRemovingAuthor(null)
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
    return (
      <div className="mt-6 flex items-center gap-2 text-sm text-text-muted">
        <Spinner size="sm" /> Loading…
      </div>
    )
  }

  const words = core.abstract.trim() ? core.abstract.trim().split(/\s+/).filter(Boolean).length : 0
  const sortedAuthors = [...authors].sort((a, b) => a.author_order - b.author_order)
  const editable = !id || canEdit

  return (
    <div className="mt-6 max-w-3xl space-y-8">
      {id ? (
        <div className="flex flex-wrap items-center gap-3">
          {submissionCode ? <span className="font-mono text-sm text-text-muted">{submissionCode}</span> : null}
          <StatusChip status={status} labels={SUBMISSION_STATUS_LABELS} />
        </div>
      ) : null}

      {presentation ? (
        <Card>
          <CardHeader title="Your presentation" />
          <p className="text-sm text-text-muted">
            {presentation.session_title} · {presentation.room_name}
          </p>
          <p className="text-sm text-text-muted">
            {formatKathmandu(presentation.starts_at)} – {formatKathmandu(presentation.ends_at)}
          </p>
        </Card>
      ) : null}

      {notice ? <Alert variant="success">{notice}</Alert> : null}

      <form onSubmit={handleSave} className="space-y-4">
        <Card className="space-y-4">
          {formError ? <Alert variant="danger">{formError}</Alert> : null}

          <fieldset disabled={Boolean(id) && !editable} className="space-y-4">
            <FormField label="Track" error={errors.track_id} htmlFor="submission-track">
              <Select
                id="submission-track"
                value={core.track_id}
                onChange={(e) => setCore((p) => ({ ...p, track_id: e.target.value }))}
                error={Boolean(errors.track_id)}
              >
                <option value="">Choose a track</option>
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label="Title" error={errors.title} htmlFor="submission-title">
              <Input
                id="submission-title"
                value={core.title}
                onChange={(e) => setCore((p) => ({ ...p, title: e.target.value }))}
                error={Boolean(errors.title)}
              />
            </FormField>

            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="submission-abstract" className="block text-sm font-medium text-text">
                  Abstract
                </label>
                <span className={`text-xs ${words > maxAbstractWords ? 'text-danger' : 'text-text-muted'}`}>
                  {words} / {maxAbstractWords} words
                </span>
              </div>
              <Textarea
                id="submission-abstract"
                value={core.abstract}
                onChange={(e) => setCore((p) => ({ ...p, abstract: e.target.value }))}
                rows={8}
                error={Boolean(errors.abstract)}
                className="mt-1"
              />
              {errors.abstract ? (
                <p className="mt-1 text-sm text-danger" role="alert">
                  {errors.abstract}
                </p>
              ) : null}
            </div>

            <div>
              <label className="block text-sm font-medium text-text">Abstract file (optional)</label>
              <p className="mt-1 text-xs text-text-muted">
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
                <Button
                  type="button"
                  size="sm"
                  iconLeft={<UploadIcon className="h-4 w-4" />}
                  onClick={() => abstractFileInputRef.current?.click()}
                  disabled={!id || !canUpload.abstract || uploadingKind === 'abstract'}
                  loading={uploadingKind === 'abstract'}
                >
                  {uploadingKind === 'abstract' ? 'Uploading…' : 'Upload abstract file'}
                </Button>
              </div>
              {uploadError ? (
                <p className="mt-1 text-sm text-danger" role="alert">
                  {uploadError}
                </p>
              ) : null}
            </div>

            <FormField label="Keywords" error={errors.keywords}>
              <div className="flex gap-2">
                <Input
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addKeyword()
                    }
                  }}
                  placeholder="Add a keyword and press Enter"
                  className="flex-1"
                />
                <Button type="button" variant="secondary" onClick={addKeyword}>
                  Add
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {keywords.map((k) => (
                  <span
                    key={k}
                    className="flex items-center gap-1 rounded-full border border-border-soft bg-surface-muted px-3 py-1 text-sm text-text"
                  >
                    {k}
                    <button
                      type="button"
                      onClick={() => removeKeyword(k)}
                      className="text-text-muted hover:text-text"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </FormField>

            <div>
              <label className="block text-sm font-medium text-text">Presentation preference</label>
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
              <Button type="submit" variant="secondary" loading={saving}>
                {saving ? 'Saving…' : id ? 'Save draft' : 'Create draft'}
              </Button>
              {id ? (
                <Button type="button" variant="primary" onClick={() => setConfirmingSubmit(true)} loading={submitting}>
                  {submitting ? 'Submitting…' : 'Submit for review'}
                </Button>
              ) : null}
            </div>
          ) : null}
        </Card>
      </form>

      {id ? (
        <>
          <Card>
            <CardHeader title="Authors" />
            {authorError ? (
              <div className="mb-3">
                <Alert variant="danger">{authorError}</Alert>
              </div>
            ) : null}
            <ul className="divide-y divide-border">
              {sortedAuthors.map((a, i) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="text-sm">
                    <p className="font-medium text-text">
                      {a.full_name} {a.is_corresponding ? <span className="text-xs text-brand">(corresponding)</span> : null}
                    </p>
                    <p className="text-text-muted">
                      {a.email}
                      {a.affiliation ? ` · ${a.affiliation}` : ''}
                      {a.country ? ` · ${a.country}` : ''}
                    </p>
                  </div>
                  {editable ? (
                    <div className="flex gap-1.5">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => handleMoveAuthor(a, 'up')}
                        disabled={authorBusy === a.id || i === 0}
                      >
                        ↑
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => handleMoveAuthor(a, 'down')}
                        disabled={authorBusy === a.id || i === sortedAuthors.length - 1}
                      >
                        ↓
                      </Button>
                      {!a.is_corresponding ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => handleMakeCorresponding(a)}
                          disabled={authorBusy === a.id}
                        >
                          Make corresponding
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={() => setRemovingAuthor(a)}
                        disabled={authorBusy === a.id}
                      >
                        Remove
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>

            {editable ? (
              <form onSubmit={handleAddAuthor} className="mt-4 space-y-2 rounded-md border border-dashed border-border p-3">
                <p className="text-sm font-medium text-text">Add a co-author</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input
                    value={newAuthor.full_name}
                    onChange={(e) => setNewAuthor((p) => ({ ...p, full_name: e.target.value }))}
                    placeholder="Full name"
                  />
                  <Input
                    value={newAuthor.email}
                    onChange={(e) => setNewAuthor((p) => ({ ...p, email: e.target.value }))}
                    placeholder="Email"
                  />
                  <Input
                    value={newAuthor.affiliation}
                    onChange={(e) => setNewAuthor((p) => ({ ...p, affiliation: e.target.value }))}
                    placeholder="Affiliation"
                  />
                  <Input
                    value={newAuthor.country}
                    onChange={(e) => setNewAuthor((p) => ({ ...p, country: e.target.value }))}
                    placeholder="Country"
                  />
                </div>
                <Checkbox
                  label="Corresponding author"
                  checked={newAuthor.is_corresponding}
                  onChange={(e) => setNewAuthor((p) => ({ ...p, is_corresponding: e.target.checked }))}
                />
                <p className="text-xs text-text-muted">The corresponding author must already have an account.</p>
                {authorError ? <Alert variant="danger">{authorError}</Alert> : null}
                <Button type="submit" size="sm" loading={authorBusy === 'new'}>
                  {authorBusy === 'new' ? 'Adding…' : 'Add author'}
                </Button>
              </form>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Files" subtitle="The abstract file upload is above, with the abstract text." />
            {uploadError ? (
              <div className="mb-3">
                <Alert variant="danger">{uploadError}</Alert>
              </div>
            ) : null}

            {canUpload.full_paper || canUpload.slides ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm text-text-muted">Full paper</label>
                  <p className="mt-1 text-xs text-text-muted">{SUBMISSION_FILE_RULES.full_paper.helpText}</p>
                  <div className="mt-1">
                    <input
                      ref={fullPaperFileInputRef}
                      type="file"
                      accept={SUBMISSION_FILE_RULES.full_paper.accept}
                      disabled={!canUpload.full_paper || uploadingKind === 'full_paper'}
                      onChange={(e) => handleFilePick('full_paper', e.target.files?.[0])}
                      className="hidden"
                    />
                    <Button
                      type="button"
                      size="sm"
                      iconLeft={<UploadIcon className="h-4 w-4" />}
                      onClick={() => fullPaperFileInputRef.current?.click()}
                      disabled={!canUpload.full_paper || uploadingKind === 'full_paper'}
                      loading={uploadingKind === 'full_paper'}
                    >
                      {uploadingKind === 'full_paper' ? 'Uploading…' : 'Upload full paper'}
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-text-muted">Presentation</label>
                  <p className="mt-1 text-xs text-text-muted">{SUBMISSION_FILE_RULES.slides.helpText}</p>
                  <div className="mt-1">
                    <input
                      ref={slidesFileInputRef}
                      type="file"
                      accept={SUBMISSION_FILE_RULES.slides.accept}
                      disabled={!canUpload.slides || uploadingKind === 'slides'}
                      onChange={(e) => handleFilePick('slides', e.target.files?.[0])}
                      className="hidden"
                    />
                    <Button
                      type="button"
                      size="sm"
                      iconLeft={<UploadIcon className="h-4 w-4" />}
                      onClick={() => slidesFileInputRef.current?.click()}
                      disabled={!canUpload.slides || uploadingKind === 'slides'}
                      loading={uploadingKind === 'slides'}
                    >
                      {uploadingKind === 'slides' ? 'Uploading…' : 'Upload presentation'}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {files.length === 0 ? (
              <p className="mt-3 text-sm text-text-muted">No files uploaded yet.</p>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {files.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <div>
                      <p className="text-text">
                        {FILE_KIND_LABELS[f.file_kind] ?? f.file_kind} · v{f.version}{' '}
                        <span className="text-text-muted">({f.status})</span>
                      </p>
                      <p className="text-text-muted">{f.original_filename}</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      iconLeft={<DownloadIcon className="h-4 w-4" />}
                      onClick={() => handleDownload(f.id)}
                    >
                      Download
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-text-muted">
              Uploading a new file keeps earlier versions on record — it doesn't delete them. Files can't be deleted
              once uploaded.
            </p>
          </Card>

          {history.length > 0 ? (
            <Card>
              <CardHeader title="Timeline" />
              <ul className="space-y-2 text-sm">
                {history.map((h) => (
                  <li key={h.id} className="text-text-muted">
                    <span className="font-medium text-text">{SUBMISSION_STATUS_LABELS[h.to_status] ?? h.to_status}</span>{' '}
                    — {new Date(h.changed_at).toLocaleString()}
                    {h.reason ? <span className="block text-text-muted">{h.reason}</span> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {feedback.decisions.length > 0 || feedback.reviews.length > 0 ? (
            <Card>
              <CardHeader title="Feedback" />
              <ul className="space-y-4">
                {feedback.decisions.map((d, i) => (
                  <li key={`decision-${i}`} className="rounded-md border border-border p-3 text-sm">
                    <p className="font-medium text-text capitalize">
                      {d.stage.replace('_', ' ')} decision: {d.decision.replace('_', ' ')}
                    </p>
                    {d.comments_to_author ? <p className="mt-1 text-text-muted">{d.comments_to_author}</p> : null}
                  </li>
                ))}
                {feedback.reviews.map((r) => (
                  <li key={`review-${r.review_number}`} className="rounded-md border border-border p-3 text-sm">
                    <p className="font-medium text-text">
                      Review #{r.review_number}
                      {r.overall_score !== null ? ` — overall ${r.overall_score}/5` : ''}
                    </p>
                    {r.comments_to_author ? <p className="mt-1 text-text-muted">{r.comments_to_author}</p> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {canWithdraw ? (
            <Card>
              {showWithdraw ? (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-text">Reason (optional)</label>
                  <Textarea value={withdrawReason} onChange={(e) => setWithdrawReason(e.target.value)} rows={2} />
                  <div className="flex gap-2">
                    <Button type="button" variant="danger" onClick={handleWithdraw} loading={withdrawing}>
                      {withdrawing ? 'Withdrawing…' : 'Confirm withdraw'}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setShowWithdraw(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button type="button" variant="danger" onClick={() => setShowWithdraw(true)}>
                  Withdraw submission
                </Button>
              )}
            </Card>
          ) : null}

          {canDelete ? (
            <Card>
              <Button type="button" variant="danger" onClick={() => setConfirmingDelete(true)} loading={deleting}>
                {deleting ? 'Deleting…' : 'Delete submission'}
              </Button>
            </Card>
          ) : null}
        </>
      ) : null}

      <ConfirmDialog
        open={confirmingSubmit}
        title="Submit this abstract for review?"
        message="You can withdraw it later if needed."
        confirmLabel="Submit for review"
        confirmVariant="primary"
        busy={submitting}
        onConfirm={handleSubmitForReview}
        onCancel={() => setConfirmingSubmit(false)}
      />
      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this submission?"
        message="This cannot be undone."
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
      <ConfirmDialog
        open={removingAuthor !== null}
        title={`Remove ${removingAuthor?.full_name ?? 'this author'}?`}
        message="They will no longer be listed as a co-author on this submission."
        confirmLabel="Remove"
        busy={authorBusy === removingAuthor?.id}
        onConfirm={() => removingAuthor && handleRemoveAuthor(removingAuthor)}
        onCancel={() => setRemovingAuthor(null)}
      />
    </div>
  )
}

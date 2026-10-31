import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Download } from 'lucide-react'
import { API_BASE, api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'
import { useToast } from '../../components/ui/Toast'
import { Alert, Badge, Button, Checkbox, ConfirmDialog, EmptyState, FormField, PageHeader, Select, SkeletonText, buttonClasses } from '../../components/ui'

type BookOrder = 'track' | 'session' | 'title'

type Book = {
  id: string
  options: { only_accepted: boolean; order: BookOrder }
  abstract_count: number
  page_count: number
  is_published: boolean
  generated_at: string
}

type Status = { book: Book | null; accepted_count: number; submitted_count: number; programme_published: boolean }

const ORDER_LABELS: Record<BookOrder, string> = {
  track: 'By track',
  session: 'By session (published programme)',
  title: 'By title (A-Z)',
}

/** Convenor: generate the book of abstracts PDF, download it, and choose whether it's downloadable from the public conference page. */
export function AbstractBookTab({ conferenceId, submissionsPath }: { conferenceId: string; submissionsPath: string }) {
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [onlyAccepted, setOnlyAccepted] = useState(true)
  const [order, setOrder] = useState<BookOrder>('track')
  const [generating, setGenerating] = useState(false)
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)
  const [confirmPublish, setConfirmPublish] = useState<boolean | null>(null)
  const [publishing, setPublishing] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await api.get<Status>(`/conferences/${conferenceId}/abstract-book`)
      setStatus(data)
      if (data.book) {
        setOnlyAccepted(data.book.options.only_accepted)
        setOrder(data.book.options.order)
      } else if (data.programme_published) {
        setOrder('session')
      }
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the book of abstracts.')
    }
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load])

  async function generate() {
    setGenerating(true)
    try {
      const res = await api.post<{ book: Book }>(`/conferences/${conferenceId}/abstract-book/generate`, { only_accepted: onlyAccepted, order })
      showToast(`Book generated: ${res.book.abstract_count} abstracts, ${res.book.page_count} pages.`, 'success')
      await load()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not generate the book.', 'error')
    }
    setGenerating(false)
    setConfirmRegenerate(false)
  }

  async function setPublished(isPublished: boolean) {
    setPublishing(true)
    try {
      await api.patch(`/conferences/${conferenceId}/abstract-book/publish`, { is_published: isPublished })
      showToast(isPublished ? 'Anyone can now download it from the conference page.' : 'Removed from the conference page.', 'success')
      await load()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not change this.', 'error')
    }
    setPublishing(false)
    setConfirmPublish(null)
  }

  const eligible = status ? (onlyAccepted ? status.accepted_count : status.submitted_count) : 0
  const book = status?.book ?? null

  return (
    <div className="mt-6 max-w-3xl">
      <PageHeader
        title="Book of abstracts"
        subtitle="A printable PDF of every abstract - cover, contents, abstracts grouped by track or session, and an author index."
      />
      {error ? (
        <div className="mt-4">
          <Alert variant="danger">{error}</Alert>
        </div>
      ) : null}

      {!status ? (
        error ? null : <SkeletonText lines={5} className="mt-4" />
      ) : status.submitted_count === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-border bg-surface">
          <EmptyState
            icon={<BookOpen aria-hidden className="h-8 w-8 text-text-muted" />}
            title="No abstracts yet."
            message="Once authors submit abstracts (and you accept them), you can turn them into a book here."
            actionLabel="Go to submissions"
            onAction={() => navigate(submissionsPath)}
          />
        </div>
      ) : (
        <>
          {book ? (
            <section className="mt-4 rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-text">Current book</p>
                  <p className="text-sm text-text-muted">
                    Generated {formatKathmandu(book.generated_at)} · {book.abstract_count} abstract
                    {book.abstract_count === 1 ? '' : 's'} · {book.page_count} pages · {ORDER_LABELS[book.options.order].toLowerCase()}
                    {book.options.only_accepted ? ' · accepted only' : ' · all submitted'}
                  </p>
                  <div className="mt-2">
                    {book.is_published ? <Badge tone="success">On the conference page</Badge> : <Badge>Not public</Badge>}
                  </div>
                </div>
                <a href={`${API_BASE}/conferences/${conferenceId}/abstract-book/download`} className={buttonClasses('primary', 'md')}>
                  <Download aria-hidden className="h-4 w-4" /> Download PDF
                </a>
              </div>
              <div className="mt-4 border-t border-border pt-3">
                <Checkbox
                  label="Publish on conference page (anyone can download it)"
                  checked={book.is_published}
                  disabled={publishing}
                  onChange={(e) => setConfirmPublish(e.target.checked)}
                />
              </div>
            </section>
          ) : null}

          <section className="mt-6 rounded-lg border border-border bg-surface p-4">
            <h2 className="font-medium text-text">{book ? 'Re-generate' : 'Generate'}</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <FormField label="Which abstracts">
                <Checkbox
                  label={`Only accepted papers (${status.accepted_count})`}
                  checked={onlyAccepted}
                  onChange={(e) => setOnlyAccepted(e.target.checked)}
                />
                {!onlyAccepted ? (
                  <p className="mt-1 text-xs text-text-muted">
                    Includes everything still under consideration ({status.submitted_count}); rejected and withdrawn papers are never included.
                  </p>
                ) : null}
              </FormField>
              <FormField label="Order" htmlFor="book-order">
                <Select id="book-order" value={order} onChange={(e) => setOrder(e.target.value as BookOrder)}>
                  {(Object.keys(ORDER_LABELS) as BookOrder[]).map((o) => (
                    <option key={o} value={o} disabled={o === 'session' && !status.programme_published}>
                      {ORDER_LABELS[o]}
                      {o === 'session' && !status.programme_published ? ' - publish the programme first' : ''}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
            {eligible === 0 ? (
              <p className="mt-3 text-sm text-text-muted">No abstracts match these options yet - accept some papers first.</p>
            ) : null}
            <Button
              type="button"
              className="mt-4"
              loading={generating}
              disabled={eligible === 0}
              onClick={() => (book ? setConfirmRegenerate(true) : generate())}
            >
              {book ? 'Re-generate book' : 'Generate book'} ({eligible} abstract{eligible === 1 ? '' : 's'})
            </Button>
          </section>
        </>
      )}

      <ConfirmDialog
        open={confirmRegenerate}
        title="Replace the current book?"
        message={
          book?.is_published
            ? 'The new PDF replaces the current one, including the public download on the conference page.'
            : 'The new PDF replaces the current one.'
        }
        confirmLabel="Re-generate"
        confirmVariant="primary"
        busy={generating}
        onConfirm={generate}
        onCancel={() => setConfirmRegenerate(false)}
      />
      <ConfirmDialog
        open={confirmPublish !== null}
        title={confirmPublish ? 'Publish the book of abstracts?' : 'Remove it from the conference page?'}
        message={
          confirmPublish
            ? 'Anyone visiting the conference page will be able to download it, including author names and affiliations.'
            : 'The public download link disappears. You can still download it here.'
        }
        confirmLabel={confirmPublish ? 'Publish' : 'Remove'}
        confirmVariant={confirmPublish ? 'primary' : 'danger'}
        busy={publishing}
        onConfirm={() => setPublished(Boolean(confirmPublish))}
        onCancel={() => setConfirmPublish(null)}
      />
    </div>
  )
}

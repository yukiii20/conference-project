import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Download, FileText, Search } from 'lucide-react'
import { API_BASE, api } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'
import { doiOrLinkHref } from './PublicationSection'

/** changes-nov2, Part 3: the "Archive" section of an ended conference's public page. */
type ArchivePaper = {
  id: string
  title: string
  abstract: string
  track_id: string | null
  track_name: string | null
  presenters: string[]
  session_title: string | null
  presented_at: string | null
  publication: { published_in: string | null; doi_or_link: string | null; publication_date: string | null } | null
  download_url: string | null
}

type Archive = {
  ended: boolean
  tracks: Array<{ id: string; name: string }>
  papers: ArchivePaper[]
  report: { body_text: string | null; has_pdf: boolean; published_at: string } | null
}

/** The server returns links as /api/...; API_BASE may point elsewhere in production. */
function apiHref(path: string): string {
  return `${API_BASE}${path.replace(/^\/api/, '')}`
}

function PaperItem({ paper, accent }: { paper: ArchivePaper; accent: string }) {
  const [open, setOpen] = useState(false)
  const doi = paper.publication?.doi_or_link ?? null
  const doiHref = doi ? doiOrLinkHref(doi) : null
  return (
    <li className="rounded-xl border border-border-soft bg-surface p-4 shadow-card">
      <p className="font-medium text-ink">{paper.title}</p>
      {paper.presenters.length > 0 ? <p className="mt-1 text-sm text-ink/70">{paper.presenters.join(', ')}</p> : null}
      <p className="mt-1 text-xs text-ink/60">
        {[
          paper.presented_at ? formatKathmandu(paper.presented_at) : null,
          paper.session_title,
          paper.track_name,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {paper.publication ? (
        <p className="mt-1 text-xs text-ink/70">
          Published{paper.publication.published_in ? ` in ${paper.publication.published_in}` : ''}
          {doi ? (
            <>
              {' · '}
              {doiHref ? (
                <a href={doiHref} target="_blank" rel="noopener noreferrer" className="break-all underline">
                  {doi}
                </a>
              ) : (
                doi
              )}
            </>
          ) : null}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="text-sm font-medium underline-offset-4 hover:underline"
          style={{ color: accent }}
        >
          {open ? 'Hide abstract' : 'Read abstract'}
        </button>
        {paper.download_url ? (
          <a
            href={apiHref(paper.download_url)}
            className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-background"
          >
            <Download size={14} aria-hidden="true" /> Full paper
          </a>
        ) : null}
      </div>
      {open ? <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink/80">{paper.abstract}</p> : null}
    </li>
  )
}

export function ArchiveSection({ conferenceId, accent, style }: { conferenceId: string; accent: string; style?: CSSProperties }) {
  const [archive, setArchive] = useState<Archive | null>(null)
  const [query, setQuery] = useState('')
  const [trackId, setTrackId] = useState('')

  useEffect(() => {
    let cancelled = false
    api
      .get<Archive>(`/conferences/${conferenceId}/archive`)
      .then((res) => {
        if (!cancelled) setArchive(res)
      })
      .catch(() => {
        if (!cancelled) setArchive(null)
      })
    return () => {
      cancelled = true
    }
  }, [conferenceId])

  const term = query.trim().toLowerCase()
  const papers = useMemo(
    () =>
      (archive?.papers ?? []).filter(
        (p) =>
          (!trackId || p.track_id === trackId) &&
          (!term || [p.title, p.abstract, p.session_title, p.track_name, ...p.presenters].some((v) => v?.toLowerCase().includes(term))),
      ),
    [archive, term, trackId],
  )

  if (!archive?.ended) return null

  return (
    <section id="archive" style={style} className="mx-auto max-w-7xl px-4 py-6 sm:px-6" data-testid="archive-section">
      <h2 className="font-display text-3xl font-semibold tracking-tight">Archive</h2>

      {archive.report ? (
        <div className="mt-4 rounded-xl border border-border-soft bg-surface p-5 shadow-card" data-testid="archive-report">
          <h3 className="font-display text-xl font-semibold">Conference report</h3>
          {archive.report.body_text ? <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink/80">{archive.report.body_text}</p> : null}
          {archive.report.has_pdf ? (
            <a
              href={`${API_BASE}/conferences/${conferenceId}/archive/report.pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-background"
            >
              <FileText size={14} aria-hidden="true" /> Download report (PDF)
            </a>
          ) : null}
        </div>
      ) : null}

      <h3 className="mt-6 font-display text-xl font-semibold">Presentations and papers</h3>
      {archive.papers.length === 0 ? (
        <p className="mt-2 text-sm text-ink/60">No presentations are listed for this conference.</p>
      ) : (
        <>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <label className="relative flex-1">
              <span className="sr-only">Search the archive</span>
              <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/50" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search titles, speakers or abstracts"
                className="w-full rounded-md border border-line bg-white py-2 pl-9 pr-3 text-sm"
              />
            </label>
            {archive.tracks.length > 1 ? (
              <select
                aria-label="Filter by track"
                value={trackId}
                onChange={(e) => setTrackId(e.target.value)}
                className="rounded-md border border-line bg-white px-3 py-2 text-sm"
              >
                <option value="">All tracks</option>
                {archive.tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-ink/60" aria-live="polite">
            {papers.length === archive.papers.length ? `${papers.length} presentations` : `${papers.length} of ${archive.papers.length} presentations`}
          </p>
          {papers.length === 0 ? (
            <p className="mt-2 text-sm text-ink/60">Nothing matches your search.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {papers.map((p) => (
                <PaperItem key={p.id} paper={p} accent={accent} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

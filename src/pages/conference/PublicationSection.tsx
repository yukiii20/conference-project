import { useEffect, useState, type CSSProperties } from 'react'
import { api } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'

/** changes-nov2, Part 4: the public "Publication" section - rendered only when the convenor filled something in. */
type Publication = {
  title: string | null
  publisher: string | null
  isbn_issn: string | null
  link: string | null
  date: string | null
  note: string | null
}

/** A DOI (10.x/...) becomes a doi.org link; other values must already be http(s) links. */
export function doiOrLinkHref(value: string): string | null {
  if (/^https?:\/\//i.test(value)) return value
  if (/^10\.\d{4,9}\//.test(value)) return `https://doi.org/${value}`
  return null
}

export function PublicationSection({ conferenceId, style }: { conferenceId: string; style?: CSSProperties }) {
  const [pub, setPub] = useState<Publication | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<{ publication: Publication | null }>(`/conferences/${conferenceId}/publication-info/public`)
      .then((res) => {
        if (!cancelled) setPub(res.publication)
      })
      .catch(() => {
        // Optional section: on any error it simply stays hidden.
      })
    return () => {
      cancelled = true
    }
  }, [conferenceId])

  if (!pub) return null
  const linkHref = pub.link ? doiOrLinkHref(pub.link) : null
  const rows: Array<[string, React.ReactNode]> = []
  if (pub.title) rows.push(['Published in', pub.title])
  if (pub.publisher) rows.push(['Publisher', pub.publisher])
  if (pub.isbn_issn) rows.push(['ISBN / ISSN', pub.isbn_issn])
  if (pub.date) rows.push(['Publication date', formatKathmandu(pub.date, { dateOnly: true })])
  if (pub.link)
    rows.push([
      'DOI / link',
      linkHref ? (
        <a href={linkHref} target="_blank" rel="noopener noreferrer" className="break-all underline">
          {pub.link}
        </a>
      ) : (
        pub.link
      ),
    ])

  return (
    <section id="publication" style={style} className="mx-auto max-w-7xl px-4 py-6 sm:px-6" data-testid="publication-section">
      <h2 className="font-display text-3xl font-semibold tracking-tight">Publication</h2>
      <div className="mt-4 rounded-xl border border-border-soft bg-surface p-5 shadow-card">
        {pub.note ? <p className="whitespace-pre-line text-sm leading-relaxed text-ink/80">{pub.note}</p> : null}
        {rows.length > 0 ? (
          <dl className={`grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr] ${pub.note ? 'mt-4' : ''}`}>
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="font-medium text-ink/60">{label}</dt>
                <dd className="text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </section>
  )
}

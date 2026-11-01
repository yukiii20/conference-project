import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { formatKathmandu } from '../../../lib/datetime'
import { SITE } from '../../../content/site'
import { Reveal } from '../Reveal'
import { longDate, todayDateString, type Announcement, type Conference, type DeadlineWindow } from './homeData'

type KeyDate = { key: string; at: string; label: string; conference: Conference }

/** Upcoming milestones across all listed conferences, soonest first. */
export function buildKeyDates(
  conferences: Conference[],
  abstracts: Map<string, DeadlineWindow>,
  registration: Map<string, DeadlineWindow>,
  limit = 6,
): KeyDate[] {
  const now = Date.now()
  const out: KeyDate[] = []
  const today = todayDateString()
  for (const c of conferences) {
    if (c.end_date < today) continue // finished conferences have no upcoming milestones
    const a = abstracts.get(c.id)
    if (a) {
      if (new Date(a.opens_at).getTime() > now) out.push({ key: `${c.id}-ao`, at: a.opens_at, label: 'Abstract submission opens', conference: c })
      else if (a.closes_at && new Date(a.closes_at).getTime() > now) out.push({ key: `${c.id}-ac`, at: a.closes_at, label: 'Abstract submission closes', conference: c })
    }
    const r = registration.get(c.id)
    if (r) {
      if (new Date(r.opens_at).getTime() > now) out.push({ key: `${c.id}-ro`, at: r.opens_at, label: 'Registration opens', conference: c })
      else if (r.closes_at && new Date(r.closes_at).getTime() > now) out.push({ key: `${c.id}-rc`, at: r.closes_at, label: 'Registration closes', conference: c })
    }
    const start = new Date(`${c.start_date}T00:00:00+05:45`)
    if (start.getTime() > now) out.push({ key: `${c.id}-start`, at: start.toISOString(), label: 'Conference begins', conference: c })
  }
  return out.sort((x, y) => x.at.localeCompare(y.at)).slice(0, limit)
}

export function NewsAndDates({ announcements, keyDates }: { announcements: Announcement[]; keyDates: KeyDate[] }) {
  if (announcements.length === 0 && keyDates.length === 0) return null
  const both = announcements.length > 0 && keyDates.length > 0

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-24 sm:px-6 lg:py-28">
      <Reveal>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-ink">News & key dates</p>
        <h2 className="mt-3 max-w-2xl font-display text-4xl font-semibold tracking-[-0.015em] text-brand sm:text-5xl">What's happening now.</h2>
      </Reveal>

      <div className={`mt-12 grid grid-cols-[minmax(0,1fr)] gap-12 [&>*]:min-w-0 ${both ? 'lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-16' : ''}`}>
        {announcements.length > 0 ? (
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-text-muted">{SITE.announcements.heading}</h3>
            <ul className="mt-4 divide-y divide-border border-y border-border">
              {announcements.map((a, i) => {
                const preview = a.body.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join(' ')
                const inner = (
                  <>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      {a.conference_name ? <span className="font-semibold uppercase tracking-wide text-indigo">{a.conference_name}</span> : null}
                      <span className="text-text-muted">{formatKathmandu(a.publish_at ?? a.created_at, { dateOnly: true })}</span>
                    </div>
                    <p className="mt-2 font-display text-xl font-semibold leading-snug text-text transition-colors group-hover:text-indigo">{a.title}</p>
                    <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-text-muted">{preview}</p>
                  </>
                )
                return (
                  <li key={a.id}>
                    <Reveal delay={i * 70}>
                      {a.conference_slug ? (
                        <Link to={`/c/${a.conference_slug}`} className="group relative block py-6 pr-10">
                          {inner}
                          <ArrowUpRight
                            size={18}
                            aria-hidden="true"
                            className="absolute right-1 top-7 text-text-muted transition duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-indigo"
                          />
                        </Link>
                      ) : (
                        <div className="py-6">{inner}</div>
                      )}
                    </Reveal>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}

        {keyDates.length > 0 ? (
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-text-muted">Upcoming dates</h3>
            <ol className="mt-4 space-y-3">
              {keyDates.map((d, i) => {
                const date = new Date(d.at)
                const day = date.toLocaleString('en-GB', { day: 'numeric', timeZone: 'Asia/Kathmandu' })
                const month = date.toLocaleString('en-GB', { month: 'short', timeZone: 'Asia/Kathmandu' })
                return (
                  <li key={d.key}>
                    <Reveal delay={i * 60}>
                      <Link
                        to={`/c/${d.conference.slug}`}
                        className="group flex items-center gap-4 rounded-2xl border border-border-soft bg-surface p-3 pr-4 transition duration-300 hover:-translate-y-0.5 hover:border-border hover:shadow-card-hover"
                      >
                        <span className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-brand text-white" aria-hidden="true">
                          <span className="font-display text-xl font-semibold leading-none">{day}</span>
                          <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold">{month}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-text">{d.label}</span>
                          <span className="block truncate text-sm text-text-muted">{d.conference.name}</span>
                          <span className="sr-only">{longDate(d.at)}</span>
                        </span>
                        <ArrowUpRight size={16} aria-hidden="true" className="shrink-0 text-text-muted transition group-hover:text-indigo" />
                      </Link>
                    </Reveal>
                  </li>
                )
              })}
            </ol>
          </div>
        ) : null}
      </div>
    </div>
  )
}

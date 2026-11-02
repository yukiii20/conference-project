import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowRight, ExternalLink, Mail } from 'lucide-react'
import { LandingHeader } from '../components/landing/LandingHeader'
import { LandingFooter } from '../components/landing/LandingFooter'
import { SITE } from '../content/site'
import { TEAM, TEAM_NAME, type TeamMember } from '../content/team'

// One accent per member, in "SYPN" order.
const ACCENTS = [
  { tile: 'bg-brand text-white', ring: 'ring-brand', soft: 'bg-brand/5' },
  { tile: 'bg-gold text-brand', ring: 'ring-gold', soft: 'bg-gold-soft' },
  { tile: 'bg-indigo text-white', ring: 'ring-indigo', soft: 'bg-indigo-soft' },
  { tile: 'bg-gold-ink text-white', ring: 'ring-gold-ink', soft: 'bg-gold-soft/60' },
] as const

const BUILT = [
  'Conference websites with calls for papers, programme and venue',
  'Abstract submission with co-authors and tracked submission codes',
  'Double-blind peer review, reviewer bidding and auto-assignment',
  'Programme scheduling, session chairs and a live session timer',
  'Registration, QR tickets and check-in from any phone',
  'Certificates anyone can verify, feedback surveys and analytics',
]

const STACK = ['React', 'TypeScript', 'Vite', 'Tailwind CSS', 'Node.js', 'Express', 'MySQL']

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase())
    .slice(0, 2)
    .join('')
}

function Avatar({ member, accent, size }: { member: TeamMember; accent: (typeof ACCENTS)[number]; size: 'sm' | 'lg' }) {
  const dims = size === 'lg' ? 'h-24 w-24 text-3xl rounded-3xl' : 'h-14 w-14 text-lg rounded-2xl'
  if (member.photo) {
    return <img src={member.photo} alt="" className={`${dims} shrink-0 object-cover`} />
  }
  return (
    <span className={`${dims} ${accent.tile} flex shrink-0 items-center justify-center font-display font-semibold`} aria-hidden="true">
      {initials(member.fullName)}
    </span>
  )
}

function MemberDetail({ member, accent }: { member: TeamMember; accent: (typeof ACCENTS)[number] }) {
  const firstName = member.fullName.split(' ')[0]
  return (
    <article
      id="member-detail"
      aria-live="polite"
      className="relative overflow-hidden rounded-[28px] border border-border-soft bg-surface p-7 shadow-card sm:p-9"
    >
      <span
        className="pointer-events-none absolute -right-4 -top-10 select-none font-display text-[11rem] font-semibold leading-none text-brand/[0.04]"
        aria-hidden="true"
      >
        {member.letter}
      </span>
      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
        <Avatar member={member} accent={accent} size="lg" />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-ink">
            The “{member.letter}” in {TEAM_NAME}
          </p>
          <h2 className="mt-2 font-display text-3xl font-semibold tracking-[-0.01em] text-brand sm:text-4xl">{member.fullName}</h2>
          <p className="mt-1.5 text-text-muted">{member.role ?? `Co-creator, ${SITE.name}`}</p>
        </div>
      </div>

      <div className="relative mt-7 border-t border-border-soft pt-6">
        {member.bio ? (
          <p className="leading-relaxed text-text">{member.bio}</p>
        ) : (
          <p className="leading-relaxed text-text-muted">
            {firstName} is one of the four people who designed and built this platform, from the public conference pages to the
            organiser, author, reviewer and staff workspaces.
          </p>
        )}

        <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
          <div className={`rounded-2xl ${accent.soft} px-4 py-3`}>
            <dt className="text-text-muted">Full name</dt>
            <dd className="mt-0.5 font-medium text-text">{member.fullName}</dd>
          </div>
          <div className={`rounded-2xl ${accent.soft} px-4 py-3`}>
            <dt className="text-text-muted">Team</dt>
            <dd className="mt-0.5 font-medium text-text">
              {TEAM_NAME} · member {TEAM.indexOf(member) + 1} of {TEAM.length}
            </dd>
          </div>
        </dl>

        {member.email || member.links?.length ? (
          <div className="mt-6 flex flex-wrap gap-2.5">
            {member.email ? (
              <a
                href={`mailto:${member.email}`}
                className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-text hover:bg-surface-muted/60"
              >
                <Mail size={15} aria-hidden="true" />
                {member.email}
              </a>
            ) : null}
            {member.links?.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-text hover:bg-surface-muted/60"
              >
                {link.label}
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  )
}

export function TeamPage() {
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('member')
  const selectedIndex = Math.max(
    0,
    TEAM.findIndex((m) => m.id === selectedId),
  )
  const selected = TEAM[selectedIndex]!

  useEffect(() => {
    const prevTitle = document.title
    document.title = `${TEAM_NAME} — the team behind ${SITE.name}`
    return () => {
      document.title = prevTitle
    }
  }, [])

  function select(member: TeamMember) {
    setParams({ member: member.id }, { replace: true, preventScrollReset: true })
    if (window.matchMedia('(max-width: 1023px)').matches) {
      requestAnimationFrame(() => document.getElementById('member-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }

  return (
    <div className="min-h-screen bg-page-bg text-text">
      <LandingHeader />

      <main>
        {/* Intro */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute -right-32 -top-32 h-[420px] w-[420px] rounded-full bg-gold/15 blur-3xl" aria-hidden="true" />
          <div className="relative mx-auto max-w-[1240px] px-4 pb-12 pt-16 sm:px-6 lg:pt-24">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-ink">Project by</p>
            <h1 className="mt-3 flex flex-wrap items-baseline gap-x-1 font-display text-7xl font-semibold tracking-[-0.03em] text-brand sm:text-8xl">
              {TEAM.map((m, i) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => select(m)}
                  aria-label={`${m.letter} for ${m.fullName}`}
                  className={`rounded-xl px-1 transition hover:text-gold-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo/20 ${
                    i === selectedIndex ? 'text-gold-ink' : ''
                  }`}
                >
                  {m.letter}
                </button>
              ))}
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-text-muted">
              {TEAM_NAME} is the four-person team that created {SITE.name} — one letter for each of us:{' '}
              {TEAM.map((m, i) => (
                <span key={m.id}>
                  <span className="font-medium text-text">{m.fullName}</span>
                  {i < TEAM.length - 2 ? ', ' : i === TEAM.length - 2 ? ' and ' : '.'}
                </span>
              ))}
            </p>
          </div>
        </section>

        {/* Members + detail view */}
        <section className="mx-auto max-w-[1240px] px-4 pb-20 sm:px-6">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)] lg:items-start">
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1" aria-label="Team members">
              {TEAM.map((m, i) => {
                const active = i === selectedIndex
                const accent = ACCENTS[i % ACCENTS.length]!
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => select(m)}
                      aria-pressed={active}
                      aria-controls="member-detail"
                      className={`group flex w-full items-center gap-4 rounded-2xl border bg-surface p-4 text-left transition duration-200 ${
                        active ? `border-transparent shadow-card ring-2 ${accent.ring}` : 'border-border-soft hover:border-border hover:shadow-card'
                      }`}
                    >
                      <Avatar member={m} accent={accent} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display text-lg font-semibold text-brand">{m.fullName}</span>
                        <span className="block truncate text-sm text-text-muted">{m.role ?? `“${m.letter}” in ${TEAM_NAME}`}</span>
                      </span>
                      <span className="flex items-center gap-1 text-sm font-medium text-text-muted group-hover:text-brand">
                        {active ? 'Viewing' : 'View'}
                        <ArrowRight size={15} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>

            <MemberDetail member={selected} accent={ACCENTS[selectedIndex % ACCENTS.length]!} />
          </div>
        </section>

        {/* What the team built */}
        <section className="bg-brand text-white">
          <div className="mx-auto grid max-w-[1240px] gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.2fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">What we built</p>
              <h2 className="mt-3 font-display text-4xl font-semibold tracking-[-0.015em]">{SITE.name}</h2>
              <p className="mt-4 max-w-md leading-relaxed text-white/70">
                One place to run an academic conference end to end — for organisers, authors, reviewers, staff and attendees.
              </p>
              <div className="mt-8 flex flex-wrap gap-2">
                {STACK.map((t) => (
                  <span key={t} className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-sm text-white/85">
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {BUILT.map((item) => (
                <li key={item} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm leading-relaxed text-white/85">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  )
}

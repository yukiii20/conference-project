import { useState, memo } from 'react'
import {
  Award,
  BarChart3,
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  EyeOff,
  FileText,
  LayoutDashboard,
  Mail,
  MessageSquareText,
  QrCode,
  Shuffle,
  Ticket,
  Timer,
  type LucideIcon,
} from 'lucide-react'
import { Reveal } from '../Reveal'

type Story = { id: string; icon: LucideIcon; title: string; description: string; image: string; width: number; height: number; alt: string; context: string }

// Every screen here is a real screenshot of the app (demo-video/screens.ts, demo conference data only).
const STORIES: Story[] = [
  {
    id: 'manage',
    icon: LayoutDashboard,
    title: 'Conference management',
    description: 'One dashboard for submissions, reviews, accepted papers and registrations — with what needs attention flagged first.',
    image: '/images/product/convenor-dashboard.webp',
    width: 1600,
    height: 1050,
    alt: 'Convenor dashboard with submission, registration, review and acceptance totals, the submission pipeline and upcoming deadlines',
    context: 'Convenor dashboard',
  },
  {
    id: 'submit',
    icon: FileText,
    title: 'Research submissions',
    description: 'Authors choose a track, write or upload their abstract, add co-authors and get a tracked submission code.',
    image: '/images/product/submission.webp',
    width: 1600,
    height: 1050,
    alt: 'Author submission form with track, title and abstract fields',
    context: 'Author portal',
  },
  {
    id: 'review',
    icon: EyeOff,
    title: 'Double-blind peer review',
    description: 'Reviewers see the paper, never the authors, and score it on a structured form with a recommendation.',
    image: '/images/product/review.webp',
    width: 1600,
    height: 1050,
    alt: 'Reviewer portal listing assigned papers with their review status and due dates',
    context: 'Reviewer portal',
  },
  {
    id: 'programme',
    icon: CalendarDays,
    title: 'Programme scheduling',
    description: 'Rooms, time slots and sessions, published straight to the public conference page.',
    image: '/images/product/programme.webp',
    width: 1600,
    height: 1050,
    alt: 'Programme builder listing published sessions with their type, track, room and time',
    context: 'Programme builder',
  },
  {
    id: 'register',
    icon: Ticket,
    title: 'Event registration',
    description: 'Participants register in a minute and get a personal ticket with a scannable QR code.',
    image: '/images/product/ticket.webp',
    width: 1600,
    height: 1050,
    alt: 'My ticket page with the registration number, a check-in QR code and a Download QR button',
    context: 'Participant ticket',
  },
  {
    id: 'checkin',
    icon: QrCode,
    title: 'QR check-in',
    description: 'Staff scan tickets with any phone camera or search by name — the count updates live.',
    image: '/images/product/checkin.webp',
    width: 1600,
    height: 1050,
    alt: 'Check-in desk showing confirmed registrations, people checked in today and a manual search',
    context: 'Check-in desk',
  },
  {
    id: 'certificates',
    icon: Award,
    title: 'Certificates',
    description: 'Generated from a branded template, released on your date, and verifiable by anyone with the link.',
    image: '/images/product/certificates.webp',
    width: 1600,
    height: 1050,
    alt: 'Issued certificates list with certificate numbers, recipients, type and status',
    context: 'Certificates',
  },
  {
    id: 'analytics',
    icon: BarChart3,
    title: 'Analytics & oversight',
    description: 'Platform-wide totals, system health and a full activity log for administrators.',
    image: '/images/product/admin.webp',
    width: 1600,
    height: 1050,
    alt: 'Administrator dashboard with user, submission and registration totals and system health',
    context: 'Administrator',
  },
]

const ALSO: Array<{ icon: LucideIcon; label: string }> = [
  { icon: Shuffle, label: 'Reviewer bidding & auto-assignment' },
  { icon: Mail, label: 'Bulk email & editable templates' },
  { icon: BookOpen, label: 'Abstract book' },
  { icon: Timer, label: 'Session timer for chairs' },
  { icon: MessageSquareText, label: 'Feedback surveys' },
  { icon: ClipboardCheck, label: 'Attendance & reports' },
]

export const ProductShowcase = memo(function ProductShowcase() {
  const [active, setActive] = useState(0)
  const story = STORIES[active]!

  return (
    <div className="relative overflow-hidden bg-brand text-white">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -left-40 top-20 h-[460px] w-[460px] rounded-full bg-indigo/25 blur-3xl" />
        <div className="absolute -right-24 bottom-0 h-[380px] w-[520px] rounded-full bg-gold/10 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
      </div>

      <div className="relative mx-auto max-w-[1240px] px-4 py-24 sm:px-6 lg:py-32">
        <Reveal>
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">The platform</p>
            <h2 className="mt-3 font-display text-4xl font-semibold tracking-[-0.015em] sm:text-5xl">
              Every stage of a conference, in one considered system.
            </h2>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
              From the call for papers to the last certificate, organisers, authors, reviewers and staff work in the same place —
              each with exactly the tools their role needs.
            </p>
          </div>
        </Reveal>

        <div className="mt-14 grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.4fr)] lg:gap-14">
          {/* Story list */}
          <Reveal delay={80} className="min-w-0">
            <div role="tablist" aria-label="Platform capabilities" aria-orientation="vertical" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 lg:mx-0 lg:block lg:space-y-1 lg:overflow-visible lg:px-0 lg:pb-0">
              {STORIES.map((s, i) => {
                const selected = i === active
                const Icon = s.icon
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    id={`showcase-tab-${s.id}`}
                    aria-selected={selected}
                    aria-controls="showcase-panel"
                    onClick={() => setActive(i)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                        e.preventDefault()
                        const next = (i + 1) % STORIES.length
                        setActive(next)
                        document.getElementById(`showcase-tab-${STORIES[next]!.id}`)?.focus()
                      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                        e.preventDefault()
                        const prev = (i - 1 + STORIES.length) % STORIES.length
                        setActive(prev)
                        document.getElementById(`showcase-tab-${STORIES[prev]!.id}`)?.focus()
                      }
                    }}
                    tabIndex={selected ? 0 : -1}
                    className={`group relative flex shrink-0 items-start gap-4 rounded-2xl px-4 py-3.5 text-left transition duration-300 lg:w-full ${
                      selected ? 'bg-white/[0.08] ring-1 ring-white/15' : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition duration-300 ${
                        selected ? 'bg-gold text-brand' : 'bg-white/[0.07] text-white/70 group-hover:text-white'
                      }`}
                    >
                      <Icon size={19} aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className={`block whitespace-nowrap font-medium lg:whitespace-normal ${selected ? 'text-white' : 'text-white/75'}`}>{s.title}</span>
                      <span
                        className={`hidden overflow-hidden text-sm leading-relaxed text-white/60 transition-all duration-500 lg:block ${
                          selected ? 'mt-1 max-h-24 opacity-100' : 'max-h-0 opacity-0'
                        }`}
                      >
                        {s.description}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </Reveal>

          {/* Screen */}
          <Reveal delay={160} variant="image" className="min-w-0">
            <div id="showcase-panel" role="tabpanel" aria-labelledby={`showcase-tab-${story.id}`} className="relative">
              <p className="mb-4 text-sm leading-relaxed text-white/70 lg:hidden">{story.description}</p>
              <div className="relative rounded-[22px] bg-white/[0.06] p-2 ring-1 ring-white/10 shadow-[0_50px_100px_-40px_rgb(0_0_0/0.7)] sm:p-3">
                <div className="overflow-hidden rounded-[16px] bg-[#f7f3ee]">
                  <div className="flex items-center gap-1.5 border-b border-black/5 bg-white/80 px-4 py-2.5" aria-hidden="true">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#e7b3a6]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#ecd59f]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#b9d6b0]" />
                    <span className="ml-3 truncate rounded-md bg-black/[0.04] px-3 py-0.5 text-[11px] text-black/45">{story.context}</span>
                  </div>
                  <div className="relative aspect-[16/10.5]">
                    {STORIES.map((s, i) => (
                      <img
                        key={s.id}
                        src={s.image}
                        alt={i === active ? s.alt : ''}
                        aria-hidden={i === active ? undefined : true}
                        width={s.width}
                        height={s.height}
                        loading="lazy"
                        decoding="async"
                        className={`absolute inset-0 h-full w-full object-cover object-left-top transition-all duration-700 ease-out ${
                          i === active ? 'scale-100 opacity-100' : 'scale-[1.02] opacity-0'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <p className="mt-6 text-xs text-white/45">Real screens from the app, shown with demo data. Each conference appears in its own brand colour.</p>
          </Reveal>
        </div>

        <Reveal delay={100} className="mt-20">
          <div className="border-t border-white/10 pt-10">
            <p className="text-sm font-medium text-white/60">Also built in</p>
            <ul className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              {ALSO.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-3 text-white/85">
                  <Icon size={18} aria-hidden="true" className="shrink-0 text-gold" />
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </div>
  )
})

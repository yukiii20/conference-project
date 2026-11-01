import type { ReactNode } from 'react'
import { ClipboardList, FileText, Gavel, LayoutDashboard, ShieldCheck, Timer, type LucideIcon } from 'lucide-react'
import { SITE } from '../../../content/site'
import { Reveal } from '../Reveal'

function Preview({ src, alt, width, height, position = 'left top' }: { src: string; alt: string; width: number; height: number; position?: string }) {
  return (
    <div className="relative mt-6 overflow-hidden rounded-t-xl border border-b-0 border-border-soft bg-[#f7f3ee] shadow-[0_-12px_30px_-20px_rgb(16_28_50/0.35)]">
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        style={{ objectPosition: position }}
        className="h-44 w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03] sm:h-52"
      />
    </div>
  )
}

function RoleTile({
  icon: Icon,
  title,
  description,
  duties,
  className = '',
  dark = false,
  children,
}: {
  icon: LucideIcon
  title: string
  description: string
  duties: string[]
  className?: string
  dark?: boolean
  children?: ReactNode
}) {
  return (
    <article
      className={`group flex flex-col overflow-hidden rounded-[24px] border px-6 pt-6 transition duration-300 hover:-translate-y-1 sm:px-7 sm:pt-7 ${
        dark ? 'border-brand bg-brand text-white' : 'border-border-soft bg-surface hover:shadow-[0_24px_48px_-28px_rgb(16_28_50/0.35)]'
      } ${children ? '' : 'pb-7'} ${className}`}
    >
      <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${dark ? 'bg-gold text-brand' : 'bg-indigo-soft text-indigo'}`}>
        <Icon size={20} aria-hidden="true" />
      </span>
      <h3 className={`mt-5 font-display text-2xl font-semibold ${dark ? 'text-white' : 'text-text'}`}>{title}</h3>
      <p className={`mt-2 leading-relaxed ${dark ? 'text-white/70' : 'text-text-muted'}`}>{description}</p>
      <ul className={`mt-4 space-y-1.5 text-sm ${dark ? 'text-white/80' : 'text-text'}`}>
        {duties.map((d) => (
          <li key={d} className="flex gap-2.5">
            <span className={`mt-[7px] h-1 w-3 shrink-0 rounded-full ${dark ? 'bg-gold' : 'bg-gold-ink/60'}`} aria-hidden="true" />
            {d}
          </li>
        ))}
      </ul>
      {children ? <div className="mt-auto">{children}</div> : null}
    </article>
  )
}

export function RolesSection() {
  return (
    <div className="mx-auto max-w-[1240px] px-4 py-24 sm:px-6 lg:py-32">
      <Reveal>
        <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-ink">Built for every role</p>
            <h2 className="mt-3 font-display text-4xl font-semibold tracking-[-0.015em] text-brand sm:text-5xl">Six roles. One shared workspace.</h2>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-text-muted">{SITE.roles.note}</p>
        </div>
      </Reveal>

      <div className="mt-12 grid gap-5 lg:grid-cols-6">
        <Reveal className="lg:col-span-4">
          <RoleTile
            className="h-full"
            icon={LayoutDashboard}
            title="Conference organisers"
            description="Convenors shape the whole event — tracks, dates, branding, reviewers, decisions and the programme."
            duties={['Set tracks, key dates and the call for papers', 'Assign reviewers and record decisions', 'Build and publish the programme']}
          >
            <Preview src="/images/product/convenor-dashboard.webp" alt="Convenor dashboard" width={1200} height={609} />
          </RoleTile>
        </Reveal>
        <Reveal className="lg:col-span-2" delay={80}>
          <RoleTile
            className="h-full"
            icon={FileText}
            title="Authors & researchers"
            description="Submit work, follow its review and present it."
            duties={['Submit abstracts and full papers', 'Add co-authors and files', 'Read decisions and feedback']}
          >
            <Preview src="/images/product/submission.webp" alt="Author submission form" width={1200} height={794} position="30% top" />
          </RoleTile>
        </Reveal>

        <Reveal className="lg:col-span-2">
          <RoleTile
            className="h-full"
            icon={Gavel}
            title="Reviewers"
            description="Assess research fairly, without knowing who wrote it."
            duties={['Bid on papers that match your expertise', 'Score on a structured form', 'See every assignment deadline']}
          >
            <Preview src="/images/product/review.webp" alt="Reviewer scoring form" width={1200} height={783} position="70% 40%" />
          </RoleTile>
        </Reveal>
        <Reveal className="lg:col-span-2" delay={80}>
          <RoleTile
            dark
            className="h-full"
            icon={Timer}
            title="Session chairs"
            description="Keep sessions on time and presenters supported."
            duties={['See every session you chair', 'Run the full-screen session timer', 'Talk and Q&A phases, kept on schedule']}
          />
        </Reveal>
        <Reveal className="lg:col-span-2" delay={160}>
          <RoleTile
            className="h-full"
            icon={ClipboardList}
            title="Event staff"
            description="Run the registration desk on the day."
            duties={['Scan QR tickets from any phone', 'Search attendees by name', 'Watch check-ins update live']}
          >
            <Preview src="/images/product/checkin.webp" alt="Check-in desk" width={1200} height={704} position="40% top" />
          </RoleTile>
        </Reveal>

        <Reveal className="lg:col-span-6">
          <article className="group grid overflow-hidden rounded-[24px] border border-border-soft bg-gradient-to-br from-gold-soft/70 via-surface to-surface transition duration-300 hover:shadow-[0_24px_48px_-28px_rgb(16_28_50/0.35)] md:grid-cols-[1fr_1.15fr]">
            <div className="p-6 sm:p-8 lg:p-10">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand text-gold">
                <ShieldCheck size={20} aria-hidden="true" />
              </span>
              <h3 className="mt-5 font-display text-2xl font-semibold text-text">Platform administrators</h3>
              <p className="mt-2 max-w-md leading-relaxed text-text-muted">
                Look after the whole platform: create conferences, appoint convenors, manage accounts and keep an eye on system health.
              </p>
              <ul className="mt-4 grid gap-1.5 text-sm text-text sm:grid-cols-2">
                {['Create conferences', 'Appoint convenors', 'Manage users and admins', 'Platform settings & email log'].map((d) => (
                  <li key={d} className="flex gap-2.5">
                    <span className="mt-[7px] h-1 w-3 shrink-0 rounded-full bg-gold-ink/60" aria-hidden="true" />
                    {d}
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative min-h-[220px] overflow-hidden md:min-h-0">
              <img
                src="/images/product/admin.webp"
                alt="Administrator dashboard"
                width={1040}
                height={630}
                loading="lazy"
                decoding="async"
                className="absolute left-6 top-6 h-[calc(100%+40px)] w-[calc(100%-24px)] rounded-tl-xl border border-border-soft object-cover object-left-top shadow-pop transition-transform duration-700 ease-out group-hover:-translate-y-2 md:left-10 md:top-10"
              />
            </div>
          </article>
        </Reveal>
      </div>
    </div>
  )
}

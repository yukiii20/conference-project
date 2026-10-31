import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Award, CalendarDays, EyeOff } from 'lucide-react'
import { SITE } from '../../content/site'
import { LogoMark } from '../landing/LandingHeader'

const HIGHLIGHTS = [
  { icon: EyeOff, text: 'Double-blind peer review' },
  { icon: CalendarDays, text: 'Programme, rooms and sessions' },
  { icon: Award, text: 'QR check-in and certificates' },
]

/**
 * Shared frame for the signed-out account pages (sign in, sign up, forgot/reset/set password): a brand panel on
 * the left from lg up, the form on the right. On smaller screens it's just the form, with the logo above it.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  wide = false,
  centered = false,
}: {
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** Wider form column, for the longer sign-up form. */
  wide?: boolean
  /** Centre the heading block (confirmation/dead-link states). */
  centered?: boolean
}) {
  return (
    <div className="flex min-h-screen bg-page-bg">
      <aside className="relative hidden w-[44%] max-w-[640px] flex-col justify-between overflow-hidden bg-brand p-12 text-on-brand lg:flex">
        <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:20px_20px] [mask-image:linear-gradient(to_bottom,black,transparent)]" aria-hidden="true" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-white/10 blur-3xl" aria-hidden="true" />

        <Link to="/" className="relative flex items-center gap-2.5 font-semibold">
          <LogoMark size={36} onDark />
          <span>{SITE.name}</span>
        </Link>

        <div className="relative">
          <p className="font-display text-4xl font-semibold leading-tight tracking-tight">{SITE.hero.headline}</p>
          <p className="mt-4 max-w-md text-lg leading-relaxed text-on-brand/75">{SITE.hero.subheadline}</p>
          <ul className="mt-10 space-y-4">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-on-brand/90">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                  <Icon size={18} aria-hidden="true" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm text-on-brand/50">© {new Date().getFullYear()} {SITE.name}</p>
      </aside>

      <main className="flex flex-1 flex-col">
        <div className="flex items-center justify-between px-4 py-4 sm:px-8">
          <Link to="/" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-text-muted hover:bg-surface-muted/50 hover:text-text">
            <ArrowLeft size={16} aria-hidden="true" />
            Home
          </Link>
        </div>

        <div className="flex flex-1 items-start justify-center px-4 pb-12 pt-2 sm:items-center sm:px-8 sm:pt-0">
          <div className={`w-full ${wide ? 'max-w-lg' : 'max-w-md'}`}>
            <div className={centered ? 'text-center' : ''}>
              <Link to="/" className={`mb-6 lg:hidden ${centered ? 'inline-flex' : 'flex'}`} aria-label={`${SITE.name} home`}>
                <img src="/logo.png" alt="" className="h-12 w-auto" />
              </Link>
              <h1 className="font-display text-3xl font-semibold tracking-tight text-text">{title}</h1>
              {subtitle ? <p className="mt-2 text-text-muted">{subtitle}</p> : null}
            </div>
            <div className="mt-8 rounded-2xl border border-border-soft bg-surface p-6 shadow-card sm:p-8">{children}</div>
            {footer ? <div className="mt-6 text-center text-sm text-text-muted">{footer}</div> : null}
          </div>
        </div>
      </main>
    </div>
  )
}

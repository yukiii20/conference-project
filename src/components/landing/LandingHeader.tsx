import { forwardRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { SITE } from '../../content/site'

type LandingHeaderProps = {
  /** Currently active section id, when rendered on the home page (enables scroll-spy highlighting). */
  activeSection?: string
  /** Smooth-scroll handler, provided only on the home page. When absent, nav links go to "/#id" instead. */
  onNavigate?: (id: string) => void
}

export const LandingHeader = forwardRef<HTMLElement, LandingHeaderProps>(function LandingHeader(
  { activeSection, onNavigate },
  ref,
) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header ref={ref} className="sticky top-0 z-30 border-b border-landing-border bg-white">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link to="/" className="flex items-center gap-2 font-semibold text-landing-text">
          <LogoMark />
          <span>{SITE.name}</span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm md:flex">
          {SITE.nav.map((item) =>
            onNavigate ? (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={activeSection === item.id ? 'true' : undefined}
                className={
                  activeSection === item.id
                    ? 'font-medium text-landing-navy-600'
                    : 'text-landing-muted hover:text-landing-text'
                }
              >
                {item.label}
              </button>
            ) : (
              <Link key={item.id} to={`/#${item.id}`} className="text-landing-muted hover:text-landing-text">
                {item.label}
              </Link>
            ),
          )}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            to="/login"
            className="rounded-md border border-landing-border px-4 py-2 text-sm font-medium text-landing-text hover:bg-landing-navy-100"
          >
            Sign in
          </Link>
          <Link
            to="/signup"
            className="rounded-md bg-landing-navy-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Register
          </Link>
        </div>

        <button
          type="button"
          aria-expanded={mobileOpen}
          aria-controls="landing-mobile-menu"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMobileOpen((v) => !v)}
          className="rounded-md p-2 text-landing-text hover:bg-landing-navy-100 md:hidden"
        >
          {mobileOpen ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>

      {mobileOpen ? (
        <div id="landing-mobile-menu" className="border-t border-landing-border bg-white px-4 py-3 md:hidden">
          <nav className="flex flex-col gap-1">
            {SITE.nav.map((item) =>
              onNavigate ? (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setMobileOpen(false)
                    onNavigate(item.id)
                  }}
                  aria-current={activeSection === item.id ? 'true' : undefined}
                  className={`rounded-md px-2 py-2.5 text-left text-base ${
                    activeSection === item.id ? 'font-medium text-landing-navy-600' : 'text-landing-text'
                  }`}
                >
                  {item.label}
                </button>
              ) : (
                <Link
                  key={item.id}
                  to={`/#${item.id}`}
                  onClick={() => setMobileOpen(false)}
                  className="rounded-md px-2 py-2.5 text-base text-landing-text"
                >
                  {item.label}
                </Link>
              ),
            )}
          </nav>
          <div className="mt-3 flex gap-2 border-t border-landing-border pt-3">
            <Link
              to="/login"
              onClick={() => setMobileOpen(false)}
              className="flex-1 rounded-md border border-landing-border px-3 py-2 text-center text-sm font-medium"
            >
              Sign in
            </Link>
            <Link
              to="/signup"
              onClick={() => setMobileOpen(false)}
              className="flex-1 rounded-md bg-landing-navy-600 px-3 py-2 text-center text-sm font-medium text-white"
            >
              Register
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  )
})

/** The platform logo; falls back to the text name if /logo.png fails to load. */
export function LogoMark({ size = 28 }: { size?: number }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return <span className="font-bold text-landing-navy-600">{SITE.shortName}</span>
  }
  return (
    <img
      src="/logo.png"
      alt={`${SITE.name} logo`}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="shrink-0 object-contain"
      onError={() => setFailed(true)}
    />
  )
}

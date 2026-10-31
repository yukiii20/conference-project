import { forwardRef, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
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
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const navLinkClass = (active: boolean) =>
    `relative rounded-md px-3 py-2 text-sm font-medium transition-colors ${
      active ? 'text-brand' : 'text-text-muted hover:text-text'
    }`

  return (
    <header
      ref={ref}
      className={`sticky top-0 z-30 border-b bg-page-bg/85 backdrop-blur-md transition-shadow supports-[backdrop-filter]:bg-page-bg/70 ${
        scrolled || mobileOpen ? 'border-border-soft shadow-[0_1px_12px_rgb(43_36_32/0.06)]' : 'border-transparent'
      }`}
    >
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/" className="flex min-w-0 items-center gap-2.5 font-semibold text-text">
          <LogoMark size={32} />
          <span className="truncate text-[15px] tracking-tight">{SITE.name}</span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
          {SITE.nav.map((item) => {
            const active = activeSection === item.id
            return onNavigate ? (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={active ? 'true' : undefined}
                className={navLinkClass(active)}
              >
                {item.label}
                {active ? <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-brand" aria-hidden="true" /> : null}
              </button>
            ) : (
              <Link key={item.id} to={`/#${item.id}`} className={navLinkClass(false)}>
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Link
            to="/login"
            className="rounded-lg px-4 py-2 text-sm font-medium text-text hover:bg-surface-muted/60"
          >
            Sign in
          </Link>
          <Link
            to="/signup"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand shadow-sm transition-colors hover:bg-brand-hover"
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
          className="-mr-2 rounded-lg p-2 text-text hover:bg-surface-muted/60 lg:hidden"
        >
          {mobileOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        </button>
      </div>

      {mobileOpen ? (
        <div id="landing-mobile-menu" className="border-t border-border-soft bg-page-bg px-4 pb-4 pt-2 lg:hidden">
          <nav className="flex flex-col" aria-label="Main">
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
                  className={`rounded-lg px-3 py-3 text-left text-base ${
                    activeSection === item.id ? 'bg-surface font-medium text-brand' : 'text-text'
                  }`}
                >
                  {item.label}
                </button>
              ) : (
                <Link
                  key={item.id}
                  to={`/#${item.id}`}
                  onClick={() => setMobileOpen(false)}
                  className="rounded-lg px-3 py-3 text-base text-text"
                >
                  {item.label}
                </Link>
              ),
            )}
          </nav>
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border-soft pt-4">
            <Link
              to="/login"
              onClick={() => setMobileOpen(false)}
              className="rounded-lg border border-border px-3 py-2.5 text-center text-sm font-medium text-text"
            >
              Sign in
            </Link>
            <Link
              to="/signup"
              onClick={() => setMobileOpen(false)}
              className="rounded-lg bg-brand px-3 py-2.5 text-center text-sm font-medium text-on-brand"
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
export function LogoMark({ size = 28, onDark = false }: { size?: number; onDark?: boolean }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return <span className={`font-bold ${onDark ? 'text-white' : 'text-brand'}`}>{SITE.shortName}</span>
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-lg ${onDark ? 'bg-white p-1' : ''}`}
      style={{ width: size, height: size }}
    >
      <img
        src="/logo.png"
        alt={`${SITE.name} logo`}
        width={size}
        height={size}
        className="h-full w-full object-contain"
        onError={() => setFailed(true)}
      />
    </span>
  )
}

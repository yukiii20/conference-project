import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Mail } from 'lucide-react'
import { SITE } from '../../content/site'
import { usePlatformSettings } from '../../lib/platformSettings'
import { LogoMark } from './LandingHeader'

function gmailComposeHref(email: string): string {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}`
}

export function LandingFooter() {
  const year = new Date().getFullYear()
  const columns = [SITE.footer.columns.platform, SITE.footer.columns.account, SITE.footer.columns.legal]
  const platformSettings = usePlatformSettings()
  const platformName = platformSettings?.platform_name ?? SITE.name
  const footerText = platformSettings?.footer_text ?? SITE.footer.description
  const contactEmail = platformSettings?.support_email ?? SITE.contactEmail
  const navigate = useNavigate()
  const location = useLocation()

  /**
   * These links point at home-page section ids (#conferences, #suggestions,
   * ...) but the footer also renders on pages that aren't the home page
   * (Privacy, Terms) — a plain `<a href="#foo">` there would just add the
   * hash to the current URL instead of taking the visitor to that section.
   * Already on "/": scroll straight there. Anywhere else: navigate home
   * with the hash — HomePage's own mount effect does the scroll once it loads.
   */
  function handleSectionLink(e: React.MouseEvent<HTMLAnchorElement>, hash: string) {
    e.preventDefault()
    if (location.pathname === '/') {
      document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      window.history.replaceState(null, '', hash)
    } else {
      navigate(`/${hash}`)
    }
  }

  return (
    <footer className="relative overflow-hidden bg-footer text-white">
      <div className="pointer-events-none absolute -right-40 -top-40 h-[420px] w-[420px] rounded-full bg-indigo/15 blur-3xl" aria-hidden="true" />
      <div className="relative mx-auto max-w-[1240px] px-4 pb-10 pt-16 sm:px-6 lg:pt-20">
        <div className="flex flex-col gap-8 border-b border-white/10 pb-14 lg:flex-row lg:items-end lg:justify-between">
          <p className="max-w-2xl font-display text-4xl font-semibold leading-[1.08] tracking-[-0.015em] sm:text-5xl">
            Where research <span className="italic text-gold">meets</span> the world.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <a
              href="/#conferences"
              onClick={(e) => handleSectionLink(e, '#conferences')}
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-brand transition hover:bg-gold"
            >
              Explore conferences
              <ArrowRight size={16} aria-hidden="true" className="transition-transform duration-300 group-hover:translate-x-1" />
            </a>
            <Link
              to="/signup"
              className="inline-flex items-center justify-center rounded-full border border-white/20 px-6 py-3 text-sm font-medium text-white transition hover:border-white/50"
            >
              Create an account
            </Link>
          </div>
        </div>

        <div className="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5 font-semibold">
              <LogoMark size={32} onDark />
              <span>{platformName}</span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/60">{footerText}</p>
            <a
              href={gmailComposeHref(contactEmail)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 break-all text-sm text-white/80 hover:text-white"
            >
              <Mail size={16} aria-hidden="true" className="shrink-0" />
              {contactEmail}
            </a>
          </div>

          {columns.map((col) => (
            <div key={col.heading}>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/60">{col.heading}</p>
              <ul className="mt-4 space-y-2.5 text-sm">
                {col.links.map((link) =>
                  'to' in link ? (
                    <li key={link.label}>
                      <Link to={link.to} className="text-white/70 transition-colors hover:text-white">
                        {link.label}
                      </Link>
                    </li>
                  ) : (
                    <li key={link.label}>
                      <a
                        href={`/${link.href}`}
                        onClick={(e) => handleSectionLink(e, link.href)}
                        className="text-white/70 transition-colors hover:text-white"
                      >
                        {link.label}
                      </a>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-white/10 pt-6 text-sm text-white/45 sm:flex-row sm:items-center sm:justify-between">
          <span>
            © {year} {platformName}
          </span>
          <span className="flex flex-col gap-1 sm:flex-row sm:gap-4">
            <span>Banepa, Nepal</span>
            <span>
              Photography via{' '}
              <a href="https://unsplash.com/license" target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:text-white hover:underline">
                Unsplash
              </a>
            </span>
          </span>
        </div>
      </div>
    </footer>
  )
}

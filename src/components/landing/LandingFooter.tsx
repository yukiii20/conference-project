import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, CalendarCheck, Mail, MapPin } from 'lucide-react'
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
    <footer className="bg-footer text-white">
      <div className="mx-auto max-w-[1240px] px-4 pb-8 pt-14 sm:px-6 lg:pt-16">
        {/* Organiser call-to-action, as its own panel */}
        <div className="flex flex-col gap-6 rounded-2xl border border-white/10 bg-white/[0.04] p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold sm:flex" aria-hidden="true">
              <CalendarCheck size={22} />
            </span>
            <div>
              <p className="font-display text-xl font-semibold sm:text-2xl">Organising a conference?</p>
              <p className="mt-1 max-w-lg text-sm leading-relaxed text-white/65">
                We'll set it up for you: call for papers, reviewers, programme, registration and certificates.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:shrink-0">
            <a
              href="/#contact"
              onClick={(e) => handleSectionLink(e, '#contact')}
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-brand transition hover:bg-gold"
            >
              Get in touch
              <ArrowRight size={16} aria-hidden="true" className="transition-transform duration-300 group-hover:translate-x-1" />
            </a>
            <a
              href="/#conferences"
              onClick={(e) => handleSectionLink(e, '#conferences')}
              className="inline-flex items-center justify-center rounded-full border border-white/20 px-5 py-2.5 text-sm font-medium text-white transition hover:border-white/50"
            >
              Browse conferences
            </a>
          </div>
        </div>

        <div className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <Link to="/" className="inline-flex items-center gap-2.5 font-semibold">
              <LogoMark size={32} onDark />
              <span>{platformName}</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/60">{footerText}</p>
            <ul className="mt-5 space-y-2 text-sm">
              <li>
                <a
                  href={gmailComposeHref(contactEmail)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 break-all text-white/80 hover:text-white"
                >
                  <Mail size={15} aria-hidden="true" className="shrink-0 text-gold" />
                  {contactEmail}
                </a>
              </li>
              <li className="inline-flex items-center gap-2 text-white/60">
                <MapPin size={15} aria-hidden="true" className="shrink-0 text-gold" />
                Banepa, Nepal
              </li>
            </ul>
          </div>

          {columns.map((col) => (
            <div key={col.heading}>
              <p className="text-sm font-semibold text-white">{col.heading}</p>
              <ul className="mt-4 space-y-2.5 text-sm">
                {col.links.map((link) =>
                  'to' in link ? (
                    <li key={link.label}>
                      <Link to={link.to} className="text-white/60 transition-colors hover:text-white">
                        {link.label}
                      </Link>
                    </li>
                  ) : (
                    <li key={link.label}>
                      <a
                        href={`/${link.href}`}
                        onClick={(e) => handleSectionLink(e, link.href)}
                        className="text-white/60 transition-colors hover:text-white"
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

        <div className="mt-12 flex flex-col gap-3 border-t border-white/10 pt-6 text-sm text-white/45 sm:flex-row sm:items-center sm:justify-between">
          <span>
            © {year} {platformName}
          </span>
          <Link to="/SYPN" className="group inline-flex flex-wrap items-center gap-x-1.5 hover:text-white">
            Made by
            <span className="font-semibold tracking-[0.1em] text-gold">SYPN</span>
            <span className="text-white/35 group-hover:text-white/70">— Sonika, Yuki, Prashant &amp; Nabin</span>
          </Link>
        </div>
      </div>
    </footer>
  )
}

import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Mail } from 'lucide-react'
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
      <div className="mx-auto max-w-[1200px] px-4 pb-10 pt-14 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
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
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40">{col.heading}</p>
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
          <span>Banepa, Nepal</span>
        </div>
      </div>
    </footer>
  )
}

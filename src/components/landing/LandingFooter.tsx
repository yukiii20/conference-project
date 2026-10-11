import { Link } from 'react-router-dom'
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

  return (
    <footer className="bg-landing-navy-900 text-white">
      <div className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2 font-semibold">
              <LogoMark size={28} />
              <span>{platformName}</span>
            </div>
            <p className="mt-3 max-w-xs text-sm text-white/70">{footerText}</p>
            <a
              href={gmailComposeHref(contactEmail)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-sm text-white/80 hover:text-white"
            >
              {contactEmail}
            </a>
          </div>

          {columns.map((col) => (
            <div key={col.heading}>
              <p className="text-sm font-semibold uppercase tracking-wide text-white/50">{col.heading}</p>
              <ul className="mt-3 space-y-2 text-sm">
                {col.links.map((link) =>
                  'to' in link ? (
                    <li key={link.label}>
                      <Link to={link.to} className="text-white/80 hover:text-white">
                        {link.label}
                      </Link>
                    </li>
                  ) : (
                    <li key={link.label}>
                      <a href={link.href} className="text-white/80 hover:text-white">
                        {link.label}
                      </a>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 border-t border-white/10 pt-6 text-sm text-white/50">
          © {year} {platformName} · Banepa, Nepal
        </div>
      </div>
    </footer>
  )
}

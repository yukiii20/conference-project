import { useEffect } from 'react'
import { LandingHeader } from '../components/landing/LandingHeader'
import { LandingFooter } from '../components/landing/LandingFooter'
import { SITE, LEGAL_LAST_UPDATED } from '../content/site'

// TEMPLATE NOTICE: this is a plain-English starting point describing how the
// system actually works today. It has not been reviewed by a lawyer — have
// it checked against your jurisdiction's requirements before public launch.

export function TermsPage() {
  useEffect(() => {
    const prevTitle = document.title
    document.title = `Terms of use — ${SITE.name}`
    return () => {
      document.title = prevTitle
    }
  }, [])

  return (
    <div className="min-h-screen bg-page-bg text-text">
      {/* eslint-disable-next-line react/no-danger */}
      <div
        dangerouslySetInnerHTML={{
          __html:
            '<!-- TEMPLATE: these terms of use are a starting point and have not been reviewed by a lawyer. Have them checked against your jurisdiction\'s requirements before public launch. -->',
        }}
      />
      <LandingHeader />
      <main className="mx-auto max-w-[760px] px-4 py-14 sm:px-6">
        <h1 className="font-display text-4xl font-semibold tracking-tight">Terms of use</h1>
        <p className="mt-2 text-sm text-text-muted">Last updated: {LEGAL_LAST_UPDATED}</p>

        <div className="mt-8 space-y-8 text-text [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_p]:leading-relaxed [&_p]:mt-3 [&_p]:text-text-muted [&_li]:mt-2 [&_li]:text-text-muted [&_ul]:list-disc [&_ul]:pl-5">
          <section>
            <h2>Accounts and accurate information</h2>
            <p>
              You must provide accurate name, email and contact details when you create an account. You are
              responsible for keeping your account credentials secure and for activity under your account. New
              accounts are approved by the convenor of the conference you apply to before they become active.
            </p>
          </section>

          <section>
            <h2>Originality of submissions</h2>
            <p>
              By submitting an abstract or paper, you confirm it is your own original work (or your co-authors'),
              has not been published elsewhere in substantially the same form, and does not infringe anyone else's
              rights.
            </p>
          </section>

          <section>
            <h2>Reviewer confidentiality</h2>
            <p>
              If you act as a reviewer, you agree to keep the content of submissions assigned to you confidential,
              to review in good faith, and not to use what you see for any purpose other than the review itself.
            </p>
          </section>

          <section>
            <h2>Acceptable use</h2>
            <p>
              Do not use the platform to upload unlawful, infringing or harmful content, attempt to access accounts
              or data that are not yours, or interfere with the platform's normal operation.
            </p>
          </section>

          <section>
            <h2>Organiser responsibilities</h2>
            <p>
              Convenors and staff are responsible for the accuracy of the conference information they publish
              (dates, tracks, dead­lines, decisions) and for following a fair review process for the conferences
              they manage.
            </p>
          </section>

          <section>
            <h2>No guarantee of acceptance</h2>
            <p>
              Submitting an abstract or paper does not guarantee acceptance. Decisions are made by each
              conference's reviewers and convenor, based on their own criteria and schedule.
            </p>
          </section>

          <section>
            <h2>Changes to these terms</h2>
            <p>
              We may update these terms from time to time. We'll update the "Last updated" date above when we do;
              continuing to use the platform after a change means you accept the updated terms.
            </p>
          </section>

          <section>
            <h2>Contact</h2>
            <p>
              Questions about these terms? Email{' '}
              <a
                href={SITE.contactGmailHref}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-brand underline"
              >
                {SITE.contactEmail}
              </a>
              .
            </p>
          </section>
        </div>
      </main>
      <LandingFooter />
    </div>
  )
}

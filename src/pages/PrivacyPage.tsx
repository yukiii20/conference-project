import { useEffect } from 'react'
import { LandingHeader } from '../components/landing/LandingHeader'
import { LandingFooter } from '../components/landing/LandingFooter'
import { SITE, LEGAL_LAST_UPDATED } from '../content/site'

// TEMPLATE NOTICE: this is a plain-English starting point describing how the
// system actually works today. It has not been reviewed by a lawyer — have
// it checked against your jurisdiction's requirements before public launch.

export function PrivacyPage() {
  useEffect(() => {
    const prevTitle = document.title
    document.title = `Privacy policy — ${SITE.name}`
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
            '<!-- TEMPLATE: this privacy policy is a starting point and has not been reviewed by a lawyer. Have it checked against your jurisdiction\'s requirements before public launch. -->',
        }}
      />
      <LandingHeader />
      <main className="mx-auto max-w-[760px] px-4 py-14 sm:px-6">
        <h1 className="font-display text-4xl font-semibold tracking-tight">Privacy policy</h1>
        <p className="mt-2 text-sm text-text-muted">Last updated: {LEGAL_LAST_UPDATED}</p>

        <div className="mt-8 space-y-8 text-text [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_p]:leading-relaxed [&_p]:mt-3 [&_p]:text-text-muted [&_li]:mt-2 [&_li]:text-text-muted [&_ul]:list-disc [&_ul]:pl-5">
          <section>
            <h2>What we collect</h2>
            <p>When you create an account or take part in a conference, we collect:</p>
            <ul>
              <li>Your name, email address and phone number</li>
              <li>Your institution, department and position, if you add them to your profile</li>
              <li>A profile photo, if you choose to upload one</li>
              <li>Submissions you make (abstracts, full papers, slides and related files) and any reviews or decisions linked to them</li>
              <li>Basic sign-in data, such as when you logged in, needed to keep your account secure</li>
            </ul>
          </section>

          <section>
            <h2>Why we collect it</h2>
            <p>
              We use this information to run the conference process: creating and approving accounts, routing
              submissions to reviewers, recording decisions, building the programme, issuing certificates, and
              emailing you about the status of your account or submissions.
            </p>
          </section>

          <section>
            <h2>Who can see what</h2>
            <ul>
              <li>
                <strong>Reviewers</strong> see the content of the submissions assigned to them, but never the
                author's name or affiliation — review is double-blind.
              </li>
              <li>
                <strong>Convenors and staff</strong> can see full details, but only for their own conference, not
                for other conferences on the platform.
              </li>
              <li>
                <strong>Platform administrators</strong> can see account and conference data as needed to operate
                the platform and help with support requests.
              </li>
              <li>Your public profile information (such as your name) may be shown on programmes or certificates for conferences you take part in.</li>
            </ul>
          </section>

          <section>
            <h2>Where it is stored</h2>
            <p>
              Data is stored in our own MySQL database and private file storage. Access is controlled by role-based
              permissions enforced by the backend, so accounts only see what their role allows.
            </p>
          </section>

          <section>
            <h2>Emails we send</h2>
            <p>
              We send emails tied to your account activity: role approvals or rejections, submission confirmations,
              reviewer assignments, decisions, and password reset links. We do not send marketing email.
            </p>
          </section>

          <section>
            <h2>How long we keep data</h2>
            <p>
              We keep account and submission data for as long as your account is active and for a reasonable period
              afterwards, to preserve the academic record of accepted conferences (titles, authors, decisions).
              Files you remove (such as a replaced profile photo) are deleted from storage.
            </p>
          </section>

          <section>
            <h2>Your rights</h2>
            <p>
              You can view and correct most of your information from your profile at any time. To ask us to
              delete your account or export your data, contact us using the email below.
            </p>
          </section>

          <section>
            <h2>Contact</h2>
            <p>
              Questions about this policy? Email{' '}
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

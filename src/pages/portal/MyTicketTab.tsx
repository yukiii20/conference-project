import { RegistrationPanel } from '../conference/RegistrationPanel'
import { PageHeader } from '../../components/ui'

// Same component the public conference page uses for "Register / My ticket"
// — reused as-is here, just with the portal's fixed button colour instead
// of a conference's dynamic branding accent.
const PORTAL_ACCENT = '#2747a0'

export function MyTicketTab({ conferenceId }: { conferenceId: string | null }) {
  return (
    <div className="mt-6 max-w-2xl">
      <PageHeader title="My ticket" subtitle="Your registration and check-in QR code for this conference." />
      {conferenceId ? (
        <div className="mt-4">
          <RegistrationPanel conferenceId={conferenceId} accent={PORTAL_ACCENT} />
        </div>
      ) : (
        <p className="mt-4 rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-sm text-text-muted">
          Choose a conference above to see your registration.
        </p>
      )}
    </div>
  )
}

import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/authContext'
import { getRoleDefinition } from '../lib/roles'
import { PortalHeader } from './PortalHeader'

/**
 * Identity, roles and the matched conference come only from the shared auth
 * context (GET /api/auth/me) — never from a client-side auth SDK session.
 */
export function SimpleRolePage({ role }: { role: string }) {
  const [searchParams] = useSearchParams()
  const preselectedSlug = searchParams.get('conference')?.trim() || null
  const { user, roles } = useAuth()
  const roleDef = getRoleDefinition(role)

  const mine = roles.filter((r) => r.role_code === role && r.conference_id)
  const preselected = preselectedSlug ? mine.find((r) => r.conference_slug === preselectedSlug) : null
  const match = preselected ?? mine[0] ?? null

  return (
    <div className="min-h-screen bg-background text-ink">
      <PortalHeader roleLabel={roleDef?.label ?? role} />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-semibold">Welcome, {user?.full_name || user?.email || 'there'}</h1>

        {match ? (
          <div className="mt-6 rounded-xl border border-line bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-ink">{match.conference_name}</h2>
            <p className="mt-1 text-sm text-ink/60">
              You're set up as {roleDef?.label?.toLowerCase() ?? role} for this conference.
            </p>
          </div>
        ) : (
          <p className="mt-6 rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">
            You are not set up as {roleDef?.label?.toLowerCase() ?? role} for any conference yet.
          </p>
        )}
      </main>
    </div>
  )
}

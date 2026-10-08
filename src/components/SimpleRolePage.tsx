import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getRoleDefinition } from '../lib/roles'
import type { MyRoleRequestRow } from '../lib/types'
import { PortalHeader } from './PortalHeader'

type ConferenceInfo = {
  name: string
  short_name: string | null
  theme: string | null
  description: string | null
  venue_name: string | null
  address: string | null
  city: string | null
  country: string | null
  contact_email: string | null
  contact_phone: string | null
  website_url: string | null
}

export function SimpleRolePage({ role }: { role: string }) {
  const [searchParams] = useSearchParams()
  const preselectedSlug = searchParams.get('conference')?.trim() || null

  const [userName, setUserName] = useState('')
  const [conference, setConference] = useState<ConferenceInfo | null>(null)
  const [conferenceError, setConferenceError] = useState<string | null>(null)
  const roleDef = getRoleDefinition(role)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) return

      const [{ data: profile }, { data: requestsData }] = await Promise.all([
        supabase.from('profiles').select('full_name').eq('id', userData.user.id).single(),
        supabase.rpc('get_my_role_requests'),
      ])

      if (cancelled) return
      setUserName(profile?.full_name ?? userData.user.email ?? '')

      const requests = (requestsData ?? []) as MyRoleRequestRow[]
      const approved = requests.filter((r) => r.role_code === role && r.status === 'approved')

      let match = approved[0]
      if (preselectedSlug && approved.length > 1) {
        const { data: slugRows } = await supabase
          .from('conferences')
          .select('id, slug')
          .in('id', approved.map((r) => r.conference_id))
        const preselectedId = (slugRows ?? []).find((c) => c.slug === preselectedSlug)?.id
        match = approved.find((r) => r.conference_id === preselectedId) ?? match
      }

      if (!match?.conference_id) return

      const { data: conferenceData, error } = await supabase
        .from('conferences')
        .select(
          'name, short_name, theme, description, venue_name, address, city, country, contact_email, contact_phone, website_url',
        )
        .eq('id', match.conference_id)
        .single()

      if (cancelled) return

      if (error) {
        setConferenceError(error.message)
      } else {
        setConference(conferenceData)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [role, preselectedSlug])

  return (
    <div className="min-h-screen bg-background text-ink">
      <PortalHeader roleLabel={roleDef?.label ?? role} />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-semibold">Welcome, {userName || 'there'}</h1>

        {conferenceError ? (
          <p className="mt-3 text-sm text-red-600">{conferenceError}</p>
        ) : null}

        {conference ? (
          <div className="mt-6 rounded-xl border border-line bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-ink">{conference.name}</h2>
            {conference.short_name || conference.theme ? (
              <p className="mt-1 text-sm text-ink/60">
                {[conference.short_name, conference.theme].filter(Boolean).join(' · ')}
              </p>
            ) : null}

            {conference.description ? (
              <p className="mt-4 whitespace-pre-line text-sm text-ink/80">{conference.description}</p>
            ) : null}

            {conference.venue_name || conference.address || conference.city ? (
              <div className="mt-4 border-t border-line pt-4">
                <h3 className="text-sm font-medium text-ink">Venue</h3>
                <p className="mt-1 text-sm text-ink/70">
                  {[conference.venue_name, conference.address, conference.city, conference.country]
                    .filter(Boolean)
                    .join(', ')}
                </p>
              </div>
            ) : null}

            {conference.contact_email || conference.contact_phone || conference.website_url ? (
              <div className="mt-4 border-t border-line pt-4">
                <h3 className="text-sm font-medium text-ink">Contact</h3>
                <ul className="mt-1 space-y-1 text-sm text-ink/70">
                  {conference.contact_email ? <li>{conference.contact_email}</li> : null}
                  {conference.contact_phone ? <li>{conference.contact_phone}</li> : null}
                  {conference.website_url ? (
                    <li>
                      <a
                        href={conference.website_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-button underline"
                      >
                        {conference.website_url}
                      </a>
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </main>
    </div>
  )
}

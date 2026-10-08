import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getRoleDefinition } from '../../lib/roles'
import type { MyRoleRow } from '../../lib/types'
import { SignInForm } from './SignInForm'
import { SignUpForm } from './SignUpForm'

type Tab = 'signin' | 'signup'

type SignedInInfo = {
  name: string
  roles: { code: string; label: string; path: string }[]
}

export function AuthCard({ conference }: { conference: { id: string; slug: string; name: string } }) {
  const [tab, setTab] = useState<Tab>('signin')
  const [checking, setChecking] = useState(true)
  const [signedIn, setSignedIn] = useState<SignedInInfo | null>(null)

  useEffect(() => {
    let cancelled = false

    async function check() {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) {
        if (!cancelled) {
          setSignedIn(null)
          setChecking(false)
        }
        return
      }

      const [{ data: profile }, { data: rolesData }] = await Promise.all([
        supabase.from('profiles').select('full_name').eq('id', userData.user.id).single(),
        supabase.rpc('get_my_roles'),
      ])
      if (cancelled) return

      const roles = (rolesData ?? []) as MyRoleRow[]
      const hereRoles = roles
        .filter((r) => r.conference_id === conference.id && r.role_code !== 'admin')
        .map((r) => {
          const def = getRoleDefinition(r.role_code)
          return { code: r.role_code, label: def?.label ?? r.role_code, path: def?.path ?? '/' }
        })

      setSignedIn({ name: profile?.full_name ?? userData.user.email ?? 'there', roles: hereRoles })
      setChecking(false)
    }

    check()
    return () => {
      cancelled = true
    }
  }, [conference.id])

  async function handleSignOut() {
    await supabase.auth.signOut()
    setSignedIn(null)
    setTab('signin')
  }

  if (checking) {
    return <div className="rounded-xl border border-line bg-white p-6 shadow-sm">&nbsp;</div>
  }

  if (signedIn) {
    return (
      <div className="rounded-xl border border-line bg-white p-6 shadow-sm">
        <p className="text-sm text-ink/60">Signed in as</p>
        <p className="text-lg font-semibold text-ink">{signedIn.name}</p>

        {signedIn.roles.length === 0 ? (
          <p className="mt-4 text-sm text-ink/70">
            You don't hold a role for this conference yet. Use "Create account" above with a different browser session,
            or ask the convenor to add you.
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {signedIn.roles.map((r) => (
              <a
                key={r.code}
                href={`${r.path}?conference=${conference.slug}`}
                className="block rounded-md bg-button px-4 py-2 text-center text-sm font-medium text-white hover:opacity-90"
              >
                Open {r.label} portal
              </a>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={handleSignOut}
          className="mt-4 w-full rounded-md border border-line px-4 py-2 text-sm font-medium hover:bg-background"
        >
          Sign out
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-line bg-white p-6 shadow-sm">
      <div className="flex gap-2 border-b border-line">
        <button
          type="button"
          onClick={() => setTab('signin')}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
            tab === 'signin' ? 'border-button text-button' : 'border-transparent text-ink/60'
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setTab('signup')}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
            tab === 'signup' ? 'border-button text-button' : 'border-transparent text-ink/60'
          }`}
        >
          Create account
        </button>
      </div>

      <div className="mt-5">
        {tab === 'signin' ? (
          <SignInForm conferenceSlug={conference.slug} />
        ) : (
          <SignUpForm preselectedSlug={conference.slug} showSignInLink={false} />
        )}
      </div>
    </div>
  )
}

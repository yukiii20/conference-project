import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { AuthShell } from '../components/auth/AuthShell'
import { ConferenceChooser } from '../components/auth/ConferenceChooser'

/**
 * /login — "Choose your conference". Each conference has its own sign-in page
 * (/c/:slug/login) because a role only works at its own conference.
 * Old links of the form /login?conference=<slug> go straight to that page.
 */
export function LoginPage() {
  const [searchParams] = useSearchParams()
  const slug = searchParams.get('conference')?.trim()
  if (slug) return <Navigate to={`/c/${encodeURIComponent(slug)}/login`} replace />

  return (
    <AuthShell
      title="Choose your conference"
      subtitle="Sign in at the conference where you have a role."
      wide
      footer={
        <>
          Platform administrator?{' '}
          <Link to="/super-admin/login" className="font-medium text-brand underline-offset-4 hover:underline">
            Admin sign-in
          </Link>
        </>
      }
    >
      <ConferenceChooser target="login" />
    </AuthShell>
  )
}

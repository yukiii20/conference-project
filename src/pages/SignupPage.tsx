import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { AuthShell } from '../components/auth/AuthShell'
import { ConferenceChooser } from '../components/auth/ConferenceChooser'

/**
 * /signup — "Choose your conference". Sign-up always happens at one
 * conference (/c/:slug/signup). Old links of the form /signup?conference=<slug>
 * go straight to that page.
 */
export function SignupPage() {
  const [searchParams] = useSearchParams()
  const slug = searchParams.get('conference')?.trim()
  if (slug) return <Navigate to={`/c/${encodeURIComponent(slug)}/signup`} replace />

  return (
    <AuthShell
      title="Choose your conference"
      subtitle="Pick the conference you want to join. One account works for all of them — each conference approves its own roles."
      wide
      footer={
        <>
          Already have a role?{' '}
          <Link to="/login" className="font-medium text-brand underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <ConferenceChooser target="signup" />
    </AuthShell>
  )
}

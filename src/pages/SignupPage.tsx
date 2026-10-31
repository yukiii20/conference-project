import { useSearchParams } from 'react-router-dom'
import { SignUpForm } from '../components/auth/SignUpForm'
import { AuthShell } from '../components/auth/AuthShell'

export function SignupPage() {
  const [searchParams] = useSearchParams()
  const preselectedSlug = searchParams.get('conference')?.trim() || null

  return (
    <AuthShell
      title="Create an account"
      subtitle="One account works for every conference on the platform."
      wide
    >
      <SignUpForm preselectedSlug={preselectedSlug} />
    </AuthShell>
  )
}

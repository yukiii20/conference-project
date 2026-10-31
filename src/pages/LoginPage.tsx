import { Link } from 'react-router-dom'
import { SignInForm } from '../components/auth/SignInForm'
import { AuthShell } from '../components/auth/AuthShell'

export function LoginPage() {
  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back. Sign in to continue to your conference."
      footer={
        <>
          New here?{' '}
          <Link to="/signup" className="font-medium text-brand underline-offset-4 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <SignInForm />
    </AuthShell>
  )
}

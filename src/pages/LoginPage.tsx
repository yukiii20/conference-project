import { Link } from 'react-router-dom'
import { SignInForm } from '../components/auth/SignInForm'
import { Card } from '../components/ui'

export function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page-bg px-4">
      <Card className="w-full max-w-md">
        <div className="flex justify-center">
          <img src="/logo.png" alt="Conference Management System" className="h-16 w-auto rounded-md" />
        </div>
        <h1 className="mt-4 text-center text-xl font-semibold text-text">Sign in</h1>

        <div className="mt-6">
          <SignInForm />
        </div>

        <p className="mt-6 text-sm text-text-muted">
          New here?{' '}
          <Link to="/signup" className="font-medium text-brand underline">
            Create an account
          </Link>
        </p>
      </Card>
    </div>
  )
}

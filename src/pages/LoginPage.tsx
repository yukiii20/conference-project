import { Link } from 'react-router-dom'
import { SignInForm } from '../components/auth/SignInForm'

export function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-line bg-white p-8 shadow-sm">
        <div className="flex justify-center">
          <img src="/logo.png" alt="Conference Management System" className="h-16 w-auto rounded-md" />
        </div>
        <h1 className="mt-4 text-center text-xl font-semibold text-ink">Sign in</h1>

        <div className="mt-6">
          <SignInForm />
        </div>

        <p className="mt-6 text-sm text-ink/70">
          New here?{' '}
          <Link to="/signup" className="font-medium text-button underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  )
}

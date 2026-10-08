import { useSearchParams } from 'react-router-dom'
import { SignUpForm } from '../components/auth/SignUpForm'

export function SignupPage() {
  const [searchParams] = useSearchParams()
  const preselectedSlug = searchParams.get('conference')?.trim() || null

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-lg rounded-xl border border-line bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-ink">Create an account</h1>
        <div className="mt-4">
          <SignUpForm preselectedSlug={preselectedSlug} />
        </div>
      </div>
    </div>
  )
}

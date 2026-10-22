import { useSearchParams } from 'react-router-dom'
import { SignUpForm } from '../components/auth/SignUpForm'
import { Card } from '../components/ui'

export function SignupPage() {
  const [searchParams] = useSearchParams()
  const preselectedSlug = searchParams.get('conference')?.trim() || null

  return (
    <div className="flex min-h-screen items-center justify-center bg-page-bg px-4 py-10">
      <Card className="w-full max-w-lg">
        <h1 className="text-xl font-semibold text-text">Create an account</h1>
        <div className="mt-4">
          <SignUpForm preselectedSlug={preselectedSlug} />
        </div>
      </Card>
    </div>
  )
}

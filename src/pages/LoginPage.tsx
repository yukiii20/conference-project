import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { SIGNUP_ROLE_CODES, getRoleDefinition } from '../lib/roles'
import { loginSchema } from '../lib/validation'
import type { MyRoleRow, MyRoleRequestRow } from '../lib/types'

export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const parsed = loginSchema.safeParse({ email, password, role })
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (typeof key === 'string' && !(key in nextErrors)) {
          nextErrors[key] = issue.message
        }
      }
      setErrors(nextErrors)
      return
    }
    setErrors({})
    setSubmitting(true)

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    })

    if (signInError) {
      setSubmitting(false)
      setFormError('Email or password is incorrect.')
      return
    }

    const { data: rolesData } = await supabase.rpc('get_my_roles')
    const roles = (rolesData ?? []) as MyRoleRow[]
    const isConvenorOrAdmin = roles.some((r) => r.role_code === 'convenor' || r.role_code === 'admin')

    if (isConvenorOrAdmin) {
      setSubmitting(false)
      navigate('/convenor')
      return
    }

    const { data: requestsData } = await supabase.rpc('get_my_role_requests')
    const requests = (requestsData ?? []) as MyRoleRequestRow[]
    const relevant = requests.find((r) => r.role_code === parsed.data.role)

    setSubmitting(false)

    if (!relevant) {
      await supabase.auth.signOut()
      setFormError('You did not sign up for this role.')
      return
    }

    if (relevant.status === 'approved') {
      navigate(getRoleDefinition(parsed.data.role)!.path)
      return
    }

    if (relevant.status === 'pending') {
      await supabase.auth.signOut()
      setFormError("Your account is waiting for the convenor's approval.")
      return
    }

    await supabase.auth.signOut()
    setFormError(`Your request was rejected: ${relevant.reject_reason ?? 'No reason given.'}`)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-line bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-ink">Sign in</h1>

        {formError ? (
          <div role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {formError}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-ink">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
            />
            {errors.email ? <p className="mt-1 text-sm text-red-600">{errors.email}</p> : null}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="block text-sm font-medium text-ink">
                Password
              </label>
              <Link to="/forgot-password" className="text-sm text-button underline">
                Forgot password?
              </Link>
            </div>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
            />
            {errors.password ? <p className="mt-1 text-sm text-red-600">{errors.password}</p> : null}
          </div>

          <div>
            <label htmlFor="role" className="block text-sm font-medium text-ink">
              Role
            </label>
            <select
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 focus:border-button"
            >
              <option value="">Choose a role</option>
              {SIGNUP_ROLE_CODES.map((code) => (
                <option key={code} value={code}>
                  {getRoleDefinition(code)?.label}
                </option>
              ))}
            </select>
            {errors.role ? <p className="mt-1 text-sm text-red-600">{errors.role}</p> : null}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-button px-4 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

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

import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api, ApiError } from '../../lib/api'
import { LOGIN_ROLE_CODES, getRoleDefinition } from '../../lib/roles'
import { loginSchema } from '../../lib/validation'

/**
 * The sign-in form body (no page chrome). Used standalone on /login and
 * embedded in the conference page's side card — same approval logic either
 * way, so it lives in exactly one place.
 */
export function SignInForm({ conferenceSlug }: { conferenceSlug?: string }) {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('')
  const [rememberMe, setRememberMeState] = useState(true)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function portalUrl(path: string) {
    return conferenceSlug ? `${path}?conference=${conferenceSlug}` : path
  }

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

    try {
      await api.post('/auth/login', {
        email: parsed.data.email,
        password: parsed.data.password,
        role: parsed.data.role,
        remember_me: rememberMe,
      })
      setSubmitting(false)
      const path = getRoleDefinition(parsed.data.role)?.path
      navigate(path ? portalUrl(path) : '/')
    } catch (err) {
      setSubmitting(false)
      setFormError(err instanceof ApiError ? err.message : "Can't reach the server. Check your connection.")
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {formError ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {formError}
        </div>
      ) : null}

      <div>
        <label htmlFor="si-email" className="block text-sm font-medium text-ink">
          Email
        </label>
        <input
          id="si-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.email ? <p className="mt-1 text-sm text-red-600">{errors.email}</p> : null}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="si-password" className="block text-sm font-medium text-ink">
            Password
          </label>
          <Link to="/forgot-password" className="text-sm text-button underline">
            Forgotten your password?
          </Link>
        </div>
        <input
          id="si-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.password ? <p className="mt-1 text-sm text-red-600">{errors.password}</p> : null}
      </div>

      <div>
        <label htmlFor="si-role" className="block text-sm font-medium text-ink">
          Role
        </label>
        <select
          id="si-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 focus:border-button"
        >
          <option value="">Choose a role</option>
          {LOGIN_ROLE_CODES.map((code) => (
            <option key={code} value={code}>
              {getRoleDefinition(code)?.label}
            </option>
          ))}
        </select>
        {errors.role ? <p className="mt-1 text-sm text-red-600">{errors.role}</p> : null}
      </div>

      <label className="flex items-center gap-2 text-sm text-ink/70">
        <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMeState(e.target.checked)} />
        Remember me
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-button px-4 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}

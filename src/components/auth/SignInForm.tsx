import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api, ApiError } from '../../lib/api'
import { LOGIN_ROLE_CODES, getRoleDefinition } from '../../lib/roles'
import { loginSchema } from '../../lib/validation'
import { prefetchPortalChunk } from '../../lib/prefetch'
import { useAuth } from '../../lib/authContext'
import { Alert, Button, Checkbox, FormField, Input, PasswordInput, Select } from '../ui'

/** Refusals that only appear after a correct password, and get their own treatment below. */
type Refusal = { code: string; message: string }

/**
 * The sign-in form body (no page chrome) for ONE conference. A membership only
 * works at its own conference, so the form always sends that conference to
 * POST /auth/login and the server checks the role there.
 */
export function SignInForm({ conferenceSlug }: { conferenceSlug: string }) {
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('')
  const [rememberMe, setRememberMeState] = useState(true)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const encodedSlug = encodeURIComponent(conferenceSlug)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setRefusal(null)

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
        conference: conferenceSlug,
      })
      await refresh()
      setSubmitting(false)
      const path = getRoleDefinition(parsed.data.role)?.path
      prefetchPortalChunk(path)
      navigate(path ? `${path}?conference=${encodedSlug}` : '/')
    } catch (err) {
      setSubmitting(false)
      if (err instanceof ApiError && err.code && ['no_role_at_conference', 'pending_approval', 'request_rejected', 'role_not_held'].includes(err.code)) {
        setRefusal({ code: err.code, message: err.message })
        return
      }
      setFormError(err instanceof ApiError ? err.message : "Can't reach the server. Check your connection.")
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {formError ? <Alert variant="danger">{formError}</Alert> : null}

      {refusal ? (
        <Alert variant={refusal.code === 'pending_approval' ? 'info' : refusal.code === 'request_rejected' ? 'danger' : 'warning'}>
          <p>{refusal.message}</p>
          {refusal.code === 'no_role_at_conference' || refusal.code === 'role_not_held' ? (
            <Link
              to={`/c/${encodedSlug}/signup`}
              className="mt-3 inline-flex min-h-9 items-center rounded-lg bg-button px-3 text-sm font-medium text-white hover:bg-button-hover"
            >
              Request a role for this conference
            </Link>
          ) : null}
        </Alert>
      ) : null}

      <FormField label="Email" htmlFor="si-email" error={errors.email}>
        <Input
          id="si-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={Boolean(errors.email)}
        />
      </FormField>

      <div>
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="si-password" className="block text-sm font-medium text-text">
            Password
          </label>
          <Link to={`/c/${encodedSlug}/forgot-password`} className="conference-link text-sm text-brand underline">
            Forgotten your password?
          </Link>
        </div>
        <PasswordInput
          id="si-password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={Boolean(errors.password)}
          className="mt-1"
        />
        {errors.password ? (
          <p className="mt-1 text-sm text-danger" role="alert">
            {errors.password}
          </p>
        ) : null}
      </div>

      <FormField label="Role" htmlFor="si-role" error={errors.role}>
        <Select id="si-role" value={role} onChange={(e) => setRole(e.target.value)} error={Boolean(errors.role)}>
          <option value="">Choose a role</option>
          {LOGIN_ROLE_CODES.map((code) => (
            <option key={code} value={code}>
              {getRoleDefinition(code)?.label}
            </option>
          ))}
        </Select>
      </FormField>

      <Checkbox label="Remember me" checked={rememberMe} onChange={(e) => setRememberMeState(e.target.checked)} />

      <Button type="submit" loading={submitting} className="w-full">
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  )
}

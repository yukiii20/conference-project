import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../lib/api'
import { SIGNUP_ROLE_CODES, getRoleDefinition } from '../../lib/roles'
import { nameSchema, emailSchema, phoneSchema, signupSchema, getPasswordChecklist } from '../../lib/validation'

type ConferenceSlugRow = { id: string; name: string | null; code: string | null; slug: string }

type FormState = {
  full_name: string
  email: string
  phone: string
  password: string
  confirm_password: string
}

const INITIAL_FORM: FormState = {
  full_name: '',
  email: '',
  phone: '',
  password: '',
  confirm_password: '',
}

function fieldError(schema: { safeParse: (v: unknown) => any }, value: unknown): string {
  const result = schema.safeParse(value)
  return result.success ? '' : (result.error.issues[0]?.message ?? 'Invalid value.')
}

/**
 * The sign-up wizard body (no page chrome). Used standalone on /signup and
 * embedded in the conference page's side card — same validation and
 * approval flow either way, so it lives in exactly one place.
 *
 * `preselectedSlug`, when it matches a real open conference, skips the
 * conference-picker step entirely (role -> details, 2 steps instead of 3).
 */
export function SignUpForm({
  preselectedSlug,
  showSignInLink = true,
}: {
  preselectedSlug?: string | null
  showSignInLink?: boolean
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [role, setRole] = useState('')
  const [conferenceId, setConferenceId] = useState('')
  const [conferences, setConferences] = useState<ConferenceSlugRow[]>([])
  const [preselectedConference, setPreselectedConference] = useState<ConferenceSlugRow | null>(null)
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function loadConferences() {
      const data = await api.get<{ conferences: ConferenceSlugRow[] }>('/conferences/public').catch(() => null)
      if (cancelled) return
      const rows = (data?.conferences ?? [])
        .slice()
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
      setConferences(rows)

      if (preselectedSlug) {
        const match = rows.find((c) => c.slug === preselectedSlug)
        if (match) {
          setConferenceId(match.id)
          setPreselectedConference(match)
        }
      }
    }
    loadConferences()
    return () => {
      cancelled = true
    }
  }, [preselectedSlug])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function blurField(key: keyof FormState) {
    let message = ''
    if (key === 'full_name') message = fieldError(nameSchema, form.full_name)
    if (key === 'email') message = fieldError(emailSchema, form.email)
    if (key === 'phone') message = fieldError(phoneSchema, form.phone)
    if (key === 'confirm_password' && form.confirm_password && form.confirm_password !== form.password) {
      message = 'Passwords do not match.'
    }
    setErrors((prev) => ({ ...prev, [key]: message }))
  }

  function goToStep2() {
    if (!role) {
      setErrors((prev) => ({ ...prev, role: 'Choose a role to continue.' }))
      return
    }
    setErrors((prev) => ({ ...prev, role: '' }))
    // A conference came preselected — skip the picker.
    setStep(preselectedConference ? 3 : 2)
  }

  function goToStep3() {
    if (!conferenceId) {
      setErrors((prev) => ({ ...prev, conference_id: 'Choose a conference to continue.' }))
      return
    }
    setErrors((prev) => ({ ...prev, conference_id: '' }))
    setStep(3)
  }

  function goBack() {
    setStep((prev) => (prev === 3 ? (preselectedConference ? 1 : 2) : 1))
  }

  async function handleSubmit() {
    setFormError(null)

    if (!termsAccepted) {
      setErrors((prev) => ({ ...prev, terms: 'You must agree to the terms to continue.' }))
      return
    }

    const candidate = { ...form, role, conference_id: conferenceId }
    const parsed = signupSchema.safeParse(candidate)

    if (!parsed.success) {
      const nextErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (typeof key === 'string' && !(key in nextErrors)) {
          nextErrors[key] = issue.message
        }
      }
      setErrors((prev) => ({ ...prev, ...nextErrors }))
      return
    }
    setErrors({})

    setSubmitting(true)
    try {
      await api.post('/auth/register', {
        full_name: parsed.data.full_name,
        email: parsed.data.email,
        phone: parsed.data.phone,
        password: parsed.data.password,
        requested_role: parsed.data.role,
        conference_id: parsed.data.conference_id,
      })
      setSuccess(true)
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message)
        if (err.fields) setErrors((prev) => ({ ...prev, ...err.fields }))
      } else {
        setFormError('We could not create your account. Please check your details and try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="text-center">
        <h2 className="text-lg font-semibold text-ink">Account created</h2>
        <p className="mt-3 text-sm text-ink/70">The convenor must approve it before you can sign in.</p>
        {showSignInLink ? (
          <Link to="/login" className="mt-6 inline-block font-medium text-button underline">
            Back to sign in
          </Link>
        ) : null}
      </div>
    )
  }

  return (
    <div>
      <p className="text-sm text-ink/60">
        Step {step === 3 && preselectedConference ? 2 : step} of {preselectedConference ? 2 : 3}
      </p>
      {preselectedConference ? (
        <p className="mt-1 text-sm text-ink/70">
          Signing up for <span className="font-medium text-ink">{preselectedConference.name}</span>
        </p>
      ) : null}

      {formError ? <p className="mt-3 text-sm text-red-600">{formError}</p> : null}

      {step === 1 ? (
        <div className="mt-4">
          <h2 className="font-medium text-ink">Choose your role</h2>
          {errors.role ? <p className="mt-1 text-sm text-red-600">{errors.role}</p> : null}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {SIGNUP_ROLE_CODES.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setRole(code)}
                className={`rounded-lg border p-3 text-left text-sm ${
                  role === code ? 'border-button ring-2 ring-button/30' : 'border-line hover:border-button/50'
                }`}
              >
                {getRoleDefinition(code)?.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={goToStep2}
            className="mt-6 w-full rounded-md bg-button px-4 py-2 font-medium text-white hover:opacity-90"
          >
            Continue
          </button>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="mt-4">
          <h2 className="font-medium text-ink">Choose a conference</h2>
          {errors.conference_id ? <p className="mt-1 text-sm text-red-600">{errors.conference_id}</p> : null}
          <div className="mt-3 space-y-2">
            {conferences.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line bg-background px-4 py-6 text-sm text-ink/70">
                No conferences are open right now.
              </p>
            ) : (
              conferences.map((conference) => (
                <label
                  key={conference.id}
                  className={`block cursor-pointer rounded-lg border px-3 py-2 text-sm ${
                    conferenceId === conference.id ? 'border-button bg-button/5' : 'border-line bg-white'
                  }`}
                >
                  <input
                    type="radio"
                    name="conference"
                    checked={conferenceId === conference.id}
                    onChange={() => setConferenceId(conference.id)}
                    className="mr-2"
                  />
                  {conference.name}
                  {conference.code ? ` (${conference.code})` : ''}
                </label>
              ))
            )}
          </div>
          <div className="mt-6 flex justify-between">
            <button
              type="button"
              onClick={goBack}
              className="rounded-md border border-line px-4 py-2 text-sm font-medium hover:bg-background"
            >
              Back
            </button>
            <button
              type="button"
              onClick={goToStep3}
              className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Continue
            </button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="su-full_name" className="block text-sm font-medium text-ink">
              Full name
            </label>
            <input
              id="su-full_name"
              value={form.full_name}
              onChange={(e) => update('full_name', e.target.value)}
              onBlur={() => blurField('full_name')}
              aria-invalid={Boolean(errors.full_name)}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
            />
            {errors.full_name ? <p className="mt-1 text-sm text-red-600">{errors.full_name}</p> : null}
          </div>

          <div>
            <label htmlFor="su-email" className="block text-sm font-medium text-ink">
              Email
            </label>
            <input
              id="su-email"
              type="email"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              onBlur={() => blurField('email')}
              aria-invalid={Boolean(errors.email)}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
            />
            {errors.email ? <p className="mt-1 text-sm text-red-600">{errors.email}</p> : null}
          </div>

          <div>
            <label htmlFor="su-phone" className="block text-sm font-medium text-ink">
              Phone number
            </label>
            <input
              id="su-phone"
              value={form.phone}
              onChange={(e) => update('phone', e.target.value)}
              onBlur={() => blurField('phone')}
              placeholder="98XXXXXXXX"
              aria-invalid={Boolean(errors.phone)}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
            />
            {errors.phone ? <p className="mt-1 text-sm text-red-600">{errors.phone}</p> : null}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="su-password" className="block text-sm font-medium text-ink">
                Password
              </label>
              <button type="button" onClick={() => setShowPassword((v) => !v)} className="text-sm text-button underline">
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <input
              id="su-password"
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={(e) => update('password', e.target.value)}
              aria-invalid={Boolean(errors.password)}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
            />
            <ul className="mt-2 space-y-1 text-sm">
              {getPasswordChecklist(form.password).map((rule) => (
                <li key={rule.id} className={rule.passed ? 'text-green-700' : 'text-ink/50'}>
                  {rule.passed ? '✓' : '○'} {rule.label}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <label htmlFor="su-confirm_password" className="block text-sm font-medium text-ink">
              Confirm password
            </label>
            <input
              id="su-confirm_password"
              type={showPassword ? 'text' : 'password'}
              value={form.confirm_password}
              onChange={(e) => update('confirm_password', e.target.value)}
              onBlur={() => blurField('confirm_password')}
              aria-invalid={Boolean(errors.confirm_password)}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
            />
            {errors.confirm_password ? <p className="mt-1 text-sm text-red-600">{errors.confirm_password}</p> : null}
          </div>

          <div>
            <label className="flex items-start gap-2 text-sm text-ink/70">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => {
                  setTermsAccepted(e.target.checked)
                  setErrors((prev) => ({ ...prev, terms: '' }))
                }}
                className="mt-0.5"
              />
              I agree to the terms of use and privacy policy.
            </label>
            {errors.terms ? <p className="mt-1 text-sm text-red-600">{errors.terms}</p> : null}
          </div>

          <div className="flex justify-between">
            <button
              type="button"
              onClick={goBack}
              className="rounded-md border border-line px-4 py-2 text-sm font-medium hover:bg-background"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create account'}
            </button>
          </div>
        </div>
      ) : null}

      {showSignInLink ? (
        <p className="mt-6 text-center text-sm text-ink/70">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-button underline">
            Sign in
          </Link>
        </p>
      ) : null}
    </div>
  )
}

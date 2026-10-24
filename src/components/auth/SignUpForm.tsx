import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../lib/api'
import { SIGNUP_ROLE_CODES, getRoleDefinition } from '../../lib/roles'
import { nameSchema, emailSchema, phoneSchema, signupSchema, getPasswordChecklist } from '../../lib/validation'
import { Alert, Badge, Button, Checkbox, FormField, Input, PasswordInput } from '../ui'

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
        <h2 className="text-lg font-semibold text-text">Account created</h2>
        <p className="mt-3 text-sm text-text-muted">The convenor must approve it before you can sign in.</p>
        {showSignInLink ? (
          <Link to="/login" className="mt-6 inline-block font-medium text-brand underline">
            Back to sign in
          </Link>
        ) : null}
      </div>
    )
  }

  return (
    <div>
      <p className="text-sm text-text-muted">
        Step {step === 3 && preselectedConference ? 2 : step} of {preselectedConference ? 2 : 3}
      </p>
      {preselectedConference ? (
        <p className="mt-1 text-sm text-text-muted">
          Signing up for <span className="font-medium text-text">{preselectedConference.name}</span>
        </p>
      ) : null}

      {formError ? (
        <div className="mt-3">
          <Alert variant="danger">{formError}</Alert>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="mt-4">
          <h2 className="font-medium text-text">Choose your role</h2>
          {errors.role ? (
            <p className="mt-1 text-sm text-danger" role="alert">
              {errors.role}
            </p>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {SIGNUP_ROLE_CODES.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setRole(code)}
                className={`rounded-lg border p-3 text-left text-sm ${
                  role === code ? 'border-button ring-2 ring-button/30' : 'border-border hover:border-button/50'
                }`}
              >
                {getRoleDefinition(code)?.label}
              </button>
            ))}
          </div>
          <Button type="button" onClick={goToStep2} className="mt-6 w-full">
            Continue
          </Button>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="mt-4">
          <h2 className="font-medium text-text">Choose a conference</h2>
          {errors.conference_id ? (
            <p className="mt-1 text-sm text-danger" role="alert">
              {errors.conference_id}
            </p>
          ) : null}
          <div className="mt-3 space-y-2">
            {conferences.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-page-bg px-4 py-6 text-center text-sm text-text-muted">
                <p>
                  There's nowhere to sign up yet — no conference on this platform has been published for
                  attendees to join. Check back once one has, or browse what's here so far.
                </p>
                <Link to="/" className="font-medium text-button underline underline-offset-2">
                  Browse conferences
                </Link>
              </div>
            ) : (
              conferences.map((conference) => (
                <label
                  key={conference.id}
                  className={`block cursor-pointer rounded-lg border px-3 py-2 text-sm ${
                    conferenceId === conference.id ? 'border-button bg-button/5' : 'border-border bg-surface'
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
            <Button type="button" variant="secondary" onClick={goBack}>
              Back
            </Button>
            <Button type="button" onClick={goToStep3}>
              Continue
            </Button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="mt-4 space-y-4">
          <FormField label="Full name" htmlFor="su-full_name" error={errors.full_name}>
            <Input
              id="su-full_name"
              value={form.full_name}
              onChange={(e) => update('full_name', e.target.value)}
              onBlur={() => blurField('full_name')}
              error={Boolean(errors.full_name)}
            />
          </FormField>

          <FormField label="Email" htmlFor="su-email" error={errors.email}>
            <Input
              id="su-email"
              type="email"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              onBlur={() => blurField('email')}
              error={Boolean(errors.email)}
            />
          </FormField>

          <FormField label="Phone number" htmlFor="su-phone" error={errors.phone}>
            <Input
              id="su-phone"
              value={form.phone}
              onChange={(e) => update('phone', e.target.value)}
              onBlur={() => blurField('phone')}
              placeholder="98XXXXXXXX"
              error={Boolean(errors.phone)}
            />
          </FormField>

          <FormField label="Password" htmlFor="su-password" error={errors.password}>
            <PasswordInput
              id="su-password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => update('password', e.target.value)}
              error={Boolean(errors.password)}
            />
            <ul className="mt-2 space-y-1">
              {getPasswordChecklist(form.password).map((rule) => (
                <li key={rule.id}>
                  <Badge tone={rule.passed ? 'success' : 'neutral'}>
                    {rule.passed ? '✓' : '○'} {rule.label}
                  </Badge>
                </li>
              ))}
            </ul>
          </FormField>

          <FormField label="Confirm password" htmlFor="su-confirm_password" error={errors.confirm_password}>
            <PasswordInput
              id="su-confirm_password"
              autoComplete="new-password"
              value={form.confirm_password}
              onChange={(e) => update('confirm_password', e.target.value)}
              onBlur={() => blurField('confirm_password')}
              error={Boolean(errors.confirm_password)}
            />
          </FormField>

          <div>
            <Checkbox
              label="I agree to the terms of use and privacy policy."
              checked={termsAccepted}
              onChange={(e) => {
                setTermsAccepted(e.target.checked)
                setErrors((prev) => ({ ...prev, terms: '' }))
              }}
            />
            {errors.terms ? (
              <p className="mt-1 text-sm text-danger" role="alert">
                {errors.terms}
              </p>
            ) : null}
          </div>

          <div className="flex justify-between">
            <Button type="button" variant="secondary" onClick={goBack}>
              Back
            </Button>
            <Button type="button" onClick={handleSubmit} loading={submitting}>
              {submitting ? 'Creating…' : 'Create account'}
            </Button>
          </div>
        </div>
      ) : null}

      {showSignInLink ? (
        <p className="mt-6 text-center text-sm text-text-muted">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand underline">
            Sign in
          </Link>
        </p>
      ) : null}
    </div>
  )
}

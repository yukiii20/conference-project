import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/authContext'
import { profileSchema, type ProfileInput } from '../lib/validation'
import { cropToSquareJpeg } from '../lib/imageCrop'
import { ImageUpload } from '../components/ImageUpload'
import { COUNTRIES } from '../lib/countries'
import { Alert, Button, Card, FormField, Input, PageHeader, Select, Spinner, Textarea, useToast } from '../components/ui'

const MAX_PHOTO_MB = 5

type FormState = {
  full_name: string
  phone: string
  institution: string
  department: string
  position: string
  country: string
  orcid: string
  bio: string
}

const EMPTY_FORM: FormState = {
  full_name: '',
  phone: '',
  institution: '',
  department: '',
  position: '',
  country: 'NP',
  orcid: '',
  bio: '',
}

/** Identity (and the data this form edits) comes only from GET/PATCH /api/me/profile — never a client-side auth SDK. */
export function ProfilePage() {
  const navigate = useNavigate()
  const { user, refresh } = useAuth()
  const { showToast } = useToast()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [photoPath, setPhotoPath] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const data = await refresh()
      if (cancelled) return
      if (!data) {
        navigate('/login')
        return
      }
      setForm({
        full_name: data.user.full_name ?? '',
        phone: data.user.phone ?? '',
        institution: data.user.institution ?? '',
        department: data.user.department ?? '',
        position: data.user.position ?? '',
        country: data.user.country ?? 'NP',
        orcid: data.user.orcid ?? '',
        bio: data.user.bio ?? '',
      })
      setPhotoPath(data.user.photo_path)
      setChecking(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [navigate, refresh])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const parsed = profileSchema.safeParse(form as ProfileInput)
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (typeof key === 'string' && !(key in nextErrors)) nextErrors[key] = issue.message
      }
      setErrors(nextErrors)
      return
    }
    setErrors({})
    setSaving(true)

    try {
      await api.patch('/me/profile', parsed.data)
      await refresh()
      showToast('Profile saved.', 'success')
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save your profile.')
    } finally {
      setSaving(false)
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page-bg text-text">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-page-bg px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <PageHeader title="My profile" subtitle="Your name, photo, and contact details." />
        <Card>
          <div className="border-b border-border pb-8">
            <p className="mb-2 text-sm font-medium text-text">Photo</p>
            <ImageUpload
              label="photo"
              currentPath={photoPath}
              maxSizeMB={MAX_PHOTO_MB}
              aspect="square"
              transformFile={(file) => cropToSquareJpeg(file)}
              uploadUrl="/api/me/photo"
              removeUrl="/api/me/photo"
              onSaved={(path) => {
                setPhotoPath(path)
                refresh()
              }}
              onRemoved={() => {
                setPhotoPath(null)
                refresh()
              }}
            />
            <p className="mt-2 text-xs text-text-muted">
              Use a clear photo of your face. It may appear on your conference badge and certificates.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {formError ? <Alert variant="danger">{formError}</Alert> : null}

            <FormField label="Email">
              <p className="mt-1 rounded-md border border-border bg-page-bg px-3 py-2 text-text-muted">{user?.email}</p>
            </FormField>
            <p className="-mt-3 text-xs text-text-muted">Your sign-in email cannot be changed here.</p>

            <FormField label="Full name" htmlFor="full_name" error={errors.full_name}>
              <Input id="full_name" value={form.full_name} onChange={(e) => update('full_name', e.target.value)} error={Boolean(errors.full_name)} />
            </FormField>

            <FormField label="Phone number" htmlFor="phone" error={errors.phone}>
              <Input
                id="phone"
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
                placeholder="98XXXXXXXX"
                error={Boolean(errors.phone)}
              />
            </FormField>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Institution" htmlFor="institution" error={errors.institution}>
                <Input
                  id="institution"
                  value={form.institution}
                  onChange={(e) => update('institution', e.target.value)}
                  error={Boolean(errors.institution)}
                />
              </FormField>
              <FormField label="Department" htmlFor="department" error={errors.department}>
                <Input
                  id="department"
                  value={form.department}
                  onChange={(e) => update('department', e.target.value)}
                  error={Boolean(errors.department)}
                />
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Position / designation" htmlFor="position" error={errors.position}>
                <Input
                  id="position"
                  value={form.position}
                  onChange={(e) => update('position', e.target.value)}
                  error={Boolean(errors.position)}
                />
              </FormField>
              <FormField label="Country" htmlFor="country" error={errors.country}>
                <Select id="country" value={form.country} onChange={(e) => update('country', e.target.value)} error={Boolean(errors.country)}>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>

            <FormField label="ORCID (optional)" htmlFor="orcid" error={errors.orcid}>
              <Input
                id="orcid"
                value={form.orcid}
                onChange={(e) => update('orcid', e.target.value)}
                placeholder="0000-0000-0000-0000"
                error={Boolean(errors.orcid)}
              />
            </FormField>

            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="bio" className="block text-sm font-medium text-text">
                  Short bio
                </label>
                <span className="text-xs text-text-muted">{form.bio.length} / 1000</span>
              </div>
              <Textarea
                id="bio"
                value={form.bio}
                onChange={(e) => update('bio', e.target.value)}
                rows={5}
                maxLength={1000}
                error={Boolean(errors.bio)}
              />
              {errors.bio ? (
                <p className="mt-1 text-sm text-danger" role="alert">
                  {errors.bio}
                </p>
              ) : null}
            </div>

            <Button type="submit" loading={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </form>

          <p className="mt-6 text-xs text-text-muted">
            Changing your profile does not update details you've already submitted on a paper (name, affiliation) — those
            keep the information used at the time you submitted, as the record of record.
          </p>

          <p className="mt-6 text-sm text-text-muted">
            <Link to="/" className="font-medium text-brand underline">
              Back
            </Link>
          </p>
        </Card>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { profileSchema, type ProfileInput } from '../lib/validation'
import { cropToSquareJpeg } from '../lib/imageCrop'
import { ImageUpload } from '../components/ImageUpload'
import { COUNTRIES } from '../lib/countries'

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

export function ProfilePage() {
  const navigate = useNavigate()
  const [userId, setUserId] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [photoPath, setPhotoPath] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) {
        navigate('/login')
        return
      }

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('full_name, email, phone, institution, department, position, country, orcid, bio, photo_path')
        .eq('id', userData.user.id)
        .single()

      if (cancelled) return

      setUserId(userData.user.id)
      setEmail(userData.user.email ?? '')

      if (error) {
        setFormError(error.message)
      } else if (profile) {
        setForm({
          full_name: profile.full_name ?? '',
          phone: profile.phone ?? '',
          institution: profile.institution ?? '',
          department: profile.department ?? '',
          position: profile.position ?? '',
          country: profile.country ?? 'NP',
          orcid: profile.orcid ?? '',
          bio: profile.bio ?? '',
        })
        setPhotoPath(profile.photo_path)
      }
      setChecking(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [navigate])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSaved(false)

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

    const { error } = await supabase.from('profiles').update(parsed.data).eq('id', userId as string)
    setSaving(false)

    if (error) {
      setFormError(error.message)
      return
    }
    setSaved(true)
  }

  if (checking) {
    return <div className="flex min-h-screen items-center justify-center bg-background text-ink">Loading…</div>
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10 text-ink">
      <div className="mx-auto max-w-2xl rounded-xl border border-line bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold">My profile</h1>

        <div className="mt-6 border-b border-line pb-8">
          <p className="mb-2 text-sm font-medium text-ink">Photo</p>
          <ImageUpload
            label="photo"
            currentPath={photoPath}
            maxSizeMB={MAX_PHOTO_MB}
            aspect="square"
            transformFile={(file) => cropToSquareJpeg(file)}
            buildPath={() => `avatars/${userId}/${crypto.randomUUID()}.jpg`}
            onSaved={async (path) => {
              const { error } = await supabase.from('profiles').update({ photo_path: path }).eq('id', userId as string)
              if (error) return error.message
              setPhotoPath(path)
              return null
            }}
            onRemoved={async () => {
              const { error } = await supabase.from('profiles').update({ photo_path: null }).eq('id', userId as string)
              if (error) return error.message
              setPhotoPath(null)
              return null
            }}
          />
          <p className="mt-2 text-xs text-ink/50">
            Use a clear photo of your face. It may appear on your conference badge and certificates.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {formError ? (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {formError}
            </div>
          ) : null}
          {saved ? (
            <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">Profile saved.</div>
          ) : null}

          <div>
            <label className="block text-sm font-medium text-ink">Email</label>
            <p className="mt-1 rounded-md border border-line bg-background px-3 py-2 text-ink/70">{email}</p>
            <p className="mt-1 text-xs text-ink/50">Your sign-in email cannot be changed here.</p>
          </div>

          <div>
            <label htmlFor="full_name" className="block text-sm font-medium text-ink">
              Full name
            </label>
            <input
              id="full_name"
              value={form.full_name}
              onChange={(e) => update('full_name', e.target.value)}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
            />
            {errors.full_name ? <p className="mt-1 text-sm text-red-600">{errors.full_name}</p> : null}
          </div>

          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-ink">
              Phone number
            </label>
            <input
              id="phone"
              value={form.phone}
              onChange={(e) => update('phone', e.target.value)}
              placeholder="98XXXXXXXX"
              className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
            />
            {errors.phone ? <p className="mt-1 text-sm text-red-600">{errors.phone}</p> : null}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="institution" className="block text-sm font-medium text-ink">
                Institution
              </label>
              <input
                id="institution"
                value={form.institution}
                onChange={(e) => update('institution', e.target.value)}
                className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
              />
              {errors.institution ? <p className="mt-1 text-sm text-red-600">{errors.institution}</p> : null}
            </div>
            <div>
              <label htmlFor="department" className="block text-sm font-medium text-ink">
                Department
              </label>
              <input
                id="department"
                value={form.department}
                onChange={(e) => update('department', e.target.value)}
                className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
              />
              {errors.department ? <p className="mt-1 text-sm text-red-600">{errors.department}</p> : null}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="position" className="block text-sm font-medium text-ink">
                Position / designation
              </label>
              <input
                id="position"
                value={form.position}
                onChange={(e) => update('position', e.target.value)}
                className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
              />
              {errors.position ? <p className="mt-1 text-sm text-red-600">{errors.position}</p> : null}
            </div>
            <div>
              <label htmlFor="country" className="block text-sm font-medium text-ink">
                Country
              </label>
              <select
                id="country"
                value={form.country}
                onChange={(e) => update('country', e.target.value)}
                className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 focus:border-button"
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
              {errors.country ? <p className="mt-1 text-sm text-red-600">{errors.country}</p> : null}
            </div>
          </div>

          <div>
            <label htmlFor="orcid" className="block text-sm font-medium text-ink">
              ORCID (optional)
            </label>
            <input
              id="orcid"
              value={form.orcid}
              onChange={(e) => update('orcid', e.target.value)}
              placeholder="0000-0000-0000-0000"
              className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
            />
            {errors.orcid ? <p className="mt-1 text-sm text-red-600">{errors.orcid}</p> : null}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="bio" className="block text-sm font-medium text-ink">
                Short bio
              </label>
              <span className="text-xs text-ink/50">{form.bio.length} / 1000</span>
            </div>
            <textarea
              id="bio"
              value={form.bio}
              onChange={(e) => update('bio', e.target.value)}
              rows={5}
              maxLength={1000}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
            />
            {errors.bio ? <p className="mt-1 text-sm text-red-600">{errors.bio}</p> : null}
          </div>

          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </form>

        <p className="mt-6 text-xs text-ink/50">
          Changing your profile does not update details you've already submitted on a paper (name, affiliation) — those
          keep the information used at the time you submitted, as the record of record.
        </p>

        <p className="mt-6 text-sm text-ink/70">
          <Link to="/" className="font-medium text-button underline">
            Back
          </Link>
        </p>
      </div>
    </div>
  )
}

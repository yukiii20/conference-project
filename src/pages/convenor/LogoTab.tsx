import { useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { ImageUpload } from '../../components/ImageUpload'

const MAX_MB = 2

export function LogoTab({ conferenceId }: { conferenceId: string }) {
  const [logoPath, setLogoPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const data = await api.get<{ conference: { logo_path: string | null } }>(`/conferences/${conferenceId}/details`)
        if (cancelled) return
        setLogoPath(data.conference.logo_path)
        setLoadError(null)
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof ApiError ? err.message : 'Could not load the logo.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [conferenceId])

  if (loading) {
    return <p className="mt-6 text-sm text-ink/60">Loading…</p>
  }

  if (loadError) {
    return <p className="mt-6 text-sm text-red-600">{loadError}</p>
  }

  return (
    <div className="mt-6 max-w-md">
      <ImageUpload
        label="logo"
        currentPath={logoPath}
        maxSizeMB={MAX_MB}
        aspect="square"
        uploadUrl={`/api/conferences/${conferenceId}/logo`}
        removeUrl={`/api/conferences/${conferenceId}/logo`}
        onSaved={setLogoPath}
        onRemoved={() => setLogoPath(null)}
      />
    </div>
  )
}

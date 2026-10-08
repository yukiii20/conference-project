import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { imageExtension } from '../../lib/storage'
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
      const { data, error } = await supabase.from('conferences').select('logo_path').eq('id', conferenceId).single()
      if (cancelled) return
      if (error) {
        setLoadError(error.message)
      } else {
        setLogoPath(data?.logo_path ?? null)
      }
      setLoading(false)
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
        buildPath={(file) => `conferences/${conferenceId}/logo-${crypto.randomUUID()}.${imageExtension(file.type)}`}
        onSaved={async (path) => {
          const { error } = await supabase.from('conferences').update({ logo_path: path }).eq('id', conferenceId)
          if (error) return error.message
          setLogoPath(path)
          return null
        }}
        onRemoved={async () => {
          const { error } = await supabase.from('conferences').update({ logo_path: null }).eq('id', conferenceId)
          if (error) return error.message
          setLogoPath(null)
          return null
        }}
      />
    </div>
  )
}

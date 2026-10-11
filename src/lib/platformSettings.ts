import { useEffect, useState } from 'react'
import { api } from './api'

export type PlatformSettings = {
  platform_name: string
  support_email: string | null
  footer_text: string | null
  hero_headline: string | null
  hero_subheadline: string | null
  faq_items: Array<{ q: string; a: string }>
}

/** Admin-editable platform copy (Platform settings page). Returns null until loaded — callers should fall back to the site.ts defaults until then. */
export function usePlatformSettings(): PlatformSettings | null {
  const [settings, setSettings] = useState<PlatformSettings | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<{ settings: PlatformSettings }>('/platform-settings')
      .then((res) => {
        if (!cancelled) setSettings(res.settings)
      })
      .catch(() => {
        // Keep the site.ts defaults on failure — this is non-critical copy, not worth an error banner.
      })
    return () => {
      cancelled = true
    }
  }, [])

  return settings
}

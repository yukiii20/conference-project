import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { api, ApiError } from '../../../lib/api'
import { Alert, Input } from '../../../components/ui'
import { HEX } from './shared'

export function EditorSection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-lg border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-text">
        {title}
        <ChevronDown size={16} className="text-text-muted transition group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-3 border-t border-border px-4 py-4">{children}</div>
    </details>
  )
}

export function ColorField({ label, value, fallback, onChange }: { label: string; value: string; fallback: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-xs font-medium text-text-muted">
      {label}
      <div className="mt-1 flex items-center gap-2">
        <input
          type="color"
          value={HEX.test(value) ? value : fallback || '#2747A0'}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-11 shrink-0 cursor-pointer rounded-md border border-border bg-surface"
          aria-label={`${label} colour picker`}
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={fallback || 'Conference colour'} className="font-mono uppercase" />
      </div>
    </label>
  )
}

/** Live PDF preview of the editor's current (unsaved) settings, refreshed 500 ms after the last change. */
export function LivePreview({ conferenceId, body }: { conferenceId: string; body: unknown }) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = JSON.stringify(body)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const blob = await api.postBlob(`/conferences/${conferenceId}/certificate-templates/preview.pdf`, JSON.parse(key))
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
        setError(null)
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not draw the preview.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(timer)
      const stale = objectUrl
      if (stale) setTimeout(() => URL.revokeObjectURL(stale), 2000)
    }
  }, [conferenceId, key])

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-text-muted">
        <span className="font-medium">Live preview (sample name)</span>
        {loading ? <span>Updating…</span> : null}
      </div>
      {error ? <Alert variant="danger">{error}</Alert> : null}
      <div className="relative w-full overflow-hidden rounded-md border border-border-soft bg-surface-muted" style={{ aspectRatio: '297 / 210' }}>
        {url ? (
          <iframe title="Certificate preview" src={`${url}#toolbar=0&navpanes=0&view=Fit`} className="absolute inset-0 h-full w-full" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-text-muted">Drawing preview…</div>
        )}
      </div>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs text-button hover:underline">
          Open full size
        </a>
      ) : null}
    </div>
  )
}

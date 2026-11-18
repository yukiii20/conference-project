import { useCallback, useEffect, useState } from 'react'
import { Download, FileText, Presentation } from 'lucide-react'
import { API_BASE, api, ApiError } from '../../../lib/api'
import { formatBytes } from '../../../lib/audienceFiles'
import { AcceptedAbstractsList } from '../../../components/audience/AcceptedAbstractsList'
import { EmptyState, ErrorState, PageHeader, SkeletonText, buttonClasses } from '../../../components/ui'

type Material = {
  kind: 'material' | 'slides' | 'paper'
  id: string
  title: string
  description: string | null
  authors: string[]
  filename: string
  size_bytes: number
}

const KIND_LABEL: Record<Material['kind'], string> = { material: 'Conference file', slides: 'Slides', paper: 'Final paper' }

/** Audience "Materials": conference files, plus slides / final papers their authors chose to share. */
export function MaterialsTab({ conferenceId }: { conferenceId: string | null }) {
  const [materials, setMaterials] = useState<Material[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!conferenceId) return
    try {
      setMaterials((await api.get<{ materials: Material[] }>(`/conferences/${conferenceId}/audience/materials`)).materials)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Can't reach the server.")
    }
  }, [conferenceId])

  useEffect(() => {
    setMaterials(null)
    load()
  }, [load])

  const conferenceFiles = (materials ?? []).filter((m) => m.kind === 'material')
  const paperFiles = (materials ?? []).filter((m) => m.kind !== 'material')

  return (
    <div className="mt-6 max-w-3xl">
      <PageHeader title="Materials" subtitle="Downloads for registered Audience members." />
      {!conferenceId ? (
        <p className="mt-4 text-sm text-text-muted">Choose a conference above.</p>
      ) : error ? (
        <div className="mt-4">
          <ErrorState message={error} onRetry={load} />
        </div>
      ) : !materials ? (
        <div className="mt-4">
          <SkeletonText lines={4} />
        </div>
      ) : materials.length === 0 ? (
        <EmptyState title="Nothing to download yet" message="Conference files and shared slides appear here." />
      ) : (
        <div className="mt-4 space-y-6">
          {[
            { title: 'From the organisers', items: conferenceFiles },
            { title: 'Slides and papers', items: paperFiles },
          ]
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <section key={g.title}>
                <h2 className="font-display text-base font-semibold text-text">{g.title}</h2>
                <ul className="mt-2 space-y-2">
                  {g.items.map((m) => (
                    <li key={`${m.kind}-${m.id}`} className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3">
                      <span className="mt-0.5 text-text-muted" aria-hidden="true">
                        {m.kind === 'slides' ? <Presentation size={20} /> : <FileText size={20} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-text">{m.title}</p>
                        <p className="text-xs text-text-muted">
                          {KIND_LABEL[m.kind]}
                          {m.authors.length ? ` · ${m.authors.join(', ')}` : ''} · {formatBytes(m.size_bytes)}
                        </p>
                        {m.description ? <p className="mt-1 text-sm text-text">{m.description}</p> : null}
                      </div>
                      <a
                        href={`${API_BASE}/conferences/${conferenceId}/audience/materials/${m.kind}/${m.id}/download`}
                        className={buttonClasses('secondary', 'sm')}
                        aria-label={`Download ${m.title}`}
                      >
                        <Download aria-hidden className="h-4 w-4" />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </div>
  )
}

/** Audience "Accepted papers". */
export function AcceptedPapersTab({ conferenceId }: { conferenceId: string | null }) {
  return (
    <div className="mt-6 max-w-3xl">
      <PageHeader title="Accepted papers" subtitle="Abstracts of the papers accepted for this conference." />
      <div className="mt-4">
        {conferenceId ? (
          <AcceptedAbstractsList endpoint={`/conferences/${conferenceId}/audience/abstracts`} />
        ) : (
          <p className="text-sm text-text-muted">Choose a conference above.</p>
        )}
      </div>
    </div>
  )
}

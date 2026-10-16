import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { SubmissionsList } from '../../author/SubmissionsList'
import { SubmissionDetail } from '../../author/SubmissionDetail'

type Tab = 'new' | 'submissions'
type Track = { id: string; name: string }

export function AuthorSection({ conferenceId }: { conferenceId: string }) {
  const [tracks, setTracks] = useState<Track[]>([])
  const [maxAbstractWords, setMaxAbstractWords] = useState(300)
  const [tab, setTab] = useState<Tab>('submissions')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function reload() {
      try {
        const data = await api.get<{ tracks: Track[]; settings: { max_abstract_words: number } }>(
          `/conferences/${conferenceId}/author-form`,
        )
        if (cancelled) return
        setTracks(data.tracks)
        setMaxAbstractWords(data.settings.max_abstract_words)
      } catch {
        if (cancelled) return
        setTracks([])
        setMaxAbstractWords(300)
      }
      setSelectedId(null)
      setTab('submissions')
    }
    reload()
    return () => {
      cancelled = true
    }
  }, [conferenceId])

  function handleSelect(id: string) {
    setSelectedId(id)
    setTab('submissions')
  }

  function handleSaved(id: string) {
    setTab('submissions')
    setSelectedId(id)
    setRefreshKey((k) => k + 1)
  }

  return (
    <div className="mt-6 max-w-3xl">
      <h2 className="text-lg font-medium text-ink">My submissions</h2>

      <div className="mt-4 flex gap-2 border-b border-line">
        <button
          type="button"
          onClick={() => {
            setTab('new')
            setSelectedId(null)
          }}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
            tab === 'new' ? 'border-button text-button' : 'border-transparent text-ink/60'
          }`}
        >
          New abstract
        </button>
        <button
          type="button"
          onClick={() => {
            setTab('submissions')
            setSelectedId(null)
          }}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
            tab === 'submissions' ? 'border-button text-button' : 'border-transparent text-ink/60'
          }`}
        >
          My submissions
        </button>
      </div>

      {tab === 'new' ? (
        <SubmissionDetail
          key={conferenceId}
          conferenceId={conferenceId}
          submissionId={null}
          tracks={tracks}
          maxAbstractWords={maxAbstractWords}
          onSaved={handleSaved}
        />
      ) : selectedId ? (
        <>
          <button type="button" onClick={() => setSelectedId(null)} className="mt-4 text-sm text-button underline">
            ← Back to my submissions
          </button>
          <SubmissionDetail
            conferenceId={conferenceId}
            submissionId={selectedId}
            tracks={tracks}
            maxAbstractWords={maxAbstractWords}
            onSaved={handleSaved}
          />
        </>
      ) : (
        <SubmissionsList conferenceId={conferenceId} onSelect={handleSelect} refreshKey={refreshKey} />
      )}
    </div>
  )
}

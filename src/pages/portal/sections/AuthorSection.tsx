import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { SubmissionsList } from '../../author/SubmissionsList'
import { SubmissionDetail } from '../../author/SubmissionDetail'
import { Button, PageHeader, Tabs } from '../../../components/ui'

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
      <PageHeader title="My submissions" subtitle="Your papers for this conference — drafts, submitted, and their review status." />

      <Tabs
        tabs={[
          { id: 'new', label: 'New abstract' },
          { id: 'submissions', label: 'My submissions' },
        ]}
        active={tab}
        onChange={(id) => {
          setTab(id as Tab)
          setSelectedId(null)
        }}
      />

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
          <Button type="button" variant="link" onClick={() => setSelectedId(null)} className="mt-4">
            ← Back to my submissions
          </Button>
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

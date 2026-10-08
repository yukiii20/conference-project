import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getRoleDefinition } from '../lib/roles'
import type { MyRoleRequestRow } from '../lib/types'
import { PortalHeader } from '../components/PortalHeader'
import { SubmissionsList } from './author/SubmissionsList'
import { SubmissionDetail } from './author/SubmissionDetail'

type Tab = 'new' | 'submissions'
type Track = { id: string; name: string }
type AuthorConference = { id: string; name: string; slug: string }

export function AuthorPage() {
  const [searchParams] = useSearchParams()
  const preselectedSlug = searchParams.get('conference')?.trim() || null

  const [myConferences, setMyConferences] = useState<AuthorConference[]>([])
  const [conferenceId, setConferenceId] = useState<string | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [maxAbstractWords, setMaxAbstractWords] = useState(300)
  const [loading, setLoading] = useState(true)

  const [tab, setTab] = useState<Tab>('submissions')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function init() {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) return

      const { data: requestsData } = await supabase.rpc('get_my_role_requests')

      if (cancelled) return

      const requests = (requestsData ?? []) as MyRoleRequestRow[]
      const confIds = requests.filter((r) => r.role_code === 'author' && r.status === 'approved').map((r) => r.conference_id)

      if (confIds.length === 0) {
        setLoading(false)
        return
      }

      const { data: confData } = await supabase.from('conferences').select('id, name, slug').in('id', confIds)
      if (cancelled) return

      const options = (confData ?? []) as AuthorConference[]
      setMyConferences(options)

      const preselected = preselectedSlug ? options.find((c) => c.slug === preselectedSlug) : null
      const initial = preselected ?? options[0]
      if (!initial) {
        setLoading(false)
        return
      }
      setConferenceId(initial.id)
      setLoading(false)
    }

    init()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!conferenceId) return
    let cancelled = false
    async function reload() {
      const [{ data: tracksData }, { data: settings }] = await Promise.all([
        supabase.from('conference_tracks').select('id, name').eq('conference_id', conferenceId as string).eq('is_active', true).order('display_order'),
        supabase.from('conference_settings').select('max_abstract_words').eq('conference_id', conferenceId as string).maybeSingle(),
      ])
      if (cancelled) return
      setTracks((tracksData ?? []) as Track[])
      setMaxAbstractWords(settings?.max_abstract_words ?? 300)
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
    <div className="min-h-screen bg-background text-ink">
      <PortalHeader roleLabel={getRoleDefinition('author')?.label ?? 'Author'} />

      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold">Author</h1>

        {myConferences.length > 1 ? (
          <div className="mt-3">
            <label htmlFor="author-conference" className="block text-xs font-medium text-ink/60">
              Conference
            </label>
            <select
              id="author-conference"
              value={conferenceId ?? ''}
              onChange={(e) => setConferenceId(e.target.value)}
              className="mt-1 w-full max-w-sm rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-button"
            >
              {myConferences.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {loading ? (
          <p className="mt-6 text-sm text-ink/60">Loading…</p>
        ) : !conferenceId ? (
          <p className="mt-6 rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">
            You are not set up as an author for any conference yet.
          </p>
        ) : (
          <>
            <div className="mt-6 flex gap-2 border-b border-line">
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
          </>
        )}
      </main>
    </div>
  )
}

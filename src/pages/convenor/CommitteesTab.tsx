import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { COMMITTEE_MEMBER_ROLES, COMMITTEE_TYPES, committeeSchema, type CommitteeInput } from '../../lib/validation'
import { Button, Input, Select } from '../../components/ui'

type CommitteeMember = {
  id: string
  user_id: string | null
  display_name: string | null
  affiliation: string | null
  country: string | null
  member_role: string
  full_name: string | null
  email: string | null
}

type Committee = {
  id: string
  name: string
  committee_type: string
  description: string | null
  is_public: boolean
  members: CommitteeMember[]
}

const EMPTY_COMMITTEE: CommitteeInput = { name: '', committee_type: 'other', description: '', is_public: true }

function MemberAddForm({ conferenceId, committeeId, onAdded }: { conferenceId: string; committeeId: string; onAdded: () => void }) {
  const [emailLookup, setEmailLookup] = useState('')
  const [foundUser, setFoundUser] = useState<{ id: string; full_name: string; email: string } | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [affiliation, setAffiliation] = useState('')
  const [country, setCountry] = useState('')
  const [memberRole, setMemberRole] = useState<(typeof COMMITTEE_MEMBER_ROLES)[number]>('member')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleLookup() {
    setFoundUser(null)
    setError(null)
    if (!emailLookup.trim()) return
    try {
      const res = await api.get<{ user: { id: string; full_name: string; email: string } | null }>(
        `/conferences/${conferenceId}/committees/user-lookup`,
        { email: emailLookup.trim() },
      )
      if (res.user) setFoundUser(res.user)
      else setError('No account with that email.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not look up that email.')
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!foundUser && !displayName.trim()) {
      setError('Pick an existing user or type a name.')
      return
    }
    setBusy(true)
    try {
      await api.post(`/conferences/${conferenceId}/committees/${committeeId}/members`, {
        user_id: foundUser?.id,
        display_name: foundUser ? undefined : displayName.trim(),
        affiliation: affiliation.trim() || undefined,
        country: country.trim() || undefined,
        member_role: memberRole,
      })
      setEmailLookup('')
      setFoundUser(null)
      setDisplayName('')
      setAffiliation('')
      setCountry('')
      setMemberRole('member')
      onAdded()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add this member.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleAdd} className="mt-3 rounded-md border border-dashed border-line bg-background/40 p-3">
      {error ? <p className="mb-2 text-xs text-red-600">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={emailLookup}
          onChange={(e) => setEmailLookup(e.target.value)}
          placeholder="Find by email…"
          className="w-auto"
        />
        <Button type="button" variant="secondary" size="sm" onClick={handleLookup}>
          Look up
        </Button>
        {foundUser ? (
          <span className="flex min-h-10 items-center gap-1 rounded-full bg-green-100 px-3 text-sm text-green-800">
            {foundUser.full_name}
            <button type="button" onClick={() => setFoundUser(null)} className="underline">
              clear
            </button>
          </span>
        ) : null}
      </div>
      {!foundUser ? (
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Or type a name"
          className="mt-2 w-full"
        />
      ) : null}
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Input value={affiliation} onChange={(e) => setAffiliation(e.target.value)} placeholder="Affiliation" />
        <Input
          value={country}
          onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
          placeholder="Country (e.g. NP)"
        />
        <Select value={memberRole} onChange={(e) => setMemberRole(e.target.value as (typeof COMMITTEE_MEMBER_ROLES)[number])}>
          {COMMITTEE_MEMBER_ROLES.map((r) => (
            <option key={r} value={r}>
              {r.replace('_', '-')}
            </option>
          ))}
        </Select>
        <Button type="submit" size="sm" loading={busy}>
          Add member
        </Button>
      </div>
    </form>
  )
}

export function CommitteesTab({ conferenceId }: { conferenceId: string }) {
  const [committees, setCommittees] = useState<Committee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newCommittee, setNewCommittee] = useState<CommitteeInput>(EMPTY_COMMITTEE)
  const [newError, setNewError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ committees: Committee[] }>(`/conferences/${conferenceId}/committees`)
      setCommittees(data.committees)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load committees.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setNewError(null)
    const parsed = committeeSchema.safeParse(newCommittee)
    if (!parsed.success) {
      setNewError(parsed.error.issues[0]?.message ?? 'Invalid value.')
      return
    }
    setCreating(true)
    try {
      await api.post(`/conferences/${conferenceId}/committees`, parsed.data)
      setNewCommittee(EMPTY_COMMITTEE)
      await load()
    } catch (err) {
      setNewError(err instanceof ApiError ? err.message : 'Could not create this committee.')
    } finally {
      setCreating(false)
    }
  }

  async function handleTogglePublic(c: Committee) {
    try {
      await api.patch(`/conferences/${conferenceId}/committees/${c.id}`, { is_public: !c.is_public })
      await load()
    } catch {
      // Row stays as-is; the convenor can retry.
    }
  }

  async function handleDelete(c: Committee) {
    try {
      await api.del(`/conferences/${conferenceId}/committees/${c.id}`)
      await load()
    } catch {
      // Row stays as-is; the convenor can retry.
    }
  }

  async function handleRemoveMember(committeeId: string, memberId: string) {
    try {
      await api.del(`/conferences/${conferenceId}/committees/${committeeId}/members/${memberId}`)
      await load()
    } catch {
      // Row stays as-is; the convenor can retry.
    }
  }

  async function handleMoveCommittee(index: number, direction: 'up' | 'down') {
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= committees.length) return
    const reordered = [...committees]
    const tmp = reordered[index]!
    reordered[index] = reordered[swapIndex]!
    reordered[swapIndex] = tmp
    try {
      await api.post(`/conferences/${conferenceId}/committees/reorder`, { committee_ids: reordered.map((c) => c.id) })
      await load()
    } catch {
      // List stays as-is; the convenor can retry.
    }
  }

  async function handleMoveMember(committee: Committee, index: number, direction: 'up' | 'down') {
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= committee.members.length) return
    const reordered = [...committee.members]
    const tmp = reordered[index]!
    reordered[index] = reordered[swapIndex]!
    reordered[swapIndex] = tmp
    try {
      await api.post(`/conferences/${conferenceId}/committees/${committee.id}/members/reorder`, {
        member_ids: reordered.map((m) => m.id),
      })
      await load()
    } catch {
      // List stays as-is; the convenor can retry.
    }
  }

  if (loading) return <p className="mt-6 text-sm text-ink/60">Loading…</p>

  return (
    <div className="mt-6 max-w-3xl space-y-6">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {committees.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">No committees yet.</p>
      ) : (
        committees.map((c, ci) => (
          <div key={c.id} className="rounded-lg border border-line bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-ink">{c.name}</p>
                <p className="text-xs text-ink/50">{c.committee_type.replace('_', ' ')}</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => handleMoveCommittee(ci, 'up')} disabled={ci === 0} className="rounded-md border border-line px-2 py-1 text-xs hover:bg-background disabled:opacity-40">
                  ↑
                </button>
                <button type="button" onClick={() => handleMoveCommittee(ci, 'down')} disabled={ci === committees.length - 1} className="rounded-md border border-line px-2 py-1 text-xs hover:bg-background disabled:opacity-40">
                  ↓
                </button>
                <button type="button" onClick={() => handleTogglePublic(c)} className="rounded-md border border-line px-2 py-1 text-xs hover:bg-background">
                  {c.is_public ? 'Public' : 'Hidden'}
                </button>
                <button type="button" onClick={() => handleDelete(c)} className="text-xs font-medium text-red-600 hover:underline">
                  Delete
                </button>
              </div>
            </div>
            {c.description ? <p className="mt-2 text-sm text-ink/70">{c.description}</p> : null}

            {c.members.length > 0 ? (
              <ul className="mt-3 space-y-1">
                {c.members.map((m, mi) => (
                  <li key={m.id} className="flex items-center justify-between rounded-md bg-background px-2 py-1.5 text-sm">
                    <span>
                      {m.full_name ?? m.display_name} <span className="text-xs text-ink/50">({m.member_role.replace('_', '-')})</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <button type="button" onClick={() => handleMoveMember(c, mi, 'up')} disabled={mi === 0} className="text-xs text-ink/50 hover:text-ink disabled:opacity-30">
                        ↑
                      </button>
                      <button type="button" onClick={() => handleMoveMember(c, mi, 'down')} disabled={mi === c.members.length - 1} className="text-xs text-ink/50 hover:text-ink disabled:opacity-30">
                        ↓
                      </button>
                      <button type="button" onClick={() => handleRemoveMember(c.id, m.id)} className="text-xs text-red-600 hover:underline">
                        Remove
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            <MemberAddForm conferenceId={conferenceId} committeeId={c.id} onAdded={load} />
          </div>
        ))
      )}

      <form onSubmit={handleCreate} className="rounded-lg border border-dashed border-line bg-white p-4">
        <p className="font-medium text-ink">Add a committee</p>
        {newError ? <p className="mt-2 text-sm text-red-600">{newError}</p> : null}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            value={newCommittee.name}
            onChange={(e) => setNewCommittee((p) => ({ ...p, name: e.target.value }))}
            placeholder="Committee name"
            className="rounded-md border border-line px-3 py-2 focus:border-button"
          />
          <select
            value={newCommittee.committee_type}
            onChange={(e) => setNewCommittee((p) => ({ ...p, committee_type: e.target.value as CommitteeInput['committee_type'] }))}
            className="rounded-md border border-line px-3 py-2 focus:border-button"
          >
            {COMMITTEE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>
        <textarea
          value={newCommittee.description ?? ''}
          onChange={(e) => setNewCommittee((p) => ({ ...p, description: e.target.value }))}
          placeholder="Description (optional)"
          rows={2}
          className="mt-3 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        <label className="mt-3 flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={newCommittee.is_public}
            onChange={(e) => setNewCommittee((p) => ({ ...p, is_public: e.target.checked }))}
          />
          Show on the public conference page
        </label>
        <button type="submit" disabled={creating} className="mt-3 rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
          {creating ? 'Adding…' : 'Add committee'}
        </button>
      </form>
    </div>
  )
}

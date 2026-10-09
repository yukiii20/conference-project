import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { ASSIGNABLE_MEMBER_ROLES, inviteMemberSchema, type InviteMemberInput } from '../../lib/validation'

type Member = {
  id: string
  user_id: string
  full_name: string
  email: string
  role_code: string
  status: 'active' | 'removed'
  max_review_load: number | null
  created_at: string
}

type Track = { id: string; name: string }

const ROLE_LABELS: Record<string, string> = {
  convenor: 'Convenor',
  manager: 'Manager',
  staff: 'Staff',
  reviewer: 'Reviewer',
  session_chair: 'Session chair',
  author: 'Author',
}

const EMPTY_INVITE: InviteMemberInput = { full_name: '', email: '', phone: '', role_code: 'reviewer' }

export function MembersTab({ conferenceId }: { conferenceId: string }) {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})

  const [invite, setInvite] = useState<InviteMemberInput>(EMPTY_INVITE)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)

  const [tracksUserId, setTracksUserId] = useState<string | null>(null)
  const [allTracks, setAllTracks] = useState<Track[]>([])
  const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set())
  const [tracksSaving, setTracksSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ members: Member[] }>(`/conferences/${conferenceId}/members`, {
        q: q || undefined,
        role: roleFilter || undefined,
      })
      setMembers(data.members)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load members.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId, q, roleFilter])

  useEffect(() => {
    load()
  }, [load])

  async function handleRoleChange(member: Member, newRole: string) {
    setBusyId(member.id)
    setRowErrors((prev) => ({ ...prev, [member.id]: '' }))
    try {
      await api.patch(`/conferences/${conferenceId}/members/${member.id}/role`, { role_code: newRole })
      await load()
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [member.id]: err instanceof ApiError ? err.message : 'Could not change this role.' }))
    } finally {
      setBusyId(null)
    }
  }

  async function handleRemove(member: Member) {
    setBusyId(member.id)
    setRowErrors((prev) => ({ ...prev, [member.id]: '' }))
    try {
      await api.del(`/conferences/${conferenceId}/members/${member.id}`)
      await load()
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [member.id]: err instanceof ApiError ? err.message : 'Could not remove this member.' }))
    } finally {
      setBusyId(null)
    }
  }

  async function handleMaxReviewLoad(member: Member, value: string) {
    const parsed = value.trim() === '' ? null : Number(value)
    setBusyId(member.id)
    try {
      await api.patch(`/conferences/${conferenceId}/members/${member.id}/max-review-load`, { max_review_load: parsed })
      await load()
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [member.id]: err instanceof ApiError ? err.message : 'Could not save this.' }))
    } finally {
      setBusyId(null)
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviteError(null)
    setInviteSuccess(null)
    const parsed = inviteMemberSchema.safeParse(invite)
    if (!parsed.success) {
      setInviteError(parsed.error.issues[0]?.message ?? 'Please check the form.')
      return
    }
    setInviting(true)
    try {
      const res = await api.post<{ invited: boolean }>(`/conferences/${conferenceId}/members/invite`, parsed.data)
      setInviteSuccess(res.invited ? 'Invitation email sent.' : 'Added — they already had an account.')
      setInvite(EMPTY_INVITE)
      await load()
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : 'Could not send this invitation.')
    } finally {
      setInviting(false)
    }
  }

  async function openTracks(member: Member) {
    setTracksUserId(member.user_id)
    try {
      const [tracksData, currentData] = await Promise.all([
        api.get<{ tracks: Track[] }>(`/conferences/${conferenceId}/tracks`),
        api.get<{ track_ids: string[] }>(`/conferences/${conferenceId}/members/${member.user_id}/reviewer-tracks`),
      ])
      setAllTracks(tracksData.tracks)
      setSelectedTracks(new Set(currentData.track_ids))
    } catch {
      setAllTracks([])
      setSelectedTracks(new Set())
    }
  }

  async function saveTracks() {
    if (!tracksUserId) return
    setTracksSaving(true)
    try {
      await api.put(`/conferences/${conferenceId}/members/${tracksUserId}/reviewer-tracks`, {
        track_ids: Array.from(selectedTracks),
      })
      setTracksUserId(null)
    } catch {
      // Leave the picker open on failure so the convenor can retry.
    } finally {
      setTracksSaving(false)
    }
  }

  return (
    <div className="mt-6 max-w-3xl space-y-8">
      <div>
        <div className="flex flex-wrap gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or email"
            className="rounded-md border border-line px-3 py-2 text-sm focus:border-button"
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="rounded-md border border-line px-3 py-2 text-sm focus:border-button"
          >
            <option value="">All roles</option>
            {Object.entries(ROLE_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

        {loading ? (
          <p className="mt-4 text-sm text-ink/60">Loading…</p>
        ) : members.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">No members found.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-white">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-ink/60">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Joined</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {members.map((m) => (
                  <tr key={m.id} className={m.status === 'removed' ? 'opacity-50' : ''}>
                    <td className="px-3 py-2">{m.full_name}</td>
                    <td className="px-3 py-2">{m.email}</td>
                    <td className="px-3 py-2">
                      {m.role_code === 'convenor' ? (
                        <span>{ROLE_LABELS.convenor}</span>
                      ) : (
                        <select
                          value={m.role_code}
                          disabled={busyId === m.id || m.status === 'removed'}
                          onChange={(e) => handleRoleChange(m, e.target.value)}
                          className="rounded-md border border-line px-2 py-1 text-xs focus:border-button"
                        >
                          {ASSIGNABLE_MEMBER_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      )}
                      {m.role_code === 'reviewer' ? (
                        <div className="mt-1 flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            placeholder="Max reviews"
                            defaultValue={m.max_review_load ?? ''}
                            onBlur={(e) => handleMaxReviewLoad(m, e.target.value)}
                            className="w-24 rounded-md border border-line px-2 py-1 text-xs focus:border-button"
                          />
                          <button type="button" onClick={() => openTracks(m)} className="text-xs font-medium text-button underline">
                            Tracks
                          </button>
                        </div>
                      ) : null}
                      {rowErrors[m.id] ? <p className="mt-1 text-xs text-red-600">{rowErrors[m.id]}</p> : null}
                    </td>
                    <td className="px-3 py-2">{m.status}</td>
                    <td className="px-3 py-2 text-ink/60">{new Date(m.created_at).toLocaleDateString()}</td>
                    <td className="px-3 py-2 text-right">
                      {m.role_code !== 'convenor' && m.status === 'active' ? (
                        <button
                          type="button"
                          onClick={() => handleRemove(m)}
                          disabled={busyId === m.id}
                          className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {tracksUserId ? (
        <div className="rounded-lg border border-line bg-white p-4">
          <p className="font-medium text-ink">Track coverage</p>
          <p className="mt-1 text-xs text-ink/50">Which tracks this reviewer covers — shown as a "track match" when assigning papers.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {allTracks.length === 0 ? (
              <p className="text-sm text-ink/60">No tracks yet.</p>
            ) : (
              allTracks.map((t) => (
                <label key={t.id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedTracks.has(t.id)}
                    onChange={(e) => {
                      const next = new Set(selectedTracks)
                      if (e.target.checked) next.add(t.id)
                      else next.delete(t.id)
                      setSelectedTracks(next)
                    }}
                  />
                  {t.name}
                </label>
              ))
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={saveTracks}
              disabled={tracksSaving}
              className="rounded-md bg-button px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {tracksSaving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setTracksUserId(null)} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-background">
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <form onSubmit={handleInvite} className="rounded-lg border border-dashed border-line bg-white p-4">
        <p className="font-medium text-ink">Invite by email</p>
        <p className="mt-1 text-xs text-ink/50">
          An existing account is added directly; a new email gets an invitation with a link to set a password.
        </p>
        {inviteError ? <p className="mt-2 text-sm text-red-600">{inviteError}</p> : null}
        {inviteSuccess ? <p className="mt-2 text-sm text-green-700">{inviteSuccess}</p> : null}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            value={invite.full_name}
            onChange={(e) => setInvite((p) => ({ ...p, full_name: e.target.value }))}
            placeholder="Full name"
            className="rounded-md border border-line px-3 py-2 text-sm focus:border-button"
          />
          <input
            value={invite.email}
            onChange={(e) => setInvite((p) => ({ ...p, email: e.target.value }))}
            placeholder="Email"
            type="email"
            className="rounded-md border border-line px-3 py-2 text-sm focus:border-button"
          />
          <input
            value={invite.phone}
            onChange={(e) => setInvite((p) => ({ ...p, phone: e.target.value }))}
            placeholder="Phone"
            className="rounded-md border border-line px-3 py-2 text-sm focus:border-button"
          />
          <select
            value={invite.role_code}
            onChange={(e) => setInvite((p) => ({ ...p, role_code: e.target.value as InviteMemberInput['role_code'] }))}
            className="rounded-md border border-line px-3 py-2 text-sm focus:border-button"
          >
            {ASSIGNABLE_MEMBER_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={inviting}
          className="mt-3 rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {inviting ? 'Sending…' : 'Send invitation'}
        </button>
      </form>
    </div>
  )
}

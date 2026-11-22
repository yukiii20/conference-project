import { useCallback, useEffect, useState } from 'react'
import { RotateCw, Save, Send, X } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { ASSIGNABLE_MEMBER_ROLES, inviteMemberSchema, type InviteMemberInput } from '../../lib/validation'
import { Alert, Button, Checkbox, ConfirmDialog, EmptyState, Input, Select, Spinner, StatusChip } from '../../components/ui'
import { Icon } from '../../components/ui/Icon'
import { TableContainer } from '../../components/ui/Table'
import { formatKathmandu } from '../../lib/datetime'

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

/** GET /conferences/:id/members/invitations (server/src/modules/invitations/service.ts InvitationRow). */
type Invitation = {
  id: string
  email: string
  full_name: string
  role_code: string
  status: 'pending' | 'accepted' | 'declined' | 'cancelled'
  expired: boolean
  expires_at: string
  created_at: string
  email_status: string | null
  email_error: string | null
}

/** POST .../members/invite and .../invitations/:id/resend: how the email went out. */
type EmailOutcome = { status: 'sent' | 'failed' | 'queued'; error_message: string | null; warning: string | null }

function emailNote(email: EmailOutcome | undefined): string {
  if (!email) return ''
  if (email.warning) return ` ${email.warning}`
  if (email.status === 'failed') return ` The email could not be sent${email.error_message ? ` (${email.error_message})` : ''}. Use Resend to try again.`
  if (email.status === 'queued') return ' The email is queued and will go out shortly.'
  return ''
}

const ROLE_LABELS: Record<string, string> = {
  convenor: 'Convenor',
  manager: 'Manager',
  staff: 'Staff',
  reviewer: 'Reviewer',
  session_chair: 'Session chair',
  author: 'Author',
  // The Audience role (code 'attendee'): self-service, comes from the person's registration.
  attendee: 'Audience',
}

const EMPTY_INVITE: InviteMemberInput = { full_name: '', email: '', phone: '', role_code: 'reviewer' }

export function MembersTab({ conferenceId }: { conferenceId: string }) {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})

  const [invite, setInvite] = useState<InviteMemberInput>(EMPTY_INVITE)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)

  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [invitationBusyId, setInvitationBusyId] = useState<string | null>(null)
  const [invitationMessage, setInvitationMessage] = useState<{ variant: 'success' | 'danger'; text: string } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<Member | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<Invitation | null>(null)

  const [tracksUserId, setTracksUserId] = useState<string | null>(null)
  const [allTracks, setAllTracks] = useState<Track[]>([])
  const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set())
  const [tracksSaving, setTracksSaving] = useState(false)

  // Debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300)
    return () => clearTimeout(t)
  }, [q])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ members: Member[] }>(`/conferences/${conferenceId}/members`, {
        q: debouncedQ || undefined,
        role: roleFilter || undefined,
      })
      setMembers(data.members)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load members.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId, debouncedQ, roleFilter])

  useEffect(() => {
    load()
  }, [load])

  // Pending invitations are not members until accepted, so they are listed separately.
  const loadInvitations = useCallback(async () => {
    try {
      const data = await api.get<{ invitations: Invitation[] }>(`/conferences/${conferenceId}/members/invitations`)
      setInvitations(data.invitations.filter((i) => i.status === 'pending'))
    } catch {
      setInvitations([])
    }
  }, [conferenceId])

  useEffect(() => {
    loadInvitations()
  }, [loadInvitations])

  async function handleResend(invitation: Invitation) {
    setInvitationBusyId(invitation.id)
    setInvitationMessage(null)
    try {
      const res = await api.post<{ email: EmailOutcome }>(`/conferences/${conferenceId}/members/invitations/${invitation.id}/resend`)
      setInvitationMessage({ variant: 'success', text: `A new invitation link was sent to ${invitation.email}.${emailNote(res.email)}` })
      await loadInvitations()
    } catch (err) {
      setInvitationMessage({ variant: 'danger', text: err instanceof ApiError ? err.message : 'Could not resend this invitation.' })
    } finally {
      setInvitationBusyId(null)
    }
  }

  async function handleCancelInvitation(invitation: Invitation) {
    setInvitationBusyId(invitation.id)
    setInvitationMessage(null)
    try {
      await api.del(`/conferences/${conferenceId}/members/invitations/${invitation.id}`)
      setInvitationMessage({ variant: 'success', text: `The invitation for ${invitation.email} was cancelled. Its link no longer works.` })
      await loadInvitations()
    } catch (err) {
      setInvitationMessage({ variant: 'danger', text: err instanceof ApiError ? err.message : 'Could not cancel this invitation.' })
    } finally {
      setInvitationBusyId(null)
      setConfirmCancel(null)
    }
  }

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
      setConfirmRemove(null)
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
      const res = await api.post<{ new_account: boolean; email?: EmailOutcome }>(`/conferences/${conferenceId}/members/invite`, parsed.data)
      setInviteSuccess(
        `Invitation email sent. ${
          res.new_account
            ? 'They choose a password from the link in the email.'
            : 'They already have an account and join as soon as they accept.'
        } The link is valid for 7 days.${emailNote(res.email)}`,
      )
      setInvite(EMPTY_INVITE)
      await Promise.all([load(), loadInvitations()])
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
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or email"
            className="w-auto text-sm"
          />
          <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="w-auto text-sm" data-no-dirty>
            <option value="">All roles</option>
            {Object.entries(ROLE_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        {error ? (
          <div className="mt-3">
            <Alert variant="danger">{error}</Alert>
          </div>
        ) : null}

        {loading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-text-muted">
            <Spinner size="sm" /> Loading…
          </div>
        ) : members.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-border bg-surface">
            <EmptyState
              title="No members found."
              message={q || roleFilter ? 'No one matches this search or filter.' : 'Invite someone from the form below.'}
              actionLabel={q || roleFilter ? 'Clear filters' : undefined}
              onAction={
                q || roleFilter
                  ? () => {
                      setQ('')
                      setRoleFilter('')
                    }
                  : undefined
              }
            />
          </div>
        ) : (
          <div className="mt-4">
            <TableContainer minWidth={640}>
              <thead>
                <tr className="border-b border-border bg-surface-muted text-text-muted">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Joined</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.map((m) => (
                  <tr key={m.id} className={m.status === 'removed' ? 'opacity-50' : ''}>
                    <td className="px-3 py-2">{m.full_name}</td>
                    <td className="px-3 py-2">{m.email}</td>
                    <td className="px-3 py-2">
                      {m.role_code === 'convenor' || m.role_code === 'author' || m.role_code === 'attendee' ? (
                        <span>{ROLE_LABELS[m.role_code]}</span>
                      ) : (
                        <Select
                          value={m.role_code}
                          disabled={busyId === m.id || m.status === 'removed'}
                          onChange={(e) => handleRoleChange(m, e.target.value)}
                          className="w-auto text-xs"
                        >
                          {ASSIGNABLE_MEMBER_ROLES.filter((r) => r !== 'author').map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </Select>
                      )}
                      {m.role_code === 'reviewer' ? (
                        <div className="mt-1 flex items-center gap-2">
                          <Input
                            type="number"
                            min={1}
                            placeholder="Max reviews"
                            defaultValue={m.max_review_load ?? ''}
                            onBlur={(e) => handleMaxReviewLoad(m, e.target.value)}
                            className="w-24 text-xs"
                          />
                          <button type="button" onClick={() => openTracks(m)} className="text-xs font-medium text-button underline">
                            Tracks
                          </button>
                        </div>
                      ) : null}
                      {rowErrors[m.id] ? <p className="mt-1 text-xs text-danger">{rowErrors[m.id]}</p> : null}
                    </td>
                    <td className="px-3 py-2">
                      <StatusChip status={m.status} labels={{ active: 'active', removed: 'removed' }} />
                    </td>
                    <td className="px-3 py-2 text-text-muted">{formatKathmandu(m.created_at, { dateOnly: true })}</td>
                    <td className="px-3 py-2 text-right">
                      {m.role_code !== 'convenor' && m.status === 'active' ? (
                        <button
                          type="button"
                          onClick={() => setConfirmRemove(m)}
                          disabled={busyId === m.id}
                          className="text-xs font-medium text-danger hover:underline disabled:opacity-50"
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableContainer>
          </div>
        )}
      </div>

      {tracksUserId ? (
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="font-medium text-text">Track coverage</p>
          <p className="mt-1 text-xs text-text-muted">Which tracks this reviewer covers — shown as a "track match" when assigning papers.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {allTracks.length === 0 ? (
              <p className="text-sm text-text-muted">No tracks yet.</p>
            ) : (
              allTracks.map((t) => (
                <Checkbox
                  key={t.id}
                  label={t.name}
                  checked={selectedTracks.has(t.id)}
                  onChange={(e) => {
                    const next = new Set(selectedTracks)
                    if (e.target.checked) next.add(t.id)
                    else next.delete(t.id)
                    setSelectedTracks(next)
                  }}
                />
              ))
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <Button type="button" size="sm" onClick={saveTracks} loading={tracksSaving} iconLeft={<Icon icon={Save} size={16} />}>
              Save
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setTracksUserId(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {invitations.length > 0 || invitationMessage ? (
        <section aria-labelledby="pending-invitations-heading">
          <h3 id="pending-invitations-heading" className="font-medium text-text">
            Pending invitations{invitations.length > 0 ? ` (${invitations.length})` : ''}
          </h3>
          <p className="mt-1 text-xs text-text-muted">Invited, but not accepted yet. They get access once they accept.</p>
          {invitationMessage ? (
            <div className="mt-2">
              <Alert variant={invitationMessage.variant}>{invitationMessage.text}</Alert>
            </div>
          ) : null}
          {invitations.length > 0 ? (
            <div className="mt-3">
              <TableContainer minWidth={600}>
                <thead>
                  <tr className="border-b border-border bg-surface-muted text-text-muted">
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Email</th>
                    <th className="px-3 py-2 font-medium">Role</th>
                    <th className="px-3 py-2 font-medium">Expires</th>
                    {/* aria-label, not an sr-only span: an absolutely positioned span inside this
                        horizontally scrolling table escapes it and widens the page on phones. */}
                    <th className="px-3 py-2 font-medium" aria-label="Actions"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invitations.map((inv) => (
                    <tr key={inv.id}>
                      <td className="px-3 py-2">{inv.full_name}</td>
                      <td className="px-3 py-2">
                        {inv.email}
                        {inv.email_status === 'failed' ? <p className="mt-1 text-xs text-danger">Email not delivered. Resend it.</p> : null}
                      </td>
                      <td className="px-3 py-2">{ROLE_LABELS[inv.role_code] ?? inv.role_code}</td>
                      <td className="px-3 py-2 text-text-muted">
                        {inv.expired ? <span className="text-danger">Expired</span> : formatKathmandu(inv.expires_at, { dateOnly: true })}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleResend(inv)}
                            disabled={invitationBusyId !== null}
                            loading={invitationBusyId === inv.id && !confirmCancel}
                            iconLeft={<Icon icon={RotateCw} size={14} />}
                          >
                            Resend
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmCancel(inv)}
                            disabled={invitationBusyId !== null}
                            iconLeft={<Icon icon={X} size={14} />}
                          >
                            Cancel
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableContainer>
            </div>
          ) : null}
        </section>
      ) : null}

      <ConfirmDialog
        open={confirmRemove !== null}
        title="Remove this member?"
        message={
          confirmRemove ? (
            <>
              {confirmRemove.full_name} ({confirmRemove.email}) loses the {ROLE_LABELS[confirmRemove.role_code]?.toLowerCase() ?? 'member'} role at
              this conference. Their account and past work are kept, and you can invite them again later.
            </>
          ) : null
        }
        confirmLabel="Remove member"
        busy={confirmRemove !== null && busyId === confirmRemove.id}
        onConfirm={() => confirmRemove && handleRemove(confirmRemove)}
        onCancel={() => setConfirmRemove(null)}
      />
      <ConfirmDialog
        open={confirmCancel !== null}
        title="Cancel this invitation?"
        message={confirmCancel ? <>The link sent to {confirmCancel.email} stops working. You can invite them again later.</> : null}
        confirmLabel="Cancel invitation"
        cancelLabel="Keep it"
        busy={confirmCancel !== null && invitationBusyId === confirmCancel.id}
        onConfirm={() => confirmCancel && handleCancelInvitation(confirmCancel)}
        onCancel={() => setConfirmCancel(null)}
      />

      <form onSubmit={handleInvite} className="rounded-lg border border-dashed border-border bg-surface p-4">
        <p className="font-medium text-text">Invite by email</p>
        <p className="mt-1 text-xs text-text-muted">
          Everyone gets an email with a link to accept. A new email address sets a password from that link; an existing account signs in to accept.
        </p>
        {inviteError ? (
          <div className="mt-2">
            <Alert variant="danger">{inviteError}</Alert>
          </div>
        ) : null}
        {inviteSuccess ? (
          <div className="mt-2">
            <Alert variant="success">{inviteSuccess}</Alert>
          </div>
        ) : null}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            value={invite.full_name}
            onChange={(e) => setInvite((p) => ({ ...p, full_name: e.target.value }))}
            placeholder="Full name"
            className="text-sm"
          />
          <Input
            value={invite.email}
            onChange={(e) => setInvite((p) => ({ ...p, email: e.target.value }))}
            placeholder="Email"
            type="email"
            className="text-sm"
          />
          <Input
            value={invite.phone}
            onChange={(e) => setInvite((p) => ({ ...p, phone: e.target.value }))}
            placeholder="Phone"
            className="text-sm"
          />
          <Select
            value={invite.role_code}
            onChange={(e) => setInvite((p) => ({ ...p, role_code: e.target.value as InviteMemberInput['role_code'] }))}
            className="text-sm"
          >
            {ASSIGNABLE_MEMBER_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" className="mt-3" loading={inviting} iconLeft={<Icon icon={Send} size={16} />}>
          Send invitation
        </Button>
      </form>
    </div>
  )
}
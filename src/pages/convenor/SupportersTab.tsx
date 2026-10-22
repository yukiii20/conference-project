import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { SUPPORTER_TIERS, supporterSchema, type SupporterTier } from '../../lib/validation'
import { ImageUpload } from '../../components/ImageUpload'
import { ConfirmDialog } from '../../components/ui/Modal'
import { Alert, Button, EmptyState, Input, Select, Spinner } from '../../components/ui'

const MAX_MB = 2

type Supporter = {
  id: string
  name: string
  tier: SupporterTier
  logo_path: string | null
  website_url: string | null
  display_order: number
  is_active: boolean
}

type EditState = { name: string; tier: SupporterTier; website_url: string }

function toEditState(s: Supporter): EditState {
  return { name: s.name, tier: s.tier, website_url: s.website_url ?? '' }
}

const EMPTY_NEW: EditState = { name: '', tier: 'sponsor', website_url: '' }

const TIER_LABELS: Record<SupporterTier, string> = {
  organizer: 'Organizer',
  co_organizer: 'Co-organizer',
  sponsor: 'Sponsor',
  partner: 'Partner',
  media: 'Media partner',
}

export function SupportersTab({ conferenceId }: { conferenceId: string }) {
  const [supporters, setSupporters] = useState<Supporter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, EditState>>({})
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmingRemove, setConfirmingRemove] = useState<Supporter | null>(null)
  const [newSupporter, setNewSupporter] = useState<EditState>(EMPTY_NEW)
  const [newError, setNewError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ supporters: Supporter[] }>(`/conferences/${conferenceId}/supporters`)
      setSupporters(data.supporters)
      setEdits(Object.fromEntries(data.supporters.map((s) => [s.id, toEditState(s)])))
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load supporters.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load])

  function updateEdit(id: string, patch: Partial<EditState>) {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  async function handleSaveRow(supporter: Supporter) {
    const edit = edits[supporter.id]
    const parsed = supporterSchema.safeParse({
      ...edit,
      display_order: supporter.display_order,
      is_active: supporter.is_active,
    })
    if (!parsed.success) {
      setRowErrors((prev) => ({ ...prev, [supporter.id]: parsed.error.issues[0]?.message ?? 'Invalid value.' }))
      return
    }
    setRowErrors((prev) => ({ ...prev, [supporter.id]: '' }))
    setBusyId(supporter.id)
    try {
      await api.patch(`/conferences/${conferenceId}/supporters/${supporter.id}`, {
        name: parsed.data.name,
        tier: parsed.data.tier,
        website_url: parsed.data.website_url,
      })
      await load()
    } catch (err) {
      setRowErrors((prev) => ({
        ...prev,
        [supporter.id]: err instanceof ApiError ? err.message : 'Could not save this.',
      }))
    } finally {
      setBusyId(null)
    }
  }

  async function handleToggleActive(supporter: Supporter) {
    setBusyId(supporter.id)
    try {
      await api.patch(`/conferences/${conferenceId}/supporters/${supporter.id}/active`, {
        is_active: !supporter.is_active,
      })
      await load()
    } catch (err) {
      setRowErrors((prev) => ({
        ...prev,
        [supporter.id]: err instanceof ApiError ? err.message : 'Could not update this.',
      }))
    } finally {
      setBusyId(null)
    }
  }

  async function handleMove(supporter: Supporter, direction: 'up' | 'down') {
    const group = [...supporters]
      .filter((s) => s.tier === supporter.tier)
      .sort((a, b) => a.display_order - b.display_order)
    const index = group.findIndex((s) => s.id === supporter.id)
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= group.length) return

    const reordered = [...group]
    const tmp = reordered[index]!
    reordered[index] = reordered[swapIndex]!
    reordered[swapIndex] = tmp

    setBusyId(supporter.id)
    try {
      await api.post(`/conferences/${conferenceId}/supporters/reorder`, {
        tier: supporter.tier,
        supporter_ids: reordered.map((s) => s.id),
      })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reorder supporters.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleRemove(supporter: Supporter) {
    setConfirmingRemove(null)
    setBusyId(supporter.id)
    try {
      await api.del(`/conferences/${conferenceId}/supporters/${supporter.id}`)
      await load()
    } catch (err) {
      setRowErrors((prev) => ({
        ...prev,
        [supporter.id]: err instanceof ApiError ? err.message : 'Could not delete this.',
      }))
    } finally {
      setBusyId(null)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setNewError(null)
    const parsed = supporterSchema.safeParse({ ...newSupporter, display_order: 0, is_active: true })
    if (!parsed.success) {
      setNewError(parsed.error.issues[0]?.message ?? 'Invalid value.')
      return
    }
    setCreating(true)
    try {
      await api.post(`/conferences/${conferenceId}/supporters`, {
        name: parsed.data.name,
        tier: parsed.data.tier,
        website_url: parsed.data.website_url,
      })
      setNewSupporter(EMPTY_NEW)
      await load()
    } catch (err) {
      setNewError(err instanceof ApiError ? err.message : 'Could not create this supporter.')
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <div className="mt-6 flex items-center gap-2 text-sm text-text-muted">
        <Spinner size="sm" /> Loading…
      </div>
    )
  }

  const grouped = SUPPORTER_TIERS.map((tier) => ({
    tier,
    items: supporters.filter((s) => s.tier === tier).sort((a, b) => a.display_order - b.display_order),
  })).filter((g) => g.items.length > 0)

  return (
    <div className="mt-6 max-w-3xl">
      {error ? (
        <div className="mb-4">
          <Alert variant="danger">{error}</Alert>
        </div>
      ) : null}

      {supporters.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface">
          <EmptyState title="No supporters yet." />
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.tier}>
              <h3 className="mb-2 text-sm font-semibold text-text-muted">{TIER_LABELS[group.tier]}</h3>
              <div className="space-y-3">
                {group.items.map((supporter, i) => {
                  const edit = edits[supporter.id] ?? toEditState(supporter)
                  return (
                    <div
                      key={supporter.id}
                      className={`rounded-lg border border-border bg-surface p-4 ${supporter.is_active ? '' : 'opacity-60'}`}
                    >
                      {rowErrors[supporter.id] ? (
                        <p className="mb-2 text-sm text-danger">{rowErrors[supporter.id]}</p>
                      ) : null}
                      <div className="flex flex-wrap gap-4">
                        <ImageUpload
                          label="logo"
                          currentPath={supporter.logo_path}
                          maxSizeMB={MAX_MB}
                          aspect="square"
                          size="sm"
                          uploadUrl={`/api/conferences/${conferenceId}/supporters/${supporter.id}/logo`}
                          removeUrl={`/api/conferences/${conferenceId}/supporters/${supporter.id}/logo`}
                          onSaved={() => load()}
                          onRemoved={() => load()}
                        />
                        <div className="min-w-[220px] flex-1 space-y-2">
                          <Input
                            value={edit.name}
                            onChange={(e) => updateEdit(supporter.id, { name: e.target.value })}
                            placeholder="Name"
                          />
                          <div className="flex flex-wrap gap-2">
                            <Select
                              value={edit.tier}
                              onChange={(e) => updateEdit(supporter.id, { tier: e.target.value as SupporterTier })}
                              className="w-auto"
                            >
                              {SUPPORTER_TIERS.map((t) => (
                                <option key={t} value={t}>
                                  {TIER_LABELS[t]}
                                </option>
                              ))}
                            </Select>
                            <Input
                              value={edit.website_url}
                              onChange={(e) => updateEdit(supporter.id, { website_url: e.target.value })}
                              placeholder="https://"
                              className="flex-1"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button type="button" size="sm" onClick={() => handleSaveRow(supporter)} disabled={busyId === supporter.id}>
                          Save
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => handleMove(supporter, 'up')}
                          disabled={busyId === supporter.id || i === 0}
                        >
                          ↑
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => handleMove(supporter, 'down')}
                          disabled={busyId === supporter.id || i === group.items.length - 1}
                        >
                          ↓
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => handleToggleActive(supporter)}
                          disabled={busyId === supporter.id}
                        >
                          {supporter.is_active ? 'Hide' : 'Show'}
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          className="ml-auto"
                          onClick={() => setConfirmingRemove(supporter)}
                          disabled={busyId === supporter.id}
                        >
                          Delete supporter
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleCreate} className="mt-6 rounded-lg border border-dashed border-border bg-surface p-4">
        <p className="font-medium text-text">Add a supporter</p>
        {newError ? (
          <div className="mt-2">
            <Alert variant="danger">{newError}</Alert>
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Input
            value={newSupporter.name}
            onChange={(e) => setNewSupporter((p) => ({ ...p, name: e.target.value }))}
            placeholder="Name"
            className="flex-1"
          />
          <Select
            value={newSupporter.tier}
            onChange={(e) => setNewSupporter((p) => ({ ...p, tier: e.target.value as SupporterTier }))}
            className="w-auto"
          >
            {SUPPORTER_TIERS.map((t) => (
              <option key={t} value={t}>
                {TIER_LABELS[t]}
              </option>
            ))}
          </Select>
          <Input
            value={newSupporter.website_url}
            onChange={(e) => setNewSupporter((p) => ({ ...p, website_url: e.target.value }))}
            placeholder="https://"
            className="flex-1"
          />
        </div>
        <p className="mt-2 text-xs text-text-muted">Add the logo after creating, from the row below.</p>
        <Button type="submit" className="mt-3" loading={creating}>
          Add supporter
        </Button>
      </form>

      <ConfirmDialog
        open={confirmingRemove !== null}
        title={`Delete ${confirmingRemove?.name ?? 'this supporter'}?`}
        message="This also removes its logo. This cannot be undone."
        confirmLabel="Delete"
        busy={busyId === confirmingRemove?.id}
        onConfirm={() => confirmingRemove && handleRemove(confirmingRemove)}
        onCancel={() => setConfirmingRemove(null)}
      />
    </div>
  )
}

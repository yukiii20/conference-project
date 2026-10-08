import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { imageExtension } from '../../lib/storage'
import { SUPPORTER_TIERS, supporterSchema, type SupporterTier } from '../../lib/validation'
import { ImageUpload } from '../../components/ImageUpload'

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
  const [newSupporter, setNewSupporter] = useState<EditState>(EMPTY_NEW)
  const [newError, setNewError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: loadError } = await supabase
      .from('conference_supporters')
      .select('id, name, tier, logo_path, website_url, display_order, is_active')
      .eq('conference_id', conferenceId)
      .order('tier', { ascending: true })
      .order('display_order', { ascending: true })

    if (loadError) {
      setError(loadError.message)
      setLoading(false)
      return
    }

    const list = (data ?? []) as Supporter[]
    setSupporters(list)
    setEdits(Object.fromEntries(list.map((s) => [s.id, toEditState(s)])))
    setError(null)
    setLoading(false)
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
    const { error: saveError } = await supabase
      .from('conference_supporters')
      .update({ name: parsed.data.name, tier: parsed.data.tier, website_url: parsed.data.website_url })
      .eq('id', supporter.id)
    setBusyId(null)
    if (saveError) {
      setRowErrors((prev) => ({ ...prev, [supporter.id]: saveError.message }))
      return
    }
    await load()
  }

  async function handleToggleActive(supporter: Supporter) {
    setBusyId(supporter.id)
    const { error: toggleError } = await supabase
      .from('conference_supporters')
      .update({ is_active: !supporter.is_active })
      .eq('id', supporter.id)
    setBusyId(null)
    if (toggleError) {
      setRowErrors((prev) => ({ ...prev, [supporter.id]: toggleError.message }))
      return
    }
    await load()
  }

  async function handleMove(supporter: Supporter, direction: 'up' | 'down') {
    const group = [...supporters]
      .filter((s) => s.tier === supporter.tier)
      .sort((a, b) => a.display_order - b.display_order)
    const index = group.findIndex((s) => s.id === supporter.id)
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= group.length) return
    const other = group[swapIndex]

    setBusyId(supporter.id)
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('conference_supporters').update({ display_order: other.display_order }).eq('id', supporter.id),
      supabase.from('conference_supporters').update({ display_order: supporter.display_order }).eq('id', other.id),
    ])
    setBusyId(null)
    if (e1 || e2) {
      setError((e1 ?? e2)?.message ?? 'Could not reorder supporters.')
      return
    }
    await load()
  }

  async function handleRemove(supporter: Supporter) {
    if (!window.confirm(`Delete ${supporter.name}? This also removes its logo.`)) return
    setBusyId(supporter.id)
    const { error: deleteError } = await supabase.from('conference_supporters').delete().eq('id', supporter.id)
    setBusyId(null)
    if (deleteError) {
      setRowErrors((prev) => ({ ...prev, [supporter.id]: deleteError.message }))
      return
    }
    if (supporter.logo_path) {
      await supabase.storage.from('public-assets').remove([supporter.logo_path])
    }
    await load()
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
    const siblingOrders = supporters.filter((s) => s.tier === parsed.data.tier).map((s) => s.display_order)
    const nextOrder = siblingOrders.length === 0 ? 0 : Math.max(...siblingOrders) + 1
    const { error: createError } = await supabase.from('conference_supporters').insert({
      conference_id: conferenceId,
      name: parsed.data.name,
      tier: parsed.data.tier,
      website_url: parsed.data.website_url,
      display_order: nextOrder,
    })
    setCreating(false)
    if (createError) {
      setNewError(createError.message)
      return
    }
    setNewSupporter(EMPTY_NEW)
    await load()
  }

  if (loading) {
    return <p className="mt-6 text-sm text-ink/60">Loading…</p>
  }

  const grouped = SUPPORTER_TIERS.map((tier) => ({
    tier,
    items: supporters.filter((s) => s.tier === tier).sort((a, b) => a.display_order - b.display_order),
  })).filter((g) => g.items.length > 0)

  return (
    <div className="mt-6 max-w-3xl">
      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

      {supporters.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">
          No supporters yet.
        </p>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.tier}>
              <h3 className="mb-2 text-sm font-semibold text-ink/70">{TIER_LABELS[group.tier]}</h3>
              <div className="space-y-3">
                {group.items.map((supporter, i) => {
                  const edit = edits[supporter.id] ?? toEditState(supporter)
                  return (
                    <div
                      key={supporter.id}
                      className={`rounded-lg border border-line bg-white p-4 ${supporter.is_active ? '' : 'opacity-60'}`}
                    >
                      {rowErrors[supporter.id] ? (
                        <p className="mb-2 text-sm text-red-600">{rowErrors[supporter.id]}</p>
                      ) : null}
                      <div className="flex flex-wrap gap-4">
                        <ImageUpload
                          label="logo"
                          currentPath={supporter.logo_path}
                          maxSizeMB={MAX_MB}
                          aspect="square"
                          size="sm"
                          buildPath={(file) =>
                            `conferences/${conferenceId}/supporters/${crypto.randomUUID()}.${imageExtension(file.type)}`
                          }
                          onSaved={async (path) => {
                            const { error } = await supabase
                              .from('conference_supporters')
                              .update({ logo_path: path })
                              .eq('id', supporter.id)
                            if (error) return error.message
                            await load()
                            return null
                          }}
                          onRemoved={async () => {
                            const { error } = await supabase
                              .from('conference_supporters')
                              .update({ logo_path: null })
                              .eq('id', supporter.id)
                            if (error) return error.message
                            await load()
                            return null
                          }}
                        />
                        <div className="min-w-[220px] flex-1 space-y-2">
                          <input
                            value={edit.name}
                            onChange={(e) => updateEdit(supporter.id, { name: e.target.value })}
                            placeholder="Name"
                            className="w-full rounded-md border border-line px-3 py-2 focus:border-button"
                          />
                          <div className="flex flex-wrap gap-2">
                            <select
                              value={edit.tier}
                              onChange={(e) => updateEdit(supporter.id, { tier: e.target.value as SupporterTier })}
                              className="rounded-md border border-line bg-white px-3 py-2 focus:border-button"
                            >
                              {SUPPORTER_TIERS.map((t) => (
                                <option key={t} value={t}>
                                  {TIER_LABELS[t]}
                                </option>
                              ))}
                            </select>
                            <input
                              value={edit.website_url}
                              onChange={(e) => updateEdit(supporter.id, { website_url: e.target.value })}
                              placeholder="https://"
                              className="flex-1 rounded-md border border-line px-3 py-2 focus:border-button"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleSaveRow(supporter)}
                          disabled={busyId === supporter.id}
                          className="rounded-md bg-button px-3 py-1 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMove(supporter, 'up')}
                          disabled={busyId === supporter.id || i === 0}
                          className="rounded-md border border-line px-3 py-1 text-sm hover:bg-background disabled:opacity-40"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMove(supporter, 'down')}
                          disabled={busyId === supporter.id || i === group.items.length - 1}
                          className="rounded-md border border-line px-3 py-1 text-sm hover:bg-background disabled:opacity-40"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleActive(supporter)}
                          disabled={busyId === supporter.id}
                          className="rounded-md border border-line px-3 py-1 text-sm hover:bg-background disabled:opacity-50"
                        >
                          {supporter.is_active ? 'Hide' : 'Show'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemove(supporter)}
                          disabled={busyId === supporter.id}
                          className="ml-auto rounded-md border border-red-200 px-3 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          Delete supporter
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleCreate} className="mt-6 rounded-lg border border-dashed border-line bg-white p-4">
        <p className="font-medium text-ink">Add a supporter</p>
        {newError ? <p className="mt-2 text-sm text-red-600">{newError}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={newSupporter.name}
            onChange={(e) => setNewSupporter((p) => ({ ...p, name: e.target.value }))}
            placeholder="Name"
            className="flex-1 rounded-md border border-line px-3 py-2 focus:border-button"
          />
          <select
            value={newSupporter.tier}
            onChange={(e) => setNewSupporter((p) => ({ ...p, tier: e.target.value as SupporterTier }))}
            className="rounded-md border border-line bg-white px-3 py-2 focus:border-button"
          >
            {SUPPORTER_TIERS.map((t) => (
              <option key={t} value={t}>
                {TIER_LABELS[t]}
              </option>
            ))}
          </select>
          <input
            value={newSupporter.website_url}
            onChange={(e) => setNewSupporter((p) => ({ ...p, website_url: e.target.value }))}
            placeholder="https://"
            className="flex-1 rounded-md border border-line px-3 py-2 focus:border-button"
          />
        </div>
        <p className="mt-2 text-xs text-ink/50">Add the logo after creating, from the row below.</p>
        <button
          type="submit"
          disabled={creating}
          className="mt-3 rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {creating ? 'Adding…' : 'Add supporter'}
        </button>
      </form>
    </div>
  )
}

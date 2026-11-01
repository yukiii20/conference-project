import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../../lib/api'
import { ROOM_EQUIPMENT, ROOM_EQUIPMENT_LABELS, roomSchema } from '../../../lib/validation'
import { Alert, Button, Checkbox, EmptyState, Input, SkeletonText, StatusChip } from '../../../components/ui'
import { EMPTY_ROOM, type Room } from './shared'

export function RoomsSection({ conferenceId, onRoomsChanged }: { conferenceId: string; onRoomsChanged: () => void }) {
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newRoom, setNewRoom] = useState(EMPTY_ROOM)
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ rooms: Room[] }>(`/conferences/${conferenceId}/rooms`)
      setRooms(data.rooms)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load rooms.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load])

  function toggleEquipment(item: string) {
    setNewRoom((p) => ({
      ...p,
      equipment: p.equipment.includes(item) ? p.equipment.filter((e) => e !== item) : [...p.equipment, item],
    }))
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const parsed = roomSchema.safeParse(newRoom)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid value.')
      return
    }
    setCreating(true)
    try {
      await api.post(`/conferences/${conferenceId}/rooms`, parsed.data)
      setNewRoom(EMPTY_ROOM)
      await load()
      onRoomsChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create this room.')
    } finally {
      setCreating(false)
    }
  }

  async function handleToggle(room: Room) {
    setBusyId(room.id)
    setError(null)
    try {
      await api.patch(`/conferences/${conferenceId}/rooms/${room.id}/status`, {
        status: room.status === 'active' ? 'inactive' : 'active',
      })
      await load()
      onRoomsChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this room.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <h2 className="font-display text-xl font-semibold text-brand">Rooms</h2>
      {error ? <Alert variant="danger">{error}</Alert> : null}

      {loading ? (
        <SkeletonText lines={3} className="mt-3" />
      ) : rooms.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-border bg-surface">
          <EmptyState title="No rooms yet." />
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted text-text-muted">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Building / floor</th>
                <th className="px-4 py-2 font-medium">Capacity</th>
                <th className="px-4 py-2 font-medium">Equipment</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rooms.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2">
                    {r.name}
                    {r.room_number ? <span className="text-text-muted"> ({r.room_number})</span> : null}
                  </td>
                  <td className="px-4 py-2">{[r.building, r.floor].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-4 py-2">{r.capacity ?? '—'}</td>
                  <td className="px-4 py-2 text-xs text-text/70">
                    {r.equipment.length > 0
                      ? r.equipment.map((e) => ROOM_EQUIPMENT_LABELS[e as keyof typeof ROOM_EQUIPMENT_LABELS] ?? e).join(', ')
                      : '—'}
                  </td>
                  <td className="px-4 py-2">
                    <StatusChip status={r.status} />
                  </td>
                  <td className="px-4 py-2">
                    <Button type="button" variant="secondary" size="sm" onClick={() => handleToggle(r)} disabled={busyId === r.id}>
                      {r.status === 'active' ? 'Deactivate' : 'Activate'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={handleCreate} className="mt-4 space-y-3 rounded-lg border border-dashed border-border bg-surface p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-text-muted">Name</label>
            <Input
              value={newRoom.name}
              onChange={(e) => setNewRoom((p) => ({ ...p, name: e.target.value }))}
              className="mt-1"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted">Room number</label>
            <Input
              value={newRoom.room_number}
              onChange={(e) => setNewRoom((p) => ({ ...p, room_number: e.target.value }))}
              className="mt-1"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted">Building</label>
            <Input
              value={newRoom.building}
              onChange={(e) => setNewRoom((p) => ({ ...p, building: e.target.value }))}
              className="mt-1"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted">Floor</label>
            <Input
              value={newRoom.floor}
              onChange={(e) => setNewRoom((p) => ({ ...p, floor: e.target.value }))}
              className="mt-1"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-text-muted">Capacity</label>
            <Input
              type="number"
              min={1}
              value={newRoom.capacity}
              onChange={(e) => setNewRoom((p) => ({ ...p, capacity: e.target.value }))}
              className="mt-1"
            />
          </div>
          <div className="col-span-2 sm:col-span-3">
            <label className="block text-xs font-medium text-text-muted">Description</label>
            <Input
              value={newRoom.description}
              onChange={(e) => setNewRoom((p) => ({ ...p, description: e.target.value }))}
              className="mt-1"
            />
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-text-muted">Equipment</p>
          <div className="mt-1 flex flex-wrap gap-3">
            {ROOM_EQUIPMENT.map((item) => (
              <Checkbox
                key={item}
                label={ROOM_EQUIPMENT_LABELS[item]}
                checked={newRoom.equipment.includes(item)}
                onChange={() => toggleEquipment(item)}
              />
            ))}
          </div>
        </div>
        <Button type="submit" variant="primary" disabled={creating}>
          {creating ? 'Adding…' : 'Add room'}
        </Button>
      </form>
    </div>
  )
}

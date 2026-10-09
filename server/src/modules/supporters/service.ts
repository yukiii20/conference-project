import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog } from '../../utils/audit.js'
import { NotFoundError } from '../../utils/errors.js'
import type { CreateSupporterInput, SupporterTier, UpdateSupporterInput } from './validation.js'

export type SupporterRow = {
  id: string
  name: string
  tier: SupporterTier
  logo_path: string | null
  website_url: string | null
  display_order: number
  is_active: boolean
}

export async function listSupporters(conferenceId: string): Promise<SupporterRow[]> {
  const [rows] = await pool.query(
    `SELECT id, name, tier, logo_path, website_url, display_order, is_active
     FROM conference_supporters WHERE conference_id = ? ORDER BY tier, display_order`,
    [conferenceId],
  )
  return rows as SupporterRow[]
}

export async function createSupporter(
  actorUserId: string,
  conferenceId: string,
  input: CreateSupporterInput,
): Promise<{ id: string }> {
  return withTransaction(actorUserId, async (conn) => {
    const [orderRows] = await conn.query(
      'SELECT MAX(display_order) AS max_order FROM conference_supporters WHERE conference_id = ? AND tier = ?',
      [conferenceId, input.tier],
    )
    const nextOrder = ((orderRows as Array<{ max_order: number | null }>)[0]?.max_order ?? -1) + 1

    await conn.query(
      `INSERT INTO conference_supporters (conference_id, name, tier, website_url, display_order) VALUES (?, ?, ?, ?, ?)`,
      [conferenceId, input.name, input.tier, input.website_url, nextOrder],
    )
    const [rows] = await conn.query(
      'SELECT id FROM conference_supporters WHERE conference_id = ? AND tier = ? AND display_order = ? LIMIT 1',
      [conferenceId, input.tier, nextOrder],
    )
    const id = (rows as Array<{ id: string }>)[0]?.id
    if (!id) throw new Error('Could not create the supporter.')

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'supporter.create',
      entityType: 'conference_supporters',
      entityId: id,
      newValues: input,
    })
    return { id }
  })
}

async function loadSupporterForUpdate(
  conn: PoolConnection,
  conferenceId: string,
  supporterId: string,
): Promise<SupporterRow> {
  const [rows] = await conn.query(
    `SELECT id, name, tier, logo_path, website_url, display_order, is_active FROM conference_supporters
     WHERE id = ? AND conference_id = ? LIMIT 1 FOR UPDATE`,
    [supporterId, conferenceId],
  )
  const row = (rows as SupporterRow[])[0]
  if (!row) throw new NotFoundError('This supporter does not exist.')
  return row
}

export async function updateSupporter(
  actorUserId: string,
  conferenceId: string,
  supporterId: string,
  input: UpdateSupporterInput,
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadSupporterForUpdate(conn, conferenceId, supporterId)

    const assignments: string[] = []
    const values: unknown[] = []
    const oldValues: Record<string, unknown> = {}
    const newValues: Record<string, unknown> = {}
    for (const key of ['name', 'tier', 'website_url'] as const) {
      if (!(key in input)) continue
      const value = (input as Record<string, unknown>)[key]
      if (value === current[key]) continue
      assignments.push(`${key} = ?`)
      values.push(value)
      oldValues[key] = current[key]
      newValues[key] = value
    }
    if (assignments.length === 0) return

    values.push(supporterId)
    await conn.query(`UPDATE conference_supporters SET ${assignments.join(', ')} WHERE id = ?`, values)
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'supporter.update',
      entityType: 'conference_supporters',
      entityId: supporterId,
      oldValues,
      newValues,
    })
  })
}

export async function setSupporterActive(
  actorUserId: string,
  conferenceId: string,
  supporterId: string,
  isActive: boolean,
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadSupporterForUpdate(conn, conferenceId, supporterId)
    if (current.is_active === isActive) return

    await conn.query('UPDATE conference_supporters SET is_active = ? WHERE id = ?', [isActive, supporterId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'supporter.set_active',
      entityType: 'conference_supporters',
      entityId: supporterId,
      oldValues: { is_active: current.is_active },
      newValues: { is_active: isActive },
    })
  })
}

export async function deleteSupporter(actorUserId: string, conferenceId: string, supporterId: string): Promise<{ logoPath: string | null }> {
  return withTransaction(actorUserId, async (conn) => {
    const current = await loadSupporterForUpdate(conn, conferenceId, supporterId)
    await conn.query('DELETE FROM conference_supporters WHERE id = ?', [supporterId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'supporter.delete',
      entityType: 'conference_supporters',
      entityId: supporterId,
      oldValues: current,
    })
    return { logoPath: current.logo_path }
  })
}

export async function reorderSupporters(
  actorUserId: string,
  conferenceId: string,
  tier: SupporterTier,
  supporterIds: string[],
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query('SELECT id FROM conference_supporters WHERE conference_id = ? AND tier = ?', [
      conferenceId,
      tier,
    ])
    const existingIds = new Set((rows as Array<{ id: string }>).map((r) => r.id))
    for (const id of supporterIds) {
      if (!existingIds.has(id)) throw new NotFoundError('One of these supporters does not exist.')
    }

    for (const [index, id] of supporterIds.entries()) {
      await conn.query('UPDATE conference_supporters SET display_order = ? WHERE id = ? AND conference_id = ?', [
        index,
        id,
        conferenceId,
      ])
    }

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'supporter.reorder',
      entityType: 'conference_supporters',
      newValues: { tier, supporter_ids: supporterIds },
    })
  })
}

export async function setSupporterLogoPath(
  actorUserId: string,
  conferenceId: string,
  supporterId: string,
  newPath: string | null,
): Promise<string | null> {
  return withTransaction(actorUserId, async (conn) => {
    const current = await loadSupporterForUpdate(conn, conferenceId, supporterId)
    await conn.query('UPDATE conference_supporters SET logo_path = ? WHERE id = ?', [newPath, supporterId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'supporter.logo_path',
      entityType: 'conference_supporters',
      entityId: supporterId,
      oldValues: { logo_path: current.logo_path },
      newValues: { logo_path: newPath },
    })
    return current.logo_path
  })
}

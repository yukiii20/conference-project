import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog } from '../../utils/audit.js'
import { BadRequestError, NotFoundError } from '../../utils/errors.js'
import type {
  CreateCommitteeInput,
  CreateCommitteeMemberInput,
  UpdateCommitteeInput,
  UpdateCommitteeMemberInput,
} from './validation.js'

export type CommitteeMemberRow = {
  id: string
  user_id: string | null
  display_name: string | null
  affiliation: string | null
  country: string | null
  member_role: string
  display_order: number
  full_name: string | null
  email: string | null
  photo_path: string | null
}

export type CommitteeRow = {
  id: string
  name: string
  committee_type: string
  description: string | null
  display_order: number
  is_public: boolean
  members: CommitteeMemberRow[]
}

const MEMBER_COLUMNS = `
  cm.id, cm.user_id, cm.display_name, cm.affiliation, cm.country, cm.member_role, cm.display_order,
  u.full_name, u.email, u.photo_path
`

/** Exact-email lookup so a convenor can pick an existing platform user for a committee seat. */
export async function lookupUserByEmail(email: string): Promise<{ id: string; full_name: string; email: string } | null> {
  const [rows] = await pool.query('SELECT id, full_name, email FROM users WHERE email = ? AND status = ? LIMIT 1', [
    email,
    'active',
  ])
  return (rows as Array<{ id: string; full_name: string; email: string }>)[0] ?? null
}

export async function listCommittees(conferenceId: string): Promise<CommitteeRow[]> {
  const [committeeRows] = await pool.query(
    `SELECT id, name, committee_type, description, display_order, is_public
     FROM committees WHERE conference_id = ? ORDER BY display_order`,
    [conferenceId],
  )
  const committees = committeeRows as Omit<CommitteeRow, 'members'>[]
  if (committees.length === 0) return []

  const [memberRows] = await pool.query(
    `SELECT cm.committee_id, ${MEMBER_COLUMNS}
     FROM committee_members cm
     LEFT JOIN users u ON u.id = cm.user_id
     WHERE cm.committee_id IN (?)
     ORDER BY cm.display_order`,
    [committees.map((c) => c.id)],
  )
  const byCommittee = new Map<string, CommitteeMemberRow[]>()
  for (const row of memberRows as Array<CommitteeMemberRow & { committee_id: string }>) {
    const { committee_id, ...member } = row
    if (!byCommittee.has(committee_id)) byCommittee.set(committee_id, [])
    byCommittee.get(committee_id)!.push(member)
  }

  return committees.map((c) => ({ ...c, members: byCommittee.get(c.id) ?? [] }))
}

export async function createCommittee(
  actorUserId: string,
  conferenceId: string,
  input: CreateCommitteeInput,
): Promise<{ id: string }> {
  return withTransaction(actorUserId, async (conn) => {
    const [orderRows] = await conn.query('SELECT MAX(display_order) AS max_order FROM committees WHERE conference_id = ?', [
      conferenceId,
    ])
    const nextOrder = ((orderRows as Array<{ max_order: number | null }>)[0]?.max_order ?? -1) + 1

    try {
      await conn.query(
        `INSERT INTO committees (conference_id, name, committee_type, description, is_public, display_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [conferenceId, input.name, input.committee_type, input.description ?? null, input.is_public, nextOrder],
      )
    } catch (err) {
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
        throw new BadRequestError('A committee with this name already exists.')
      }
      throw err
    }
    const [rows] = await conn.query(
      'SELECT id FROM committees WHERE conference_id = ? AND name = ? LIMIT 1',
      [conferenceId, input.name],
    )
    const id = (rows as Array<{ id: string }>)[0]?.id
    if (!id) throw new Error('Could not create the committee.')

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'committee.create',
      entityType: 'committees',
      entityId: id,
      newValues: input,
    })
    return { id }
  })
}

async function loadCommitteeForUpdate(
  conn: PoolConnection,
  conferenceId: string,
  committeeId: string,
): Promise<Omit<CommitteeRow, 'members'>> {
  const [rows] = await conn.query(
    `SELECT id, name, committee_type, description, display_order, is_public FROM committees
     WHERE id = ? AND conference_id = ? LIMIT 1 FOR UPDATE`,
    [committeeId, conferenceId],
  )
  const row = (rows as Omit<CommitteeRow, 'members'>[])[0]
  if (!row) throw new NotFoundError('This committee does not exist.')
  return row
}

export async function updateCommittee(
  actorUserId: string,
  conferenceId: string,
  committeeId: string,
  input: UpdateCommitteeInput,
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadCommitteeForUpdate(conn, conferenceId, committeeId)

    const assignments: string[] = []
    const values: unknown[] = []
    const oldValues: Record<string, unknown> = {}
    const newValues: Record<string, unknown> = {}
    for (const key of ['name', 'committee_type', 'description', 'is_public'] as const) {
      if (!(key in input)) continue
      const value = (input as Record<string, unknown>)[key]
      if (value === current[key]) continue
      assignments.push(`${key} = ?`)
      values.push(value)
      oldValues[key] = current[key]
      newValues[key] = value
    }
    if (assignments.length === 0) return

    values.push(committeeId)
    try {
      await conn.query(`UPDATE committees SET ${assignments.join(', ')} WHERE id = ?`, values)
    } catch (err) {
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
        throw new BadRequestError('A committee with this name already exists.')
      }
      throw err
    }
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'committee.update',
      entityType: 'committees',
      entityId: committeeId,
      oldValues,
      newValues,
    })
  })
}

export async function deleteCommittee(actorUserId: string, conferenceId: string, committeeId: string): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadCommitteeForUpdate(conn, conferenceId, committeeId)
    await conn.query('DELETE FROM committees WHERE id = ?', [committeeId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'committee.delete',
      entityType: 'committees',
      entityId: committeeId,
      oldValues: current,
    })
  })
}

export async function reorderCommittees(actorUserId: string, conferenceId: string, committeeIds: string[]): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query('SELECT id FROM committees WHERE conference_id = ?', [conferenceId])
    const existingIds = new Set((rows as Array<{ id: string }>).map((r) => r.id))
    for (const id of committeeIds) {
      if (!existingIds.has(id)) throw new NotFoundError('One of these committees does not exist.')
    }
    for (const [index, id] of committeeIds.entries()) {
      await conn.query('UPDATE committees SET display_order = ? WHERE id = ? AND conference_id = ?', [
        index,
        id,
        conferenceId,
      ])
    }
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'committee.reorder',
      entityType: 'committees',
      newValues: { committee_ids: committeeIds },
    })
  })
}

async function assertCommitteeInConference(conn: PoolConnection, conferenceId: string, committeeId: string): Promise<void> {
  const [rows] = await conn.query('SELECT 1 FROM committees WHERE id = ? AND conference_id = ? LIMIT 1', [
    committeeId,
    conferenceId,
  ])
  if ((rows as unknown[]).length === 0) throw new NotFoundError('This committee does not exist.')
}

export async function addCommitteeMember(
  actorUserId: string,
  conferenceId: string,
  committeeId: string,
  input: CreateCommitteeMemberInput,
): Promise<{ id: string }> {
  return withTransaction(actorUserId, async (conn) => {
    await assertCommitteeInConference(conn, conferenceId, committeeId)

    if (input.user_id) {
      const [userRows] = await conn.query('SELECT id FROM users WHERE id = ? LIMIT 1', [input.user_id])
      if ((userRows as unknown[]).length === 0) throw new BadRequestError('That user does not exist.')
    }

    const [orderRows] = await conn.query(
      'SELECT MAX(display_order) AS max_order FROM committee_members WHERE committee_id = ?',
      [committeeId],
    )
    const nextOrder = ((orderRows as Array<{ max_order: number | null }>)[0]?.max_order ?? -1) + 1

    try {
      await conn.query(
        `INSERT INTO committee_members (committee_id, user_id, display_name, affiliation, country, member_role, display_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          committeeId,
          input.user_id ?? null,
          input.display_name ?? null,
          input.affiliation ?? null,
          input.country ?? null,
          input.member_role,
          nextOrder,
        ],
      )
    } catch (err) {
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
        throw new BadRequestError('This person is already a member of this committee.')
      }
      throw err
    }
    const [rows] = await conn.query(
      'SELECT id FROM committee_members WHERE committee_id = ? AND display_order = ? LIMIT 1',
      [committeeId, nextOrder],
    )
    const id = (rows as Array<{ id: string }>)[0]?.id
    if (!id) throw new Error('Could not add the member.')

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'committee.add_member',
      entityType: 'committee_members',
      entityId: id,
      newValues: input,
    })
    return { id }
  })
}

async function loadMemberForUpdate(
  conn: PoolConnection,
  conferenceId: string,
  committeeId: string,
  memberId: string,
): Promise<{ id: string; display_name: string | null; affiliation: string | null; country: string | null; member_role: string }> {
  await assertCommitteeInConference(conn, conferenceId, committeeId)
  const [rows] = await conn.query(
    `SELECT id, display_name, affiliation, country, member_role FROM committee_members
     WHERE id = ? AND committee_id = ? LIMIT 1 FOR UPDATE`,
    [memberId, committeeId],
  )
  const row = (rows as Array<{ id: string; display_name: string | null; affiliation: string | null; country: string | null; member_role: string }>)[0]
  if (!row) throw new NotFoundError('This committee member does not exist.')
  return row
}

export async function updateCommitteeMember(
  actorUserId: string,
  conferenceId: string,
  committeeId: string,
  memberId: string,
  input: UpdateCommitteeMemberInput,
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadMemberForUpdate(conn, conferenceId, committeeId, memberId)

    const assignments: string[] = []
    const values: unknown[] = []
    const oldValues: Record<string, unknown> = {}
    const newValues: Record<string, unknown> = {}
    for (const key of ['display_name', 'affiliation', 'country', 'member_role'] as const) {
      if (!(key in input)) continue
      const value = (input as Record<string, unknown>)[key]
      if (value === current[key]) continue
      assignments.push(`${key} = ?`)
      values.push(value)
      oldValues[key] = current[key]
      newValues[key] = value
    }
    if (assignments.length === 0) return

    values.push(memberId)
    await conn.query(`UPDATE committee_members SET ${assignments.join(', ')} WHERE id = ?`, values)
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'committee.update_member',
      entityType: 'committee_members',
      entityId: memberId,
      oldValues,
      newValues,
    })
  })
}

export async function deleteCommitteeMember(
  actorUserId: string,
  conferenceId: string,
  committeeId: string,
  memberId: string,
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadMemberForUpdate(conn, conferenceId, committeeId, memberId)
    await conn.query('DELETE FROM committee_members WHERE id = ?', [memberId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'committee.remove_member',
      entityType: 'committee_members',
      entityId: memberId,
      oldValues: current,
    })
  })
}

export async function reorderCommitteeMembers(
  actorUserId: string,
  conferenceId: string,
  committeeId: string,
  memberIds: string[],
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    await assertCommitteeInConference(conn, conferenceId, committeeId)
    const [rows] = await conn.query('SELECT id FROM committee_members WHERE committee_id = ?', [committeeId])
    const existingIds = new Set((rows as Array<{ id: string }>).map((r) => r.id))
    for (const id of memberIds) {
      if (!existingIds.has(id)) throw new NotFoundError('One of these members does not exist.')
    }
    for (const [index, id] of memberIds.entries()) {
      await conn.query('UPDATE committee_members SET display_order = ? WHERE id = ? AND committee_id = ?', [
        index,
        id,
        committeeId,
      ])
    }
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'committee.reorder_members',
      entityType: 'committee_members',
      newValues: { committee_id: committeeId, member_ids: memberIds },
    })
  })
}

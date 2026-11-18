import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog } from '../../utils/audit.js'
import { BadRequestError, NotFoundError } from '../../utils/errors.js'
import type { AuditContext } from '../../utils/audit.js'
import { createInvitation } from '../invitations/service.js'
import type { ChangeRoleInput, InviteMemberInput, ListMembersQuery, SetMaxReviewLoadInput } from './validation.js'

export type MemberRow = {
  id: string
  user_id: string
  full_name: string
  email: string
  role_code: string
  status: 'active' | 'removed'
  max_review_load: number | null
  created_at: string
}

export async function listMembers(conferenceId: string, query: ListMembersQuery): Promise<MemberRow[]> {
  const conditions = ['cm.conference_id = ?']
  const params: unknown[] = [conferenceId]
  if (query.q) {
    conditions.push('(u.full_name LIKE ? ESCAPE \'\\\\\' OR u.email LIKE ? ESCAPE \'\\\\\')')
    const pattern = `%${query.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
    params.push(pattern, pattern)
  }
  if (query.role) {
    conditions.push('cm.role_code = ?')
    params.push(query.role)
  }

  const [rows] = await pool.query(
    `SELECT cm.id, cm.user_id, u.full_name, u.email, cm.role_code, cm.status, cm.max_review_load, cm.created_at
     FROM conference_members cm
     JOIN users u ON u.id = cm.user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY u.full_name`,
    params,
  )
  return rows as MemberRow[]
}

async function loadMembershipForUpdate(conn: PoolConnection, conferenceId: string, membershipId: string) {
  const [rows] = await conn.query(
    `SELECT id, user_id, role_code, status, max_review_load FROM conference_members
     WHERE id = ? AND conference_id = ? LIMIT 1 FOR UPDATE`,
    [membershipId, conferenceId],
  )
  const row = (rows as Array<{ id: string; user_id: string; role_code: string; status: string; max_review_load: number | null }>)[0]
  if (!row) throw new NotFoundError('This member does not exist.')
  return row
}

export async function changeMemberRole(
  actorUserId: string,
  conferenceId: string,
  membershipId: string,
  input: ChangeRoleInput,
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadMembershipForUpdate(conn, conferenceId, membershipId)
    if (current.role_code === 'convenor') {
      throw new BadRequestError('The convenor role can only be changed by a platform administrator.')
    }
    // An author's role must not be overwritten: the person would lose access to their
    // submissions and could no longer sign in as Author. To give an author an extra role,
    // use "Invite member" (it adds a role without replacing the existing one).
    if (current.role_code === 'author') {
      throw new BadRequestError(
        "An author's role can't be changed here because the person would lose access to their submissions. Use Invite member to give them an additional role instead.",
      )
    }
    // Audience membership comes from the person's own registration; replacing it would take
    // away their ticket features. Give them a second role with "Invite member" instead.
    if (current.role_code === 'attendee') {
      throw new BadRequestError(
        "An Audience member's role can't be changed here because it comes from their registration. Use Invite member to give them an additional role instead.",
      )
    }
    if (current.role_code === input.role_code) return

    const [dupRows] = await conn.query(
      `SELECT 1 FROM conference_members WHERE conference_id = ? AND user_id = ? AND role_code = ? LIMIT 1`,
      [conferenceId, current.user_id, input.role_code],
    )
    if ((dupRows as unknown[]).length > 0) {
      throw new BadRequestError('This person already has that role in this conference.')
    }

    await conn.query('UPDATE conference_members SET role_code = ? WHERE id = ?', [input.role_code, membershipId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'member.change_role',
      entityType: 'conference_members',
      entityId: membershipId,
      oldValues: { role_code: current.role_code },
      newValues: { role_code: input.role_code },
    })
  })
}

export async function removeMember(actorUserId: string, conferenceId: string, membershipId: string): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadMembershipForUpdate(conn, conferenceId, membershipId)
    if (current.role_code === 'convenor') {
      throw new BadRequestError('The convenor cannot be removed here — ask a platform administrator.')
    }
    if (current.user_id === actorUserId) {
      throw new BadRequestError('You cannot remove yourself.')
    }
    if (current.status === 'removed') return

    await conn.query(`UPDATE conference_members SET status = 'removed' WHERE id = ?`, [membershipId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'member.remove',
      entityType: 'conference_members',
      entityId: membershipId,
      oldValues: { status: current.status },
      newValues: { status: 'removed' },
    })
  })
}

export async function setMemberMaxReviewLoad(
  actorUserId: string,
  conferenceId: string,
  membershipId: string,
  input: SetMaxReviewLoadInput,
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadMembershipForUpdate(conn, conferenceId, membershipId)
    if (current.max_review_load === input.max_review_load) return

    await conn.query('UPDATE conference_members SET max_review_load = ? WHERE id = ?', [
      input.max_review_load,
      membershipId,
    ])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'member.set_max_review_load',
      entityType: 'conference_members',
      entityId: membershipId,
      oldValues: { max_review_load: current.max_review_load },
      newValues: { max_review_load: input.max_review_load },
    })
  })
}

/**
 * "Invite member": creates a PENDING invitation and always emails it (new and existing
 * accounts alike). It used to create an active membership straight away - so the person could
 * sign in without ever accepting - and an existing account got no email at all, only an
 * in-app notification. See modules/invitations/service.ts.
 */
export async function inviteMember(actorUserId: string, conferenceId: string, input: InviteMemberInput, ctx: AuditContext = {}) {
  return createInvitation(actorUserId, conferenceId, input, ctx)
}

export async function listReviewerTracks(conferenceId: string, userId: string): Promise<string[]> {
  const [rows] = await pool.query('SELECT track_id FROM reviewer_tracks WHERE conference_id = ? AND user_id = ?', [
    conferenceId,
    userId,
  ])
  return (rows as Array<{ track_id: string }>).map((r) => r.track_id)
}

export async function setReviewerTracks(
  actorUserId: string,
  conferenceId: string,
  userId: string,
  trackIds: string[],
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    if (trackIds.length > 0) {
      const [rows] = await conn.query('SELECT id FROM conference_tracks WHERE conference_id = ? AND id IN (?)', [
        conferenceId,
        trackIds,
      ])
      const validIds = new Set((rows as Array<{ id: string }>).map((r) => r.id))
      for (const id of trackIds) {
        if (!validIds.has(id)) throw new BadRequestError('One of these tracks does not belong to this conference.')
      }
    }

    await conn.query('DELETE FROM reviewer_tracks WHERE conference_id = ? AND user_id = ?', [conferenceId, userId])
    for (const trackId of trackIds) {
      await conn.query('INSERT INTO reviewer_tracks (conference_id, user_id, track_id) VALUES (?, ?, ?)', [
        conferenceId,
        userId,
        trackId,
      ])
    }

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'member.set_reviewer_tracks',
      entityType: 'reviewer_tracks',
      entityId: userId,
      newValues: { track_ids: trackIds },
    })
  })
}
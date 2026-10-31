import { getUserProfile, updateProfile } from '../auth/service.js'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog } from '../../utils/audit.js'
import { NotFoundError } from '../../utils/errors.js'
import { getSessionConferenceId } from '../../middleware/sessionScope.js'
import type { UpdateProfileInput } from '../auth/validation.js'
import type { UpdateMyProfileInput } from './validation.js'

/**
 * auth/validation.ts's UpdateProfileInput infers several fields as required
 * `string | null` (not optional) — a side effect of how its zod schema is
 * built (transform-after-optional; see the ordering note in this module's
 * validation.ts). `updateProfile()` itself only ever reads keys that are
 * actually present (skipping `undefined`), so passing a narrower object is
 * safe at runtime even though the two types don't line up structurally.
 */
function asUpdateProfileInput(partial: object): UpdateProfileInput {
  return partial as unknown as UpdateProfileInput
}

export { getUserProfile as getMyProfile }

const PROFILE_FIELDS = ['full_name', 'phone', 'institution', 'department', 'position', 'country', 'orcid', 'bio'] as const

export async function updateMyProfile(userId: string, input: UpdateMyProfileInput): Promise<void> {
  const current = (await getUserProfile(userId)) as Record<string, unknown> | null
  if (!current) return

  const oldValues: Record<string, unknown> = {}
  const newValues: Record<string, unknown> = {}
  for (const key of PROFILE_FIELDS) {
    if (!(key in input)) continue
    const value = (input as Record<string, unknown>)[key]
    if (value === current[key]) continue
    oldValues[key] = current[key]
    newValues[key] = value
  }

  await updateProfile(userId, asUpdateProfileInput(input))

  if (Object.keys(newValues).length === 0) return
  await withTransaction(userId, async (conn) => {
    await insertAuditLog(conn, {
      actorUserId: userId,
      action: 'profile.update',
      entityType: 'users',
      entityId: userId,
      oldValues,
      newValues,
    })
  })
}

async function setMyPhotoPath(userId: string, newPath: string | null): Promise<string | null> {
  const current = (await getUserProfile(userId)) as { photo_path: string | null } | null
  const previousPath = current?.photo_path ?? null

  await updateProfile(userId, asUpdateProfileInput({ photo_path: newPath }))

  await withTransaction(userId, async (conn) => {
    await insertAuditLog(conn, {
      actorUserId: userId,
      action: 'profile.photo_path',
      entityType: 'users',
      entityId: userId,
      oldValues: { photo_path: previousPath },
      newValues: { photo_path: newPath },
    })
  })

  return previousPath
}

export async function setMyPhoto(userId: string, path: string): Promise<string | null> {
  return setMyPhotoPath(userId, path)
}

export async function removeMyPhoto(userId: string): Promise<string | null> {
  return setMyPhotoPath(userId, null)
}

export type NotificationRow = {
  id: string
  conference_id: string | null
  type: string
  title: string
  body: string | null
  link_path: string | null
  read_at: string | null
  created_at: string
}

/**
 * Notifications visible to a session: its own conference's, plus ones tied
 * to no conference at all (account-level). A conference-bound session never
 * sees another conference's notifications. Unbound (admin) sessions see all.
 */
function notificationScope(): { clause: string; params: unknown[] } {
  const bound = getSessionConferenceId()
  if (!bound) return { clause: '', params: [] }
  return { clause: 'AND (conference_id IS NULL OR conference_id = ?)', params: [bound] }
}

export async function listMyNotifications(userId: string, unreadOnly: boolean): Promise<NotificationRow[]> {
  const unreadClause = unreadOnly ? 'AND read_at IS NULL' : ''
  const scope = notificationScope()
  const [rows] = await pool.query(
    `SELECT id, conference_id, type, title, body, link_path, read_at, created_at
     FROM notifications WHERE user_id = ? ${unreadClause} ${scope.clause}
     ORDER BY created_at DESC LIMIT 50`,
    [userId, ...scope.params],
  )
  return rows as NotificationRow[]
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<void> {
  const scope = notificationScope()
  const [result] = await pool.query(
    `UPDATE notifications SET read_at = NOW(3) WHERE id = ? AND user_id = ? AND read_at IS NULL ${scope.clause}`,
    [notificationId, userId, ...scope.params],
  )
  if ((result as { affectedRows: number }).affectedRows === 0) {
    const [existsRows] = await pool.query(`SELECT 1 FROM notifications WHERE id = ? AND user_id = ? ${scope.clause} LIMIT 1`, [
      notificationId,
      userId,
      ...scope.params,
    ])
    if ((existsRows as unknown[]).length === 0) {
      throw new NotFoundError('This notification does not exist.')
    }
    // Otherwise it exists but was already read — treat that as success, not an error.
  }
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const scope = notificationScope()
  await pool.query(`UPDATE notifications SET read_at = NOW(3) WHERE user_id = ? AND read_at IS NULL ${scope.clause}`, [
    userId,
    ...scope.params,
  ])
}

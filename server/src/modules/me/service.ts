import { getUserProfile, updateProfile } from '../auth/service.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog } from '../../utils/audit.js'
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

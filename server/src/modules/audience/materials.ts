import { fileTypeFromBuffer } from 'file-type'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { assertConferenceInSession } from '../../middleware/sessionScope.js'
import { deletePrivateFile, savePrivateFile } from '../../storage/privateFileStore.js'
import { insertAuditLog, type AuditContext } from '../../utils/audit.js'
import { BadRequestError, NotFoundError } from '../../utils/errors.js'
import { isAuthorOfSubmission, loadSubmissionCore } from '../submissions/service.js'
import { assertConfirmedRegistration, plainText } from './access.js'

export const MATERIAL_MAX_BYTES = 25 * 1024 * 1024

/** What the convenor may upload as conference material. Checked from the file's bytes, never its name. */
const MATERIAL_TYPES: Record<string, { ext: string; mime: string }> = {
  'application/pdf': { ext: 'pdf', mime: 'application/pdf' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    ext: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    ext: 'pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  'image/png': { ext: 'png', mime: 'image/png' },
  'image/jpeg': { ext: 'jpg', mime: 'image/jpeg' },
}

/** Papers whose consented slides / final paper the Audience may download. */
export const MATERIAL_PAPER_STATUSES = ['final_approved', 'scheduled', 'presented'] as const

const title = z
  .string()
  .transform((v) => plainText(v))
  .pipe(z.string().min(2, 'Give the file a title (at least 2 characters).').max(200, 'Keep the title to 200 characters or fewer.'))
const description = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v == null ? null : plainText(v) || null))
  .pipe(z.string().max(1000, 'Keep the description to 1000 characters or fewer.').nullable())

export const createMaterialSchema = z.object({ title, description })
export const updateMaterialSchema = z.object({
  title: title.optional(),
  description,
  is_visible: z.boolean().optional(),
  display_order: z.coerce.number().int().min(0).max(1000).optional(),
})
export const consentSchema = z.object({ slides_allowed: z.boolean(), paper_allowed: z.boolean() })

function safeFilename(original: string, ext: string): string {
  const base = original.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 120) || 'file'
  return `${base}.${ext}`
}

// ------------------------------------------------------------------ Convenor: conference materials

export type MaterialRow = {
  id: string
  title: string
  description: string | null
  original_filename: string
  mime_type: string
  size_bytes: number
  is_visible: boolean
  display_order: number
  created_at: string
}

export async function listMaterials(conferenceId: string): Promise<MaterialRow[]> {
  const [rows] = await pool.query(
    `SELECT id, title, description, original_filename, mime_type, size_bytes, is_visible, display_order, created_at
     FROM conference_materials WHERE conference_id = ? ORDER BY display_order, created_at`,
    [conferenceId],
  )
  return (rows as MaterialRow[]).map((r) => ({ ...r, is_visible: Boolean(r.is_visible), size_bytes: Number(r.size_bytes) }))
}

export async function createMaterial(
  actorUserId: string,
  conferenceId: string,
  input: z.infer<typeof createMaterialSchema>,
  file: { buffer: Buffer; originalname: string; size: number } | undefined,
  ctx: AuditContext = {},
): Promise<{ id: string }> {
  if (!file || file.size === 0) throw new BadRequestError('Choose a file to upload.', { file: 'Choose a file to upload.' })
  if (file.size > MATERIAL_MAX_BYTES) throw new BadRequestError('The file must be 25 MB or smaller.', { file: 'The file must be 25 MB or smaller.' })
  const sniffed = await fileTypeFromBuffer(file.buffer)
  const type = sniffed ? MATERIAL_TYPES[sniffed.mime] : undefined
  if (!type) throw new BadRequestError('Upload a PDF, Word, PowerPoint, PNG or JPG file.', { file: 'Upload a PDF, Word, PowerPoint, PNG or JPG file.' })

  const storagePath = `conferences/${conferenceId}/materials/material-${crypto.randomUUID()}.${type.ext}`
  await savePrivateFile(storagePath, file.buffer)
  try {
    return await withTransaction(actorUserId, async (conn) => {
      const [orderRows] = await conn.query('SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM conference_materials WHERE conference_id = ?', [
        conferenceId,
      ])
      const [idRows] = await conn.query('SELECT UUID() AS id')
      const id = (idRows as Array<{ id: string }>)[0]!.id
      await conn.query(
        `INSERT INTO conference_materials (id, conference_id, title, description, storage_path, original_filename, mime_type, size_bytes, display_order, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          conferenceId,
          input.title,
          input.description,
          storagePath,
          safeFilename(file.originalname, type.ext),
          type.mime,
          file.size,
          Number((orderRows as Array<{ next: number }>)[0]!.next),
          actorUserId,
        ],
      )
      await insertAuditLog(conn, {
        actorUserId,
        conferenceId,
        action: 'material.create',
        entityType: 'conference_materials',
        entityId: id,
        newValues: { title: input.title, size_bytes: file.size, mime_type: type.mime },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      })
      return { id }
    })
  } catch (err) {
    await deletePrivateFile(storagePath)
    throw err
  }
}

export async function updateMaterial(
  actorUserId: string,
  conferenceId: string,
  materialId: string,
  input: z.infer<typeof updateMaterialSchema>,
  ctx: AuditContext = {},
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query(
      `SELECT title, description, is_visible, display_order FROM conference_materials WHERE id = ? AND conference_id = ? FOR UPDATE`,
      [materialId, conferenceId],
    )
    const current = (rows as Array<Record<string, unknown>>)[0]
    if (!current) throw new NotFoundError('This file does not exist.')
    const changes: Record<string, unknown> = {}
    for (const key of ['title', 'description', 'is_visible', 'display_order'] as const) {
      if (input[key] !== undefined) changes[key] = input[key]
    }
    if (Object.keys(changes).length === 0) return
    await conn.query(`UPDATE conference_materials SET ${Object.keys(changes).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [
      ...Object.values(changes),
      materialId,
    ])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'material.update',
      entityType: 'conference_materials',
      entityId: materialId,
      oldValues: current,
      newValues: changes,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}

export async function deleteMaterial(actorUserId: string, conferenceId: string, materialId: string, ctx: AuditContext = {}): Promise<void> {
  const path = await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query(`SELECT title, storage_path FROM conference_materials WHERE id = ? AND conference_id = ? FOR UPDATE`, [
      materialId,
      conferenceId,
    ])
    const current = (rows as Array<{ title: string; storage_path: string }>)[0]
    if (!current) throw new NotFoundError('This file does not exist.')
    await conn.query('DELETE FROM conference_materials WHERE id = ?', [materialId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'material.delete',
      entityType: 'conference_materials',
      entityId: materialId,
      oldValues: { title: current.title },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
    return current.storage_path
  })
  await deletePrivateFile(path)
}

/** Organiser download (any material, visible or not). */
export async function getMaterialFileForOrganiser(conferenceId: string, materialId: string) {
  const [rows] = await pool.query(
    `SELECT storage_path, original_filename, mime_type FROM conference_materials WHERE id = ? AND conference_id = ? LIMIT 1`,
    [materialId, conferenceId],
  )
  const row = (rows as Array<{ storage_path: string; original_filename: string; mime_type: string }>)[0]
  if (!row) throw new NotFoundError('This file does not exist.')
  return row
}

// ------------------------------------------------------------------ Author consent

/** An author of the paper (creator or a linked co-author) says whether the Audience may download it. */
export async function setAudienceConsent(
  userId: string,
  conferenceId: string,
  submissionId: string,
  input: z.infer<typeof consentSchema>,
  ctx: AuditContext = {},
): Promise<void> {
  const submission = await loadSubmissionCore(submissionId)
  if (submission.conference_id !== conferenceId || !(await isAuthorOfSubmission(submissionId, userId, submission.created_by))) {
    throw new NotFoundError('This submission does not exist.')
  }
  await withTransaction(userId, async (conn) => {
    const [rows] = await conn.query('SELECT audience_slides_allowed, audience_paper_allowed FROM submissions WHERE id = ? FOR UPDATE', [submissionId])
    const current = (rows as Array<{ audience_slides_allowed: number; audience_paper_allowed: number }>)[0]!
    await conn.query('UPDATE submissions SET audience_slides_allowed = ?, audience_paper_allowed = ? WHERE id = ?', [
      input.slides_allowed,
      input.paper_allowed,
      submissionId,
    ])
    await insertAuditLog(conn, {
      actorUserId: userId,
      conferenceId,
      action: 'submission.audience_consent',
      entityType: 'submissions',
      entityId: submissionId,
      oldValues: { slides_allowed: Boolean(current.audience_slides_allowed), paper_allowed: Boolean(current.audience_paper_allowed) },
      newValues: input,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}

export async function getAudienceConsent(userId: string, conferenceId: string, submissionId: string) {
  const submission = await loadSubmissionCore(submissionId)
  if (submission.conference_id !== conferenceId || !(await isAuthorOfSubmission(submissionId, userId, submission.created_by))) {
    throw new NotFoundError('This submission does not exist.')
  }
  const [rows] = await pool.query('SELECT audience_slides_allowed, audience_paper_allowed FROM submissions WHERE id = ?', [submissionId])
  const r = (rows as Array<{ audience_slides_allowed: number; audience_paper_allowed: number }>)[0]!
  return { slides_allowed: Boolean(r.audience_slides_allowed), paper_allowed: Boolean(r.audience_paper_allowed) }
}

// ------------------------------------------------------------------ Audience: list + download

export type AudienceMaterial = {
  kind: 'material' | 'slides' | 'paper'
  id: string
  title: string
  description: string | null
  authors: string[]
  filename: string
  mime_type: string
  size_bytes: number
}

type PaperFile = {
  submission_id: string
  title: string
  file_kind: 'slides' | 'camera_ready' | 'full_paper'
  storage_path: string
  original_filename: string
  mime_type: string
  size_bytes: number
}

/**
 * Consented paper files: slides (latest active version) when the author allowed slides; the
 * final paper (camera-ready, else the final full paper) when they allowed the paper. Only for
 * final_approved / scheduled / presented papers.
 */
async function consentedPaperFiles(conferenceId: string, submissionId?: string): Promise<PaperFile[]> {
  const [rows] = await pool.query(
    `SELECT s.id AS submission_id, s.title, f.file_kind, f.storage_path, f.original_filename, f.mime_type, f.size_bytes, f.version, f.is_final
     FROM submissions s
     JOIN submission_files f ON f.submission_id = s.id AND f.status = 'active'
     WHERE s.conference_id = ? AND s.deleted_at IS NULL AND s.status IN (?)
       ${submissionId ? 'AND s.id = ?' : ''}
       AND (
         (f.file_kind = 'slides' AND s.audience_slides_allowed = TRUE)
         OR (f.file_kind IN ('camera_ready', 'full_paper') AND f.is_final = TRUE AND s.audience_paper_allowed = TRUE)
       )
     ORDER BY s.title, f.file_kind, f.version DESC`,
    submissionId ? [conferenceId, MATERIAL_PAPER_STATUSES, submissionId] : [conferenceId, MATERIAL_PAPER_STATUSES],
  )
  const bySubmission = new Map<string, { slides?: PaperFile; camera_ready?: PaperFile; full_paper?: PaperFile }>()
  for (const r of rows as PaperFile[]) {
    const entry = bySubmission.get(r.submission_id) ?? {}
    if (!entry[r.file_kind]) entry[r.file_kind] = { ...r, size_bytes: Number(r.size_bytes) }
    bySubmission.set(r.submission_id, entry)
  }
  const out: PaperFile[] = []
  for (const entry of bySubmission.values()) {
    if (entry.slides) out.push(entry.slides)
    const paper = entry.camera_ready ?? entry.full_paper
    if (paper) out.push(paper)
  }
  return out
}

export async function listAudienceMaterials(conferenceId: string): Promise<AudienceMaterial[]> {
  const [materialRows] = await pool.query(
    `SELECT id, title, description, original_filename, mime_type, size_bytes FROM conference_materials
     WHERE conference_id = ? AND is_visible = TRUE ORDER BY display_order, created_at`,
    [conferenceId],
  )
  const files = await consentedPaperFiles(conferenceId)
  const ids = [...new Set(files.map((f) => f.submission_id))]
  const authors = new Map<string, string[]>()
  if (ids.length > 0) {
    const [authorRows] = await pool.query(
      `SELECT submission_id, full_name FROM submission_authors WHERE submission_id IN (?) ORDER BY submission_id, author_order`,
      [ids],
    )
    for (const a of authorRows as Array<{ submission_id: string; full_name: string }>) {
      authors.set(a.submission_id, [...(authors.get(a.submission_id) ?? []), a.full_name])
    }
  }
  return [
    ...(materialRows as Array<{ id: string; title: string; description: string | null; original_filename: string; mime_type: string; size_bytes: number }>).map(
      (m) => ({
        kind: 'material' as const,
        id: m.id,
        title: m.title,
        description: m.description,
        authors: [],
        filename: m.original_filename,
        mime_type: m.mime_type,
        size_bytes: Number(m.size_bytes),
      }),
    ),
    ...files.map((f) => ({
      kind: f.file_kind === 'slides' ? ('slides' as const) : ('paper' as const),
      id: f.submission_id,
      title: f.title,
      description: null,
      authors: authors.get(f.submission_id) ?? [],
      filename: f.original_filename,
      mime_type: f.mime_type,
      size_bytes: f.size_bytes,
    })),
  ]
}

/** Resolves what an Audience member may download - re-checking registration, visibility, status and consent on every request. */
export async function getAudienceDownload(
  conferenceId: string,
  userId: string,
  kind: 'material' | 'slides' | 'paper',
  id: string,
): Promise<{ storage_path: string; filename: string; mime_type: string }> {
  assertConferenceInSession(conferenceId)
  await assertConfirmedRegistration(conferenceId, userId)
  if (kind === 'material') {
    const [rows] = await pool.query(
      `SELECT storage_path, original_filename, mime_type FROM conference_materials WHERE id = ? AND conference_id = ? AND is_visible = TRUE LIMIT 1`,
      [id, conferenceId],
    )
    const row = (rows as Array<{ storage_path: string; original_filename: string; mime_type: string }>)[0]
    if (!row) throw new NotFoundError('This file does not exist.')
    return { storage_path: row.storage_path, filename: row.original_filename, mime_type: row.mime_type }
  }
  const files = await consentedPaperFiles(conferenceId, id)
  const file = files.find((f) => (kind === 'slides' ? f.file_kind === 'slides' : f.file_kind !== 'slides'))
  if (!file) throw new NotFoundError('This file is not available to download.')
  return { storage_path: file.storage_path, filename: file.original_filename, mime_type: file.mime_type }
}

export function assertMaterialKind(value: string | undefined): 'material' | 'slides' | 'paper' {
  if (value === 'material' || value === 'slides' || value === 'paper') return value
  throw new NotFoundError('This file does not exist.')
}

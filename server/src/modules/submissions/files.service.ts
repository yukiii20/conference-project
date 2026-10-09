import { createHash } from 'node:crypto'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { assertConferencePermission } from '../../middleware/auth.js'
import { buildPrivatePath, privateFileAbsolutePath, savePrivateFile } from '../../storage/privateFileStore.js'
import { insertAuditLog } from '../../utils/audit.js'
import { BadRequestError, ForbiddenError, NotFoundError } from '../../utils/errors.js'
import { MIME_FOR_EXT, resolveAndValidateExtension } from './fileRules.js'
import {
  ABSTRACT_UPLOAD_STATUSES,
  FULL_PAPER_UPLOAD_STATUSES,
  getConferenceSettings,
  isAuthorOfSubmission,
  isWindowOpen,
  loadDeadlineWindow,
  loadSubmissionCore,
} from './service.js'
import type { FileKind } from './validation.js'

function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'file'
  return base.replace(/[^A-Za-z0-9 ._-]/g, '_').slice(0, 200) || 'file'
}

function statusAllowsUpload(kind: FileKind, status: string, fullPaperOpen: boolean, finalPaperOpen: boolean): boolean {
  switch (kind) {
    case 'abstract':
    case 'supplementary':
      return ABSTRACT_UPLOAD_STATUSES.has(status)
    case 'full_paper':
    case 'slides':
      return FULL_PAPER_UPLOAD_STATUSES.has(status) && fullPaperOpen
    case 'camera_ready':
      return status === 'final_approved' && finalPaperOpen
    default:
      return false
  }
}

export type UploadedFileMeta = {
  id: string
  file_kind: string
  version: number
  status: string
  original_filename: string
  mime_type: string
  size_bytes: number
  uploaded_at: string
}

export async function uploadSubmissionFile(
  userId: string,
  submissionId: string,
  kind: FileKind,
  file: { buffer: Buffer; originalname: string },
): Promise<UploadedFileMeta> {
  const sub = await loadSubmissionCore(submissionId)
  if (!(await isAuthorOfSubmission(submissionId, userId, sub.created_by))) {
    throw new NotFoundError('This submission does not exist.')
  }

  const [fullPaperWindow, finalPaperWindow] = await Promise.all([
    loadDeadlineWindow(sub.conference_id, 'full_paper'),
    loadDeadlineWindow(sub.conference_id, 'final_paper'),
  ])
  if (!statusAllowsUpload(kind, sub.status, isWindowOpen(fullPaperWindow), isWindowOpen(finalPaperWindow))) {
    throw new BadRequestError('You cannot upload this kind of file right now.')
  }

  const settings = await getConferenceSettings(sub.conference_id)
  const maxBytes = settings.max_file_size_mb * 1024 * 1024
  if (file.buffer.length > maxBytes) {
    throw new BadRequestError(`File must be ${settings.max_file_size_mb} MB or smaller.`)
  }
  if (file.buffer.length === 0) {
    throw new BadRequestError('The uploaded file is empty.')
  }

  const ext = await resolveAndValidateExtension(file.buffer, kind)
  const mime = MIME_FOR_EXT[ext]!
  const checksum = createHash('sha256').update(file.buffer).digest('hex')
  const originalFilename = sanitizeFilename(file.originalname)

  return withTransaction(userId, async (conn) => {
    const [versionRows] = await conn.query(
      `SELECT MAX(version) AS max_version FROM submission_files WHERE submission_id = ? AND file_kind = ? FOR UPDATE`,
      [submissionId, kind],
    )
    const version = ((versionRows as Array<{ max_version: number | null }>)[0]?.max_version ?? 0) + 1

    await conn.query(
      `UPDATE submission_files SET status = 'superseded' WHERE submission_id = ? AND file_kind = ? AND status = 'active'`,
      [submissionId, kind],
    )

    const relativePath = buildPrivatePath(`submissions/${sub.conference_id}/${submissionId}`, kind, version, ext)
    await savePrivateFile(relativePath, file.buffer)

    await conn.query(
      `INSERT INTO submission_files
         (submission_id, file_kind, version, storage_path, original_filename, mime_type, size_bytes, checksum_sha256, status, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      [submissionId, kind, version, relativePath, originalFilename, mime, file.buffer.length, checksum, userId],
    )
    const [idRows] = await conn.query(
      `SELECT id, uploaded_at FROM submission_files WHERE submission_id = ? AND file_kind = ? AND version = ? LIMIT 1`,
      [submissionId, kind, version],
    )
    const row = (idRows as Array<{ id: string; uploaded_at: string }>)[0]!

    if (kind === 'full_paper' && (sub.status === 'accepted' || sub.status === 'full_paper_pending')) {
      await conn.query(`UPDATE submissions SET status = 'full_paper_submitted' WHERE id = ?`, [submissionId])
    }

    await insertAuditLog(conn, {
      actorUserId: userId,
      conferenceId: sub.conference_id,
      action: 'submission.file.upload',
      entityType: 'submission_files',
      entityId: row.id,
      newValues: { file_kind: kind, version, original_filename: originalFilename, size_bytes: file.buffer.length },
    })

    return {
      id: row.id,
      file_kind: kind,
      version,
      status: 'active',
      original_filename: originalFilename,
      mime_type: mime,
      size_bytes: file.buffer.length,
      uploaded_at: row.uploaded_at,
    }
  })
}

export async function getDownloadableFile(
  userId: string,
  submissionId: string,
  fileId: string,
): Promise<{ absolutePath: string; filename: string; mime: string }> {
  const sub = await loadSubmissionCore(submissionId)

  const [fileRows] = await pool.query(
    `SELECT storage_path, original_filename, mime_type FROM submission_files WHERE id = ? AND submission_id = ? LIMIT 1`,
    [fileId, submissionId],
  )
  const file = (fileRows as Array<{ storage_path: string; original_filename: string; mime_type: string }>)[0]
  if (!file) throw new NotFoundError('This file does not exist.')

  const isAuthor = await isAuthorOfSubmission(submissionId, userId, sub.created_by)
  if (!isAuthor) {
    let hasReadAll = false
    try {
      await assertConferencePermission(userId, sub.conference_id, 'submission.read_all')
      hasReadAll = true
    } catch {
      hasReadAll = false
    }
    if (!hasReadAll) {
      const [assignRows] = await pool.query(
        `SELECT 1 FROM review_assignments
         WHERE submission_id = ? AND reviewer_id = ? AND status IN ('assigned', 'in_progress', 'completed') LIMIT 1`,
        [submissionId, userId],
      )
      if ((assignRows as unknown[]).length === 0) {
        throw new ForbiddenError('You do not have permission to download this file.')
      }
    }
  }

  return {
    absolutePath: privateFileAbsolutePath(file.storage_path),
    filename: file.original_filename,
    mime: file.mime_type,
  }
}

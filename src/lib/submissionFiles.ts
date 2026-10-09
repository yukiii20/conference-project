import { api, ApiError } from './api'

export type FileKind = 'abstract' | 'full_paper' | 'camera_ready' | 'supplementary' | 'slides'

const DOC_EXTENSIONS = ['pdf', 'doc', 'docx']
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']
const SLIDE_EXTENSIONS = ['pdf', 'ppt', 'pptx']

/**
 * Per-kind upload rules, matching server/src/modules/submissions/fileRules.ts.
 * abstract/supplementary additionally accept images (e.g. a photographed or
 * scanned abstract); full_paper/camera_ready stay document-only; slides stay
 * presentation-only. The server re-checks the real file type from magic
 * bytes regardless of what's picked here.
 */
export const SUBMISSION_FILE_RULES: Record<FileKind, { extensions: string[]; accept: string; helpText: string }> = {
  abstract: {
    extensions: [...DOC_EXTENSIONS, ...IMAGE_EXTENSIONS],
    accept: 'application/pdf,.doc,.docx,image/png,image/jpeg,image/webp',
    helpText: 'PDF, Word, or an image (PNG/JPG/WEBP).',
  },
  supplementary: {
    extensions: [...DOC_EXTENSIONS, ...IMAGE_EXTENSIONS],
    accept: 'application/pdf,.doc,.docx,image/png,image/jpeg,image/webp',
    helpText: 'PDF, Word, or an image (PNG/JPG/WEBP).',
  },
  full_paper: {
    extensions: DOC_EXTENSIONS,
    accept: 'application/pdf,.doc,.docx',
    helpText: 'PDF or Word document.',
  },
  camera_ready: {
    extensions: DOC_EXTENSIONS,
    accept: 'application/pdf,.doc,.docx',
    helpText: 'PDF or Word document.',
  },
  slides: {
    extensions: SLIDE_EXTENSIONS,
    accept: 'application/pdf,.ppt,.pptx',
    helpText: 'PDF or PowerPoint.',
  },
}

/** Client-side pre-check mirroring the server's per-kind rule. Returns an error message, or null if OK. */
export function validateSubmissionFile(fileKind: FileKind, file: File): string | null {
  const rule = SUBMISSION_FILE_RULES[fileKind]
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!rule.extensions.includes(ext)) {
    return `That file type isn't allowed here. Use: ${rule.extensions.join(', ').toUpperCase()}.`
  }
  return null
}

export type UploadedSubmissionFile = {
  id: string
  file_kind: string
  version: number
  status: string
  original_filename: string
  mime_type: string
  size_bytes: number
  uploaded_at: string
}

/** Uploads a file for a submission. Returns an error message on failure, or null on success. */
export async function uploadSubmissionFile(
  submissionId: string,
  fileKind: FileKind,
  file: File,
): Promise<string | null> {
  try {
    const formData = new FormData()
    formData.append('file', file)
    await api.upload<UploadedSubmissionFile>(`/submissions/${submissionId}/files/${fileKind}`, formData)
    return null
  } catch (err) {
    return err instanceof ApiError ? err.message : 'Upload failed. Please try again.'
  }
}

/** The URL that streams a private submission file — the browser sends the session cookie automatically. */
export function submissionFileDownloadUrl(submissionId: string, fileId: string): string {
  return `/api/submissions/${submissionId}/files/${fileId}/download`
}

/** Triggers a browser download of a private submission file without navigating away. */
export function downloadSubmissionFile(submissionId: string, fileId: string): void {
  const a = document.createElement('a')
  a.href = submissionFileDownloadUrl(submissionId, fileId)
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

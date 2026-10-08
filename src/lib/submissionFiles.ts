import { supabase } from './supabase'

export type FileKind = 'abstract' | 'full_paper' | 'camera_ready' | 'supplementary' | 'slides'

const DOC_EXTENSIONS = ['pdf', 'doc', 'docx']
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']
const SLIDE_EXTENSIONS = ['pdf', 'ppt', 'pptx']

/**
 * Per-kind upload rules, matching the submission-upload Edge Function and
 * the "submissions" storage bucket. abstract/supplementary additionally
 * accept images (e.g. a photographed or scanned abstract); full_paper/
 * camera_ready stay document-only; slides stay presentation-only.
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

/** Client-side pre-check mirroring the Edge Function's per-kind rule. Returns an error message, or null if OK. */
export function validateSubmissionFile(fileKind: FileKind, file: File): string | null {
  const rule = SUBMISSION_FILE_RULES[fileKind]
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!rule.extensions.includes(ext)) {
    return `That file type isn't allowed here. Use: ${rule.extensions.join(', ').toUpperCase()}.`
  }
  return null
}

async function readFunctionError(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: Response }).context
  if (context) {
    try {
      const body = await context.json()
      if (body && typeof body.error === 'string') return body.error
    } catch {
      // fall through to fallback
    }
  }
  return (error as { message?: string }).message ?? fallback
}

/**
 * Uploads a file for a submission via the submission-upload edge function
 * (start -> direct upload to the signed URL -> finish). Returns an error
 * message on failure, or null on success.
 */
export async function uploadSubmissionFile(
  submissionId: string,
  fileKind: FileKind,
  file: File,
): Promise<string | null> {
  const { data: startData, error: startError } = await supabase.functions.invoke('submission-upload', {
    body: {
      action: 'start',
      submission_id: submissionId,
      file_kind: fileKind,
      filename: file.name,
      size: file.size,
      mime: file.type,
    },
  })

  if (startError) {
    return await readFunctionError(startError, 'Could not start the upload.')
  }

  const { path, token } = startData as { path: string; token: string }

  const { error: uploadError } = await supabase.storage.from('submissions').uploadToSignedUrl(path, token, file)
  if (uploadError) {
    return uploadError.message
  }

  const { error: finishError } = await supabase.functions.invoke('submission-upload', {
    body: {
      action: 'finish',
      submission_id: submissionId,
      file_kind: fileKind,
      path,
      filename: file.name,
    },
  })

  if (finishError) {
    return await readFunctionError(finishError, 'Could not finish the upload.')
  }

  return null
}

/** Signed, short-lived download URL for a private submission file. */
export async function getSubmissionFileUrl(path: string, expiresInSeconds = 300): Promise<string | null> {
  const { data, error } = await supabase.storage.from('submissions').createSignedUrl(path, expiresInSeconds)
  if (error || !data) return null
  return data.signedUrl
}

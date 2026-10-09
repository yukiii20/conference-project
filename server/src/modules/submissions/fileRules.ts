import { fileTypeFromBuffer } from 'file-type'
import { BadRequestError } from '../../utils/errors.js'
import type { FileKind } from './validation.js'

/** Allowed resolved extensions per file kind (A3). Never derived from the client's filename or claimed mime. */
export const ALLOWED_EXTENSIONS: Record<FileKind, readonly string[]> = {
  abstract: ['pdf', 'doc', 'docx', 'png', 'jpg', 'webp'],
  supplementary: ['pdf', 'doc', 'docx', 'png', 'jpg', 'webp'],
  full_paper: ['pdf', 'doc', 'docx'],
  camera_ready: ['pdf', 'doc', 'docx'],
  slides: ['pdf', 'ppt', 'pptx'],
}

export const MIME_FOR_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
}

// file-type's magic-byte sniffing. Legacy .doc/.ppt/.xls all share the same
// CFB container signature, so they come back indistinguishable from one
// another — file-type reports that as 'application/x-cfb/'application/x-msi'
// family. We resolve that family to whichever of doc/ppt this file kind
// actually allows, since a given kind only ever allows one of the two.
const SNIFFED_MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/x-cfb': 'legacy',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/**
 * Resolves the real file extension from magic bytes and checks it against
 * what this file kind allows. Throws BadRequestError for anything else
 * (including a renamed text file, which sniffs to nothing we recognise).
 */
export async function resolveAndValidateExtension(buffer: Buffer, kind: FileKind): Promise<string> {
  const allowed = ALLOWED_EXTENSIONS[kind]
  const sniffed = await fileTypeFromBuffer(buffer)
  const mapped = sniffed ? SNIFFED_MIME_TO_EXT[sniffed.mime] : undefined

  if (!mapped) {
    throw new BadRequestError('This file type is not allowed.')
  }

  if (mapped === 'legacy') {
    if (allowed.includes('doc')) return 'doc'
    if (allowed.includes('ppt')) return 'ppt'
    throw new BadRequestError('This file type is not allowed.')
  }

  if (!allowed.includes(mapped)) {
    throw new BadRequestError('This file type is not allowed.')
  }
  return mapped
}

import { z } from 'zod'

export const CERTIFICATE_TYPES = [
  'participation',
  'presentation',
  'speaker',
  'reviewer',
  'session_chair',
  'staff',
  'best_paper',
] as const

// Issued automatically by "Generate certificates"; the other two
// (speaker, best_paper) are always issued manually to a chosen recipient.
export const AUTO_CERTIFICATE_TYPES = ['participation', 'presentation', 'reviewer', 'session_chair', 'staff'] as const

const DEFAULT_NAME_LAYOUT = { y: 260, font_size: 48, color: '#1A1A1A' }

const nameLayoutSchema = z.object({
  y: z.coerce.number().min(0).max(1000).default(260),
  font_size: z.coerce.number().min(8).max(200).default(48),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Enter a 6-digit hex colour.')
    .default('#1A1A1A'),
})

export const signatorySchema = z.object({
  name: z.string().trim().min(1).max(150),
  title: z.string().trim().min(1).max(150),
  signature_path: z.string().trim().nullable().optional(),
})

export const certificateTemplateSchema = z.object({
  certificate_type: z.enum(CERTIFICATE_TYPES),
  name: z.string().trim().min(1, 'Name is required.').max(200),
  layout: z.object({ name: nameLayoutSchema.default(DEFAULT_NAME_LAYOUT) }).default({ name: DEFAULT_NAME_LAYOUT }),
  signatories: z.array(signatorySchema).max(2).default([]),
  is_active: z.boolean().default(true),
})
export type CertificateTemplateInput = z.infer<typeof certificateTemplateSchema>

export const generateCertificatesSchema = z.object({
  certificate_type: z.enum(AUTO_CERTIFICATE_TYPES),
  template_id: z.string().uuid().nullable().optional(),
})
export type GenerateCertificatesInput = z.infer<typeof generateCertificatesSchema>

export const issueBestPaperSchema = z.object({
  submission_id: z.string().uuid(),
  template_id: z.string().uuid().nullable().optional(),
})
export type IssueBestPaperInput = z.infer<typeof issueBestPaperSchema>

export const issueSpeakerCertificateSchema = z.object({
  speaker_id: z.string().uuid(),
  template_id: z.string().uuid().nullable().optional(),
})
export type IssueSpeakerCertificateInput = z.infer<typeof issueSpeakerCertificateSchema>

export const revokeCertificateSchema = z.object({
  reason: z.string().trim().min(1, 'Give a reason.').max(500),
})
export type RevokeCertificateInput = z.infer<typeof revokeCertificateSchema>

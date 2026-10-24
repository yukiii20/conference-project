import { z } from 'zod'

/** Keep in sync with the GROUP_QUERIES map in service.ts — one entry per recipient group the convenor can pick from. */
export const RECIPIENT_GROUPS = [
  'all_authors',
  'authors_accepted',
  'authors_rejected',
  'reviewers',
  'reviewers_pending',
  'attendees_registered',
  'attendees_confirmed',
  'attendees_checked_in',
  'committee_members',
  'session_chairs',
] as const
export type RecipientGroup = (typeof RECIPIENT_GROUPS)[number]

const groupsSchema = z.array(z.enum(RECIPIENT_GROUPS)).min(1, 'Choose at least one recipient group.')

export const saveDraftSchema = z.object({
  subject: z.string().trim().min(1, 'Write a subject.').max(300, 'Subject must be 300 characters or fewer.'),
  body_html: z.string().trim().min(1, 'Write the email body.').max(20_000, 'Body must be 20,000 characters or fewer.'),
  recipient_groups: groupsSchema,
})
export type SaveDraftInput = z.infer<typeof saveDraftSchema>

export const previewRecipientsSchema = z.object({ groups: groupsSchema })
export type PreviewRecipientsInput = z.infer<typeof previewRecipientsSchema>

export const previewContentSchema = z.object({
  subject: z.string().trim().min(1, 'Write a subject.').max(300, 'Subject must be 300 characters or fewer.'),
  body_html: z.string().trim().min(1, 'Write the email body.').max(20_000, 'Body must be 20,000 characters or fewer.'),
})
export type PreviewContentInput = z.infer<typeof previewContentSchema>

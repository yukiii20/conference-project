import { z } from 'zod'
import { plainText } from '../audience/access.js'

/** Optional plain-text field: tags and control characters removed, empty -> null. */
function optionalText(max: number, label: string) {
  return z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v == null ? null : plainText(v).trim() || null))
    .pipe(z.string().max(max, `${label} must be ${max} characters or fewer.`).nullable())
}

/** A DOI (10.xxxx/...) or an http(s) link. */
const DOI_OR_LINK = /^(https?:\/\/\S+|10\.\d{4,9}(\/\S*)?)$/i

function optionalDoiOrLink(max: number) {
  return optionalText(max, 'The DOI or link').refine((v) => v == null || DOI_OR_LINK.test(v), {
    message: 'Enter a DOI (for example 10.1234/abc) or a link starting with https://.',
  })
}

const optionalDate = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v ? v.trim() : null))
  .refine((v) => v == null || /^\d{4}-\d{2}-\d{2}$/.test(v), { message: 'Use a date like 2026-12-31.' })

/** Conference-level publication information (Conference setup -> Publication information). Plain text only. */
export const publicationInfoSchema = z.object({
  title: optionalText(300, 'The publication title'),
  publisher: optionalText(300, 'The publisher'),
  isbn_issn: optionalText(40, 'The ISBN or ISSN').refine((v) => v == null || /^[0-9Xx][0-9Xx\- ]{3,39}$/.test(v), {
    message: 'Use digits, X and hyphens only (for example 978-3-16-148410-0 or 1234-5678).',
  }),
  link: optionalDoiOrLink(500),
  date: optionalDate,
  note: optionalText(2000, 'The note'),
})
export type PublicationInfoInput = z.infer<typeof publicationInfoSchema>

/** One paper's publication record (Papers -> paper -> Publication). */
export const paperPublicationSchema = z.object({
  is_published: z.boolean(),
  published_in: optionalText(300, '"Published in"'),
  doi_or_link: optionalDoiOrLink(500),
  publication_date: optionalDate,
})
export type PaperPublicationInput = z.infer<typeof paperPublicationSchema>

/** Bulk "Publish all final-approved papers": optional defaults for papers that have no value yet. */
export const publishAllSchema = z.object({
  published_in: optionalText(300, '"Published in"'),
  publication_date: optionalDate,
})
export type PublishAllInput = z.infer<typeof publishAllSchema>

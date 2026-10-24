import { z } from 'zod'

/** Empty string from a cleared form field means "use the default", same as null. */
function optionalText(max: number) {
  return z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(max).nullable(),
  )
}

const faqItemSchema = z.object({
  q: z.string().trim().min(1, 'Question is required.').max(300),
  a: z.string().trim().min(1, 'Answer is required.').max(2000),
})

export const platformSettingsSchema = z.object({
  platform_name: z.string().trim().min(1, 'Platform name is required.').max(200),
  support_email: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().email('Enter a valid email.').max(254).nullable(),
  ),
  footer_text: optionalText(1000),
  hero_headline: optionalText(300),
  hero_subheadline: optionalText(500),
  faq_items: z.array(faqItemSchema).max(30),
  // Optional + defaulted (not required) so a caller that doesn't know about
  // this toggle yet (the admin form, until it's updated) still validates —
  // only an explicit PATCH that includes it can turn it off.
  notify_admins_of_suggestions: z.boolean().optional().default(true),
})
export type PlatformSettingsInput = z.infer<typeof platformSettingsSchema>

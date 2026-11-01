import { CERTIFICATE_TYPES } from '../../../lib/validation'

export type Signatory = { name: string; title: string; signature_path: string | null }

export type TextKey = 'header' | 'title' | 'subtitle' | 'intro' | 'wording' | 'event' | 'seal'
export type ColorKey = 'frame' | 'accent' | 'title' | 'text' | 'background'
export type ShowKey = 'logo' | 'frame' | 'header' | 'subtitle' | 'intro' | 'seal' | 'number' | 'issued' | 'qr'

export type Layout = {
  name: { y: number; font_size: number; color: string }
  texts?: Partial<Record<TextKey, string>>
  colors?: Partial<Record<ColorKey, string>>
  show?: Partial<Record<ShowKey, boolean>>
  font?: 'serif' | 'sans'
}

export type Template = {
  id: string
  certificate_type: string
  name: string
  background_path: string | null
  layout: Layout
  signatories: Signatory[]
  is_active: boolean
}

export type Certificate = {
  id: string
  recipient_name: string
  certificate_type: string
  certificate_number: string
  issued_at: string
  status: string
  revoked_reason: string | null
}

export type Submission = { id: string; submission_code: string | null; title: string; status: string }
export type Speaker = { id: string; full_name: string }

export const TYPE_LABELS: Record<string, string> = {
  participation: 'Participation',
  presentation: 'Presentation',
  speaker: 'Speaker',
  reviewer: 'Reviewer',
  session_chair: 'Session chair',
  staff: 'Staff',
  best_paper: 'Best paper',
}

// Must match server/src/modules/certificates/export.ts (shown as placeholders: empty = default).
export const DEFAULT_WORDING: Record<string, string> = {
  participation: 'has participated in',
  presentation: 'has presented a paper at',
  speaker: 'has delivered an invited talk at',
  reviewer: 'has served as a reviewer for',
  session_chair: 'has chaired a session at',
  staff: 'has served as organising staff for',
  best_paper: 'has received the Best Paper Award at',
}
export const DEFAULT_SUBTITLE: Record<string, string> = {
  participation: 'of Participation',
  presentation: 'of Presentation',
  speaker: 'of Appreciation',
  reviewer: 'of Appreciation',
  session_chair: 'of Appreciation',
  staff: 'of Appreciation',
  best_paper: 'of Excellence',
}

export const TEXT_FIELDS: Array<{ key: TextKey; label: string; max: number; help?: string; placeholder: (type: string) => string }> = [
  { key: 'header', label: 'Top line', max: 150, help: 'Small line above the title, shown in capitals.', placeholder: () => '{conference}' },
  { key: 'title', label: 'Title', max: 60, placeholder: () => 'CERTIFICATE' },
  { key: 'subtitle', label: 'Subtitle', max: 80, help: 'Shown in capitals under the title.', placeholder: (t) => DEFAULT_SUBTITLE[t] ?? 'of Recognition' },
  { key: 'intro', label: 'Line above the name', max: 120, placeholder: () => 'This is to certify that' },
  { key: 'wording', label: 'Line below the name', max: 150, placeholder: (t) => DEFAULT_WORDING[t] ?? 'is recognised at' },
  { key: 'event', label: 'Event line', max: 200, placeholder: () => '{conference}' },
  { key: 'seal', label: 'Seal text', max: 6, help: 'Up to 6 letters. Default: the conference acronym.', placeholder: () => 'auto' },
]

export const COLOR_FIELDS: Array<{ key: ColorKey; label: string; fallback: string }> = [
  { key: 'frame', label: 'Frame and event name', fallback: '' },
  { key: 'accent', label: 'Gold accents and seal', fallback: '#B8913A' },
  { key: 'title', label: 'Title', fallback: '#1F2328' },
  { key: 'text', label: 'Body text', fallback: '#5B6168' },
  { key: 'background', label: 'Paper', fallback: '#FFFDF8' },
]

export const SHOW_FIELDS: Array<{ key: ShowKey; label: string }> = [
  { key: 'logo', label: 'Conference logo' },
  { key: 'frame', label: 'Border frame' },
  { key: 'header', label: 'Top line' },
  { key: 'subtitle', label: 'Subtitle' },
  { key: 'intro', label: 'Line above the name' },
  { key: 'seal', label: 'Seal' },
  { key: 'number', label: 'Certificate number' },
  { key: 'issued', label: 'Issue date' },
  { key: 'qr', label: 'QR code (verification)' },
]

export const HEX = /^#[0-9A-Fa-f]{6}$/

export const EMPTY_FORM: {
  certificate_type: (typeof CERTIFICATE_TYPES)[number]
  name: string
  layout: Layout
  signatories: Signatory[]
  is_active: boolean
} = {
  certificate_type: 'participation',
  name: '',
  layout: { name: { y: 260, font_size: 48, color: '#1A1A1A' } },
  signatories: [],
  is_active: true,
}

/** Drops empty texts/colours so "empty" always means "use the default design". */
export function cleanLayout(layout: Layout): Layout {
  const texts = Object.fromEntries(Object.entries(layout.texts ?? {}).filter(([, v]) => v && v.trim()))
  const colors = Object.fromEntries(Object.entries(layout.colors ?? {}).filter(([, v]) => v && HEX.test(v)))
  return {
    name: layout.name,
    ...(Object.keys(texts).length ? { texts } : {}),
    ...(Object.keys(colors).length ? { colors } : {}),
    ...(layout.show && Object.keys(layout.show).length ? { show: layout.show } : {}),
    ...(layout.font ? { font: layout.font } : {}),
  }
}

export function cleanSignatories(signatories: Signatory[]): Signatory[] {
  return signatories.filter((s) => s.name.trim() || s.title.trim())
}

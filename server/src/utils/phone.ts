/**
 * Normalises a Nepal mobile number (with or without +977) to +977XXXXXXXXXX,
 * matching the frontend's src/lib/validation.ts and the database's E.164
 * CHECK constraint on users.phone.
 */
export function normalizePhone(raw: string): string | null {
  let digits = raw.trim().replace(/[\s-]/g, '').replace(/^\+/, '')
  if (digits.startsWith('977')) {
    digits = digits.slice(3)
  }
  if (/^(97|98)\d{8}$/.test(digits)) {
    return `+977${digits}`
  }
  return null
}

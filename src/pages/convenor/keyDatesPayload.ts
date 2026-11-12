import { fromKathmanduInputValue } from '../../lib/datetime'

export type KeyDateType = { code: string; name: string; is_window: boolean }
export type KeyDateRowState = { opens_at: string; closes_at: string; is_public: boolean }
export type KeyDatePayloadRow = { deadline_type: string; opens_at: string; closes_at: string | null; is_public: boolean }

/** Field keys that hold a half-typed date/time (the browser reports those as ''): `${code}.opens_at` / `${code}.closes_at`. */
export type IncompleteFields = ReadonlySet<string>

/**
 * Turns the Key dates form into the PUT body. Every row that can't be saved is an explicit
 * error - it used to be skipped silently while the page still said "Saved.", which looked like
 * "the date didn't save the first time".
 */
export function buildKeyDatesPayload(
  types: KeyDateType[],
  rows: Record<string, KeyDateRowState>,
  incomplete: IncompleteFields = new Set(),
): { payload: KeyDatePayloadRow[] } | { error: string } {
  const payload: KeyDatePayloadRow[] = []
  for (const t of types) {
    const row = rows[t.code]
    if (!row) continue
    for (const field of ['opens_at', 'closes_at'] as const) {
      if (incomplete.has(`${t.code}.${field}`)) {
        const which = t.is_window ? (field === 'opens_at' ? 'opening' : 'closing') : ''
        return { error: `${t.name}: enter both the date and the time${which ? ` of the ${which} date` : ''}, or clear the field.` }
      }
    }
    if (t.is_window) {
      if (!row.opens_at && !row.closes_at) continue // not set yet - leave it alone
      if (!row.opens_at) return { error: `${t.name}: set the opening date too, or clear the closing date.` }
      const opensIso = fromKathmanduInputValue(row.opens_at)
      const closesIso = row.closes_at ? fromKathmanduInputValue(row.closes_at) : null
      if (!opensIso || (row.closes_at && !closesIso)) return { error: `${t.name}: this is not a valid date and time.` }
      if (closesIso && closesIso < opensIso) return { error: `${t.name}: the closing date must be on or after the opening date.` }
      payload.push({ deadline_type: t.code, opens_at: opensIso, closes_at: closesIso, is_public: row.is_public })
    } else {
      if (!row.closes_at) continue
      const iso = fromKathmanduInputValue(row.closes_at)
      if (!iso) return { error: `${t.name}: this is not a valid date and time.` }
      payload.push({ deadline_type: t.code, opens_at: iso, closes_at: iso, is_public: row.is_public })
    }
  }
  if (payload.length === 0) return { error: 'Set at least one date before saving.' }
  return { payload }
}

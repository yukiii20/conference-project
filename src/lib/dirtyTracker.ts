/**
 * Decides whether the person has REALLY changed something on the page, for the
 * "Discard changes?" guard.
 *
 * The old guard set one flag on any `change`/`input` event, so typing in a search box,
 * picking a filter, uploading a logo (saved immediately), editing a field and changing it
 * back, or editing inside a dialog that was then cancelled all counted as "unsaved changes".
 *
 * Now each field's value is remembered the moment the person starts interacting with it
 * (focus / pointer / key - always after the data has loaded and been rendered), and the page
 * is dirty only while at least one field that is still on the page differs from that
 * baseline, compared after normalising (trimmed text, numbers by value, multi-selects in any
 * order). A successful save resets every baseline.
 */

/** The parts of a form control the tracker reads (a structural subset of the DOM element types). */
export type TrackableControl = {
  tagName: string
  type?: string
  value?: string
  checked?: boolean
  multiple?: boolean
  selectedOptions?: ArrayLike<{ value: string }>
  isConnected: boolean
  name?: string
  placeholder?: string
  getAttribute(name: string): string | null
  closest?(selector: string): unknown
}

/** Controls that never hold "unsaved work": search/filter boxes, immediate-upload file pickers, buttons. */
const IGNORED_INPUT_TYPES = new Set(['search', 'file', 'button', 'submit', 'reset', 'image', 'hidden'])
const FILTER_HINT = /\b(search|filter|sort by)\b/i

export function isTrackable(el: TrackableControl): boolean {
  const tag = el.tagName.toUpperCase()
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return false
  if (tag === 'INPUT' && IGNORED_INPUT_TYPES.has((el.type ?? 'text').toLowerCase())) return false
  // Opt-out for anything else that only changes what is shown (data-no-dirty on it or an ancestor).
  if (el.getAttribute('data-no-dirty') !== null) return false
  if (el.closest?.('[data-no-dirty]')) return false
  if (el.closest?.('[role="search"]')) return false
  const hint = `${el.getAttribute('aria-label') ?? ''} ${el.placeholder ?? ''} ${el.name ?? ''}`
  if (FILTER_HINT.test(hint)) return false
  return true
}

/** The control's current value in a form where "no real change" compares equal. */
export function normalizedValue(el: TrackableControl): string {
  const tag = el.tagName.toUpperCase()
  const type = (el.type ?? '').toLowerCase()
  if (tag === 'INPUT' && (type === 'checkbox' || type === 'radio')) return el.checked ? 'on' : 'off'
  if (tag === 'SELECT' && el.multiple && el.selectedOptions) {
    return Array.from(el.selectedOptions, (o) => o.value).sort().join('\u0000')
  }
  const raw = (el.value ?? '').trim()
  if (tag === 'INPUT' && (type === 'number' || type === 'range')) {
    if (raw === '') return ''
    const n = Number(raw)
    return Number.isNaN(n) ? raw : String(n)
  }
  // Line endings differ between browsers for textareas; whitespace-only edits are not edits.
  return raw.replace(/\r\n/g, '\n')
}

export class DirtyTracker<T extends TrackableControl = TrackableControl> {
  private baselines = new Map<T, string>()
  private changed = new Set<T>()

  /** Remember the value before the person touches this control (only the first time). */
  begin(el: T): void {
    if (!isTrackable(el) || this.baselines.has(el)) return
    this.baselines.set(el, normalizedValue(el))
  }

  /** After a change/input event: is this control now different from its baseline? */
  update(el: T): void {
    if (!isTrackable(el)) return
    // A value changed without any interaction first (e.g. picked from a calendar popup that
    // never focused the field): its pre-change value is unknown, so count it as a change.
    if (!this.baselines.has(el)) {
      this.changed.add(el)
      return
    }
    if (normalizedValue(el) === this.baselines.get(el)) this.changed.delete(el)
    else this.changed.add(el)
  }

  /** Only controls still on the page count: a cancelled dialog's fields don't keep the page dirty. */
  isDirty(): boolean {
    for (const el of this.changed) {
      if (!el.isConnected) {
        this.changed.delete(el)
        this.baselines.delete(el)
      }
    }
    return this.changed.size > 0
  }

  /** After a successful save, or after "Discard changes": everything on the page is the new baseline. */
  reset(): void {
    this.baselines.clear()
    this.changed.clear()
  }
}

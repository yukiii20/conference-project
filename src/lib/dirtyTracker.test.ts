import { describe, expect, it } from 'vitest'
import { DirtyTracker, isTrackable, normalizedValue, type TrackableControl } from './dirtyTracker'

function control(init: Partial<TrackableControl> & { attrs?: Record<string, string>; insideNoDirty?: boolean } = {}): TrackableControl {
  const { attrs = {}, insideNoDirty = false, ...rest } = init
  return {
    tagName: 'INPUT',
    type: 'text',
    value: '',
    isConnected: true,
    getAttribute: (name) => attrs[name] ?? null,
    closest: (selector) => (insideNoDirty && selector === '[data-no-dirty]' ? {} : null),
    ...rest,
  }
}

/** What the page does: focus/pointer first (baseline), then the change event. */
function edit(tracker: DirtyTracker, el: TrackableControl, value: string) {
  tracker.begin(el)
  el.value = value
  tracker.update(el)
}

describe('DirtyTracker: the "Discard changes?" dialog only appears for a real change', () => {
  it('open then leave: no dialog', () => {
    const tracker = new DirtyTracker()
    const name = control({ value: 'ICAI 2026' })
    tracker.begin(name) // focusing a field is not a change
    expect(tracker.isDirty()).toBe(false)
  })

  it('edit then revert: no dialog', () => {
    const tracker = new DirtyTracker()
    const name = control({ value: 'ICAI 2026' })
    edit(tracker, name, 'ICAI 2027')
    expect(tracker.isDirty()).toBe(true)
    edit(tracker, name, 'ICAI 2026')
    expect(tracker.isDirty()).toBe(false)
  })

  it('edit then leave: dialog', () => {
    const tracker = new DirtyTracker()
    edit(tracker, control({ value: '2026-11-15' , type: 'date'}), '2026-11-16')
    expect(tracker.isDirty()).toBe(true)
  })

  it('save then leave: no dialog (a successful save resets the baseline)', () => {
    const tracker = new DirtyTracker()
    const field = control({ value: 'a' })
    edit(tracker, field, 'b')
    tracker.reset()
    expect(tracker.isDirty()).toBe(false)
    // ...and the saved value is the new baseline.
    edit(tracker, field, 'b')
    expect(tracker.isDirty()).toBe(false)
  })

  it('whitespace-only and same-number edits are not changes', () => {
    const tracker = new DirtyTracker()
    edit(tracker, control({ value: 'Kathmandu' }), '  Kathmandu ')
    edit(tracker, control({ type: 'number', value: '5' }), '5.0')
    expect(tracker.isDirty()).toBe(false)
  })

  it('a multi-select in a different order is not a change', () => {
    const el = control({ tagName: 'SELECT', multiple: true, selectedOptions: [{ value: 'a' }, { value: 'b' }] })
    const tracker = new DirtyTracker()
    tracker.begin(el)
    el.selectedOptions = [{ value: 'b' }, { value: 'a' }]
    tracker.update(el)
    expect(tracker.isDirty()).toBe(false)
  })

  it('checkboxes compare checked state', () => {
    const tracker = new DirtyTracker()
    const box = control({ type: 'checkbox', checked: false })
    tracker.begin(box)
    box.checked = true
    tracker.update(box)
    expect(tracker.isDirty()).toBe(true)
    box.checked = false
    tracker.update(box)
    expect(tracker.isDirty()).toBe(false)
  })

  it('search boxes, filters, file pickers and opted-out controls never count', () => {
    const tracker = new DirtyTracker()
    edit(tracker, control({ type: 'search' }), 'smith')
    edit(tracker, control({ type: 'file' }), 'C:\\fakepath\\logo.png')
    edit(tracker, control({ placeholder: 'Search by name or email' }), 'smith')
    edit(tracker, control({ placeholder: 'Filter by action, e.g. publish' }), 'publish')
    edit(tracker, control({ attrs: { 'data-no-dirty': '' } }), 'x')
    edit(tracker, control({ insideNoDirty: true, tagName: 'SELECT' }), 'accepted')
    expect(tracker.isDirty()).toBe(false)
  })

  it("a cancelled dialog's fields (no longer on the page) don't keep the page dirty", () => {
    const tracker = new DirtyTracker()
    const inModal = control({ value: '' })
    edit(tracker, inModal, 'typed in a dialog')
    expect(tracker.isDirty()).toBe(true)
    inModal.isConnected = false
    expect(tracker.isDirty()).toBe(false)
  })

  it('a value changed without any prior interaction still counts (unknown baseline)', () => {
    const tracker = new DirtyTracker()
    const el = control({ value: 'x' })
    tracker.update(el)
    expect(tracker.isDirty()).toBe(true)
  })
})

describe('isTrackable / normalizedValue', () => {
  it('ignores non-form elements and buttons', () => {
    expect(isTrackable(control({ tagName: 'DIV' }))).toBe(false)
    expect(isTrackable(control({ type: 'submit' }))).toBe(false)
    expect(isTrackable(control({ tagName: 'TEXTAREA' }))).toBe(true)
  })

  it('normalises line endings in text areas', () => {
    expect(normalizedValue(control({ tagName: 'TEXTAREA', value: 'a\r\nb' }))).toBe('a\nb')
  })
})

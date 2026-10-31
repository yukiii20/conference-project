import { describe, expect, it } from 'vitest'
import { clampPage, compareSortValues, filterRows, nextSort, pageList, paginate, sortRows, type TableColumnLogic, type TableQuery } from './dataTable'

type Row = { id: number; title: string; author: string; status: string; tracks: string[]; score: number | null; submitted: Date | null }

const rows: Row[] = [
  { id: 1, title: 'Résumé of glaciers', author: 'Ana Silva', status: 'submitted', tracks: ['climate'], score: 4.5, submitted: new Date('2026-03-02') },
  { id: 2, title: 'Water policy in Nepal', author: 'Bikash Rai', status: 'accepted', tracks: ['policy', 'climate'], score: null, submitted: new Date('2026-01-15') },
  { id: 3, title: 'Item 10 review', author: 'Chen Li', status: 'rejected', tracks: [], score: 2, submitted: null },
  { id: 4, title: 'Item 9 review', author: 'ana lopez', status: 'submitted', tracks: ['policy'], score: 3, submitted: new Date('2026-02-01') },
]

const columns: TableColumnLogic<Row>[] = [
  { id: 'title', searchValue: (r) => r.title, sortValue: (r) => r.title },
  { id: 'author', searchValue: (r) => r.author, sortValue: (r) => r.author },
  { id: 'status', filter: { value: (r) => r.status } },
  { id: 'tracks', filter: { value: (r) => r.tracks } },
  { id: 'score', sortValue: (r) => r.score },
  { id: 'submitted', sortValue: (r) => r.submitted },
]

const empty: TableQuery = { search: '', filters: {}, columnSearch: {}, sort: null }
const ids = (list: Row[]) => list.map((r) => r.id)

describe('filterRows', () => {
  it('returns the same array when nothing is active', () => {
    expect(filterRows(rows, columns, empty)).toBe(rows)
  })

  it('global search matches every word across searchable columns, ignoring case and accents', () => {
    expect(ids(filterRows(rows, columns, { ...empty, search: 'resume' }))).toEqual([1])
    expect(ids(filterRows(rows, columns, { ...empty, search: 'ANA' }))).toEqual([1, 4])
    expect(ids(filterRows(rows, columns, { ...empty, search: 'ana glaciers' }))).toEqual([1])
    expect(ids(filterRows(rows, columns, { ...empty, search: 'nothing-like-this' }))).toEqual([])
  })

  it('enumerated filters allow any of the chosen values, including multi-valued cells', () => {
    expect(ids(filterRows(rows, columns, { ...empty, filters: { status: ['submitted', 'accepted'] } }))).toEqual([1, 2, 4])
    expect(ids(filterRows(rows, columns, { ...empty, filters: { tracks: ['policy'] } }))).toEqual([2, 4])
    expect(ids(filterRows(rows, columns, { ...empty, filters: { status: [] } }))).toEqual([1, 2, 3, 4])
  })

  it('column search only looks at that column, and combines with other filters', () => {
    expect(ids(filterRows(rows, columns, { ...empty, columnSearch: { author: 'ana' } }))).toEqual([1, 4])
    expect(ids(filterRows(rows, columns, { ...empty, columnSearch: { title: 'ana' } }))).toEqual([])
    expect(ids(filterRows(rows, columns, { ...empty, columnSearch: { author: 'ana' }, filters: { tracks: ['climate'] } }))).toEqual([1])
  })
})

describe('sortRows', () => {
  it('sorts text naturally (Item 9 before Item 10)', () => {
    expect(ids(sortRows(rows, columns, { id: 'title', direction: 'asc' }))).toEqual([4, 3, 1, 2])
  })

  it('sorts numbers and dates, empty values always last', () => {
    expect(ids(sortRows(rows, columns, { id: 'score', direction: 'asc' }))).toEqual([3, 4, 1, 2])
    expect(ids(sortRows(rows, columns, { id: 'score', direction: 'desc' }))).toEqual([1, 4, 3, 2])
    expect(ids(sortRows(rows, columns, { id: 'submitted', direction: 'desc' }))).toEqual([1, 4, 2, 3])
  })

  it('ignores unknown or unsortable columns', () => {
    expect(sortRows(rows, columns, { id: 'status', direction: 'asc' })).toBe(rows)
    expect(sortRows(rows, columns, null)).toBe(rows)
  })

  it('compareSortValues treats booleans and invalid dates sensibly', () => {
    expect(compareSortValues(true, false, 'asc')).toBeGreaterThan(0)
    expect(compareSortValues(new Date('nope'), new Date('2026-01-01'), 'asc')).toBe(1)
  })
})

describe('paging', () => {
  it('clamps the page into range', () => {
    expect(clampPage(0, 40, 10)).toBe(1)
    expect(clampPage(9, 40, 10)).toBe(4)
    expect(clampPage(2, 0, 10)).toBe(1)
  })

  it('slices the requested page', () => {
    const list = Array.from({ length: 23 }, (_, i) => i)
    expect(paginate(list, 3, 10)).toEqual([20, 21, 22])
    expect(paginate(list, 99, 10)).toEqual([20, 21, 22])
  })

  it('builds a compact page list', () => {
    expect(pageList(1, 5)).toEqual([1, 2, 3, 4, 5])
    expect(pageList(1, 20)).toEqual([1, 2, 3, 4, '…', 20])
    expect(pageList(10, 20)).toEqual([1, '…', 9, 10, 11, '…', 20])
    expect(pageList(20, 20)).toEqual([1, '…', 17, 18, 19, 20])
  })

  it('cycles sort asc -> desc -> off', () => {
    expect(nextSort(null, 'a')).toEqual({ id: 'a', direction: 'asc' })
    expect(nextSort({ id: 'a', direction: 'asc' }, 'a')).toEqual({ id: 'a', direction: 'desc' })
    expect(nextSort({ id: 'a', direction: 'desc' }, 'a')).toBeNull()
    expect(nextSort({ id: 'a', direction: 'desc' }, 'b')).toEqual({ id: 'b', direction: 'asc' })
  })
})

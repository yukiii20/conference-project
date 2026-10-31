// Pure filtering / sorting / paging behind <DataTable> (src/components/ui/DataTable.tsx).
// Kept free of React so it can be unit-tested and reused (e.g. for CSV export
// of "what the convenor is currently looking at").

export type SortDirection = 'asc' | 'desc'
export type SortState = { id: string; direction: SortDirection } | null
export type SortValue = string | number | boolean | Date | null | undefined

export type TableColumnLogic<T> = {
  id: string
  sortValue?: (row: T) => SortValue
  searchValue?: (row: T) => string | null | undefined
  filter?: { value: (row: T) => string | string[] | null | undefined }
}

export type TableQuery = {
  /** Global search: every word must appear in at least one searchable column. */
  search: string
  /** Enumerated filters: column id -> allowed values (empty/missing = no filter). */
  filters: Record<string, string[]>
  /** Per-column "contains" text filters. */
  columnSearch: Record<string, string>
  sort: SortState
}

export function normaliseText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

function words(query: string): string[] {
  return normaliseText(query).split(/\s+/).filter(Boolean)
}

function sortKey(value: SortValue): string | number | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime()
  if (typeof value === 'boolean') return value ? 1 : 0
  return value
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Empty values always sort last, whichever direction. */
export function compareSortValues(a: SortValue, b: SortValue, direction: SortDirection): number {
  const ka = sortKey(a)
  const kb = sortKey(b)
  if (ka === null && kb === null) return 0
  if (ka === null) return 1
  if (kb === null) return -1
  const result = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : collator.compare(String(ka), String(kb))
  return direction === 'asc' ? result : -result
}

export function filterRows<T>(rows: T[], columns: TableColumnLogic<T>[], query: TableQuery): T[] {
  const searchable = columns.filter((c) => c.searchValue)
  const globalWords = words(query.search)
  const activeFilters = Object.entries(query.filters).filter(([, values]) => values.length > 0)
  const activeColumnSearch = Object.entries(query.columnSearch)
    .map(([id, text]) => [id, words(text)] as const)
    .filter(([, w]) => w.length > 0)

  if (globalWords.length === 0 && activeFilters.length === 0 && activeColumnSearch.length === 0) return rows

  const byId = new Map(columns.map((c) => [c.id, c]))

  return rows.filter((row) => {
    for (const [id, allowed] of activeFilters) {
      const column = byId.get(id)
      if (!column?.filter) continue
      const raw = column.filter.value(row)
      const values = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw]
      if (!values.some((v) => allowed.includes(v))) return false
    }

    for (const [id, needle] of activeColumnSearch) {
      const column = byId.get(id)
      if (!column?.searchValue) continue
      const haystack = normaliseText(column.searchValue(row) ?? '')
      if (!needle.every((w) => haystack.includes(w))) return false
    }

    if (globalWords.length > 0) {
      const haystack = normaliseText(searchable.map((c) => c.searchValue!(row) ?? '').join(' \u0000 '))
      if (!globalWords.every((w) => haystack.includes(w))) return false
    }
    return true
  })
}

export function sortRows<T>(rows: T[], columns: TableColumnLogic<T>[], sort: SortState): T[] {
  if (!sort) return rows
  const column = columns.find((c) => c.id === sort.id)
  if (!column?.sortValue) return rows
  const getValue = column.sortValue
  // Stable: ties keep their incoming (server) order.
  return rows
    .map((row, index) => ({ row, index, value: getValue(row) }))
    .sort((a, b) => compareSortValues(a.value, b.value, sort.direction) || a.index - b.index)
    .map((entry) => entry.row)
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
}

export function clampPage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(1, Math.floor(page) || 1), pageCount(total, pageSize))
}

export function paginate<T>(rows: T[], page: number, pageSize: number): T[] {
  const p = clampPage(page, rows.length, pageSize)
  return rows.slice((p - 1) * pageSize, p * pageSize)
}

/** Next sort state when a header is activated: asc -> desc -> off. */
export function nextSort(current: SortState, id: string): SortState {
  if (!current || current.id !== id) return { id, direction: 'asc' }
  if (current.direction === 'asc') return { id, direction: 'desc' }
  return null
}

/**
 * Compact page list for a pager, e.g. [1, '…', 4, 5, 6, '…', 20].
 * Always includes first, last and the current page's neighbours.
 */
export function pageList(current: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = new Set([1, total, current - 1, current, current + 1])
  if (current <= 3) [2, 3, 4].forEach((p) => pages.add(p))
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((p) => pages.add(p))
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b)
  const out: Array<number | '…'> = []
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1]! > 1) out.push('…')
    out.push(p)
  })
  return out
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, ListFilter, Search, X } from 'lucide-react'
import {
  clampPage,
  filterRows,
  nextSort,
  pageCount,
  pageList,
  paginate,
  sortRows,
  type SortState,
  type SortValue,
  type TableQuery,
} from '../../lib/dataTable'
import { Skeleton } from './Spinner'
import { EmptyState, ErrorState } from './EmptyState'
import { RowActionsMenu, type MenuItem } from './Menu'
import { Popover, useMediaQuery } from './Popover'

export type FilterOption = { value: string; label: string }

export type DataColumn<T> = {
  id: string
  header: string
  cell: (row: T) => ReactNode
  /** Value used for sorting. Omit to make the column unsortable. */
  sortValue?: (row: T) => SortValue
  /** Text matched by the global search and the column's own "contains" filter. */
  searchValue?: (row: T) => string | null | undefined
  /** Enumerated filter (status, track, role ...). `value` may return several values. */
  filter?: { options: FilterOption[]; value: (row: T) => string | string[] | null | undefined }
  /** Offer a per-column "contains" text filter in the Filters panel (needs searchValue). */
  columnSearch?: boolean
  align?: 'left' | 'right' | 'center'
  /** Header/cell width classes, e.g. 'w-32'. */
  width?: string
  /** False = always shown (and not listed in the Columns menu). Default true. */
  hideable?: boolean
  defaultHidden?: boolean
  /**
   * Role on the phone card layout: 'title' (bold first line), 'subtitle',
   * 'badge' (top-right), 'meta' (label: value rows, the default) or 'hidden'.
   */
  mobile?: 'title' | 'subtitle' | 'badge' | 'meta' | 'hidden'
  className?: string
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const

function readStored<V>(key: string | undefined, fallback: V): V {
  if (!key) return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as V) : fallback
  } catch {
    return fallback
  }
}

function writeStored(key: string | undefined, value: unknown) {
  if (!key) return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage blocked (private mode) - the preference just isn't remembered.
  }
}

/**
 * The app's standard list view: search, filters, sorting, paging, column
 * visibility, bulk selection, row menus, loading/empty/error states, and a
 * card layout on phones. Works on rows already in memory (every list endpoint
 * in this app returns the full conference-scoped set).
 */
export function DataTable<T>({
  label,
  rows,
  rowKey,
  columns,
  loading = false,
  error = null,
  onRetry,
  searchPlaceholder = 'Search…',
  initialSort = null,
  initialPageSize = 25,
  pageSizeOptions = [10, 25, 50, 100],
  selectable = false,
  bulkActions,
  rowActions,
  onRowClick,
  activeRowKey,
  toolbar,
  emptyTitle = 'Nothing here yet',
  emptyMessage,
  emptyAction,
  storageKey,
  rowClassName,
}: {
  /** Accessible name for the table (e.g. "Submissions"). */
  label: string
  rows: T[]
  rowKey: (row: T) => string
  columns: DataColumn<T>[]
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  searchPlaceholder?: string
  initialSort?: SortState
  initialPageSize?: number
  pageSizeOptions?: number[]
  selectable?: boolean
  /** Rendered in the selection bar; `clear` empties the selection (call it after a successful action). */
  bulkActions?: (selected: T[], clear: () => void) => ReactNode
  rowActions?: (row: T) => MenuItem[]
  /** Opens the row (e.g. a detail drawer). The first visible column becomes a button for keyboard users. */
  onRowClick?: (row: T) => void
  /** Highlights the row whose details are open. */
  activeRowKey?: string | null
  /** Extra controls on the right of the toolbar (export, create ...). */
  toolbar?: ReactNode
  emptyTitle?: string
  emptyMessage?: string
  emptyAction?: ReactNode
  /** Remembers hidden columns and page size per table in localStorage. */
  storageKey?: string
  rowClassName?: (row: T) => string
}) {
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, string[]>>({})
  const [columnSearch, setColumnSearch] = useState<Record<string, string>>({})
  const [sort, setSort] = useState<SortState>(initialSort)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(() => {
    const stored = readStored<number>(storageKey && `${storageKey}.pageSize`, initialPageSize)
    return pageSizeOptions.includes(stored) ? stored : initialPageSize
  })
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(readStored<string[]>(storageKey && `${storageKey}.hidden`, columns.filter((c) => c.defaultHidden).map((c) => c.id))),
  )
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const headerCheckbox = useRef<HTMLInputElement>(null)

  useEffect(() => writeStored(storageKey && `${storageKey}.hidden`, [...hidden]), [hidden, storageKey])
  useEffect(() => writeStored(storageKey && `${storageKey}.pageSize`, pageSize), [pageSize, storageKey])

  const query: TableQuery = { search, filters, columnSearch, sort }
  const filtered = useMemo(() => filterRows(rows, columns, query), [rows, columns, search, filters, columnSearch]) // eslint-disable-line react-hooks/exhaustive-deps
  const sorted = useMemo(() => sortRows(filtered, columns, sort), [filtered, columns, sort])
  const currentPage = clampPage(page, sorted.length, pageSize)
  const pageRows = useMemo(() => paginate(sorted, currentPage, pageSize), [sorted, currentPage, pageSize])
  const totalPages = pageCount(sorted.length, pageSize)

  // Any change to what's being looked at goes back to page 1.
  useEffect(() => setPage(1), [search, filters, columnSearch, pageSize])

  // Drop selections for rows that no longer exist (deleted, reloaded).
  const allKeys = useMemo(() => new Set(rows.map(rowKey)), [rows, rowKey])
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((k) => allKeys.has(k)))
      return next.size === prev.size ? prev : next
    })
  }, [allKeys])

  const visibleColumns = columns.filter((c) => !hidden.has(c.id))
  const pageKeys = pageRows.map(rowKey)
  const selectedOnPage = pageKeys.filter((k) => selected.has(k)).length
  const allOnPageSelected = pageKeys.length > 0 && selectedOnPage === pageKeys.length

  useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = selectedOnPage > 0 && !allOnPageSelected
  }, [selectedOnPage, allOnPageSelected])

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(rowKey(r))), [rows, selected, rowKey])
  const clearSelection = () => setSelected(new Set())

  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allOnPageSelected) pageKeys.forEach((k) => next.delete(k))
      else pageKeys.forEach((k) => next.add(k))
      return next
    })
  }

  function toggleRow(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const filterColumns = columns.filter((c) => c.filter || (c.columnSearch && c.searchValue))
  const hasSearch = columns.some((c) => c.searchValue)
  const activeChips: Array<{ key: string; label: string; remove: () => void }> = []
  for (const c of columns) {
    for (const v of filters[c.id] ?? []) {
      const option = c.filter?.options.find((o) => o.value === v)
      activeChips.push({
        key: `${c.id}:${v}`,
        label: `${c.header}: ${option?.label ?? v}`,
        remove: () => setFilters((f) => ({ ...f, [c.id]: (f[c.id] ?? []).filter((x) => x !== v) })),
      })
    }
    const text = columnSearch[c.id]?.trim()
    if (text) {
      activeChips.push({
        key: `${c.id}:text`,
        label: `${c.header} contains “${text}”`,
        remove: () => setColumnSearch((s) => ({ ...s, [c.id]: '' })),
      })
    }
  }
  const isFiltered = search.trim() !== '' || activeChips.length > 0
  const clearAll = () => {
    setSearch('')
    setFilters({})
    setColumnSearch({})
  }

  const showSelection = selectable && selected.size > 0
  const showToolbar = hasSearch || filterColumns.length > 0 || columns.some((c) => c.hideable !== false) || toolbar

  return (
    <section aria-label={label} className="overflow-hidden rounded-xl border border-border-soft bg-surface shadow-card">
      {showToolbar ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border-soft px-3 py-2.5 sm:px-4">
          {hasSearch ? (
            <label className="relative flex min-w-0 flex-1 basis-56 items-center">
              <span className="sr-only">Search {label.toLowerCase()}</span>
              <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 text-text-muted" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="min-h-10 w-full rounded-lg border border-transparent bg-page-bg py-2 pl-9 pr-3 text-base text-text transition-colors placeholder:text-text-muted/70 hover:border-border focus:border-button focus:bg-surface focus:outline-none focus:ring-4 focus:ring-button/15 sm:text-sm"
              />
            </label>
          ) : (
            <div className="flex-1" />
          )}

          {filterColumns.length > 0 ? (
            <FilterPanel
              columns={filterColumns}
              filters={filters}
              columnSearch={columnSearch}
              onFilters={setFilters}
              onColumnSearch={setColumnSearch}
              activeCount={activeChips.length}
            />
          ) : null}

          {columns.some((c) => c.hideable !== false) && isDesktop ? (
            <ColumnsPanel columns={columns} hidden={hidden} onChange={setHidden} />
          ) : null}

          {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}
        </div>
      ) : null}

      {activeChips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border-soft bg-page-bg/50 px-3 py-2 sm:px-4">
          {activeChips.map((chip) => (
            <span key={chip.key} className="inline-flex items-center gap-1 rounded-md border border-border-soft bg-surface py-0.5 pl-2 pr-0.5 text-xs text-text">
              {chip.label}
              <button
                type="button"
                onClick={chip.remove}
                aria-label={`Remove filter ${chip.label}`}
                className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-surface-muted hover:text-text"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          ))}
          <button type="button" onClick={clearAll} className="ml-1 min-h-8 px-1 text-xs font-medium text-button hover:underline">
            Clear all
          </button>
        </div>
      ) : null}

      {showSelection ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-button/20 bg-indigo-soft px-3 py-2 text-sm sm:px-4" role="region" aria-label="Bulk actions">
          <span className="font-medium text-brand" aria-live="polite">
            {selected.size} selected
          </span>
          {selected.size < sorted.length && allOnPageSelected ? (
            <button
              type="button"
              onClick={() => setSelected(new Set(sorted.map(rowKey)))}
              className="min-h-8 text-sm font-medium text-button hover:underline"
            >
              Select all {sorted.length} {isFiltered ? 'matching' : ''}
            </button>
          ) : null}
          <button type="button" onClick={clearSelection} className="min-h-8 text-sm text-text-muted hover:text-text hover:underline">
            Clear selection
          </button>
          {bulkActions ? <div className="flex flex-wrap items-center gap-2 sm:ml-auto">{bulkActions(selectedRows, clearSelection)}</div> : null}
        </div>
      ) : null}

      {error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : loading ? (
        <LoadingRows columns={visibleColumns.length} desktop={isDesktop} />
      ) : rows.length === 0 ? (
        <div className="px-4">
          <EmptyState title={emptyTitle} message={emptyMessage} />
          {emptyAction ? <div className="-mt-6 flex justify-center pb-10">{emptyAction}</div> : null}
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
          <p className="font-medium text-text">No results match your search or filters.</p>
          <button type="button" onClick={clearAll} className="min-h-10 text-sm font-medium text-button hover:underline">
            Clear search and filters
          </button>
        </div>
      ) : isDesktop ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">{label}</caption>
            <thead>
              <tr className="border-b border-border-soft text-xs text-text-muted">
                {selectable ? (
                  <th scope="col" className="w-12 py-2.5 pl-4 pr-1">
                    <input
                      ref={headerCheckbox}
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={togglePage}
                      aria-label="Select all rows on this page"
                      className="h-4 w-4 cursor-pointer rounded border-border-strong accent-button"
                    />
                  </th>
                ) : null}
                {visibleColumns.map((c) => {
                  const sortedHere = sort?.id === c.id ? sort.direction : null
                  return (
                    <th
                      key={c.id}
                      scope="col"
                      aria-sort={sortedHere === 'asc' ? 'ascending' : sortedHere === 'desc' ? 'descending' : undefined}
                      className={`whitespace-nowrap px-4 py-2.5 font-medium ${ALIGN[c.align ?? 'left']} ${c.width ?? ''}`}
                    >
                      {c.sortValue ? (
                        <button
                          type="button"
                          onClick={() => setSort((s) => nextSort(s, c.id))}
                          className={`group -mx-1.5 inline-flex min-h-8 items-center gap-1 rounded px-1.5 transition-colors hover:bg-page-bg hover:text-text ${
                            sortedHere ? 'text-text' : ''
                          } ${c.align === 'right' ? 'flex-row-reverse' : ''}`}
                        >
                          {c.header}
                          {sortedHere === 'asc' ? (
                            <ArrowUp size={13} aria-hidden="true" />
                          ) : sortedHere === 'desc' ? (
                            <ArrowDown size={13} aria-hidden="true" />
                          ) : (
                            <ArrowUpDown size={13} aria-hidden="true" className="opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60" />
                          )}
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  )
                })}
                {rowActions ? (
                  <th scope="col" className="w-14 px-2 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => {
                const key = rowKey(row)
                const isSelected = selected.has(key)
                const isActive = activeRowKey === key
                const actions = rowActions?.(row) ?? []
                return (
                  <tr
                    key={key}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={`border-b border-border-soft/80 transition-colors last:border-b-0 ${onRowClick ? 'cursor-pointer' : ''} ${
                      isActive ? 'bg-indigo-soft/70' : isSelected ? 'bg-indigo-soft/40' : 'hover:bg-page-bg/70'
                    } ${rowClassName?.(row) ?? ''}`}
                  >
                    {selectable ? (
                      <td className="w-12 py-3 pl-4 pr-1 align-middle" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(key)}
                          aria-label="Select row"
                          className="h-4 w-4 cursor-pointer rounded border-border-strong accent-button"
                        />
                      </td>
                    ) : null}
                    {visibleColumns.map((c, index) => (
                      <td key={c.id} className={`px-4 py-3 align-middle ${ALIGN[c.align ?? 'left']} ${c.width ?? ''} ${c.className ?? ''}`}>
                        {onRowClick && index === 0 ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              onRowClick(row)
                            }}
                            className="-m-1 rounded p-1 text-left focus-visible:outline-2"
                          >
                            {c.cell(row)}
                          </button>
                        ) : (
                          c.cell(row)
                        )}
                      </td>
                    ))}
                    {rowActions ? (
                      <td className="w-14 px-2 py-2 text-right align-middle" onClick={(e) => e.stopPropagation()}>
                        <RowActionsMenu items={actions} />
                      </td>
                    ) : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="divide-y divide-border-soft" aria-label={label}>
          {pageRows.map((row) => (
            <MobileCard
              key={rowKey(row)}
              row={row}
              columns={visibleColumns}
              selectable={selectable}
              selected={selected.has(rowKey(row))}
              active={activeRowKey === rowKey(row)}
              onToggle={() => toggleRow(rowKey(row))}
              onOpen={onRowClick ? () => onRowClick(row) : undefined}
              actions={rowActions?.(row) ?? []}
            />
          ))}
        </ul>
      )}

      {!loading && !error && sorted.length > 0 ? (
        <Pager
          page={currentPage}
          totalPages={totalPages}
          total={sorted.length}
          pageSize={pageSize}
          pageSizeOptions={pageSizeOptions}
          onPage={setPage}
          onPageSize={setPageSize}
          filteredFrom={isFiltered ? rows.length : null}
        />
      ) : null}
    </section>
  )
}

function MobileCard<T>({
  row,
  columns,
  selectable,
  selected,
  active,
  onToggle,
  onOpen,
  actions,
}: {
  row: T
  columns: DataColumn<T>[]
  selectable: boolean
  selected: boolean
  active: boolean
  onToggle: () => void
  onOpen?: () => void
  actions: MenuItem[]
}) {
  const title = columns.find((c) => c.mobile === 'title') ?? columns.find((c) => c.mobile !== 'hidden')
  const subtitle = columns.find((c) => c.mobile === 'subtitle')
  const badges = columns.filter((c) => c.mobile === 'badge')
  const meta = columns.filter((c) => c !== title && c !== subtitle && !badges.includes(c) && c.mobile !== 'hidden')

  return (
    <li className={`flex gap-3 px-4 py-3.5 ${active ? 'bg-indigo-soft/70' : selected ? 'bg-indigo-soft/40' : ''}`}>
      {selectable ? (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label="Select row"
          className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-border-strong accent-button"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 font-medium text-text">
            {title ? (
              onOpen ? (
                <button type="button" onClick={onOpen} className="text-left hover:underline">
                  {title.cell(row)}
                </button>
              ) : (
                title.cell(row)
              )
            ) : null}
          </div>
          {badges.length > 0 ? <div className="flex shrink-0 flex-wrap justify-end gap-1">{badges.map((c) => <span key={c.id}>{c.cell(row)}</span>)}</div> : null}
        </div>
        {subtitle ? <div className="mt-0.5 text-sm text-text-muted">{subtitle.cell(row)}</div> : null}
        {meta.length > 0 ? (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {meta.map((c) => (
              <div key={c.id} className="contents">
                <dt className="text-text-muted">{c.header}</dt>
                <dd className="min-w-0 text-text">{c.cell(row)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      {actions.length > 0 ? (
        <div className="-mr-2 shrink-0">
          <RowActionsMenu items={actions} />
        </div>
      ) : null}
    </li>
  )
}

function LoadingRows({ columns, desktop }: { columns: number; desktop: boolean }) {
  if (!desktop) {
    return (
      <div className="divide-y divide-border-soft" aria-busy="true" aria-label="Loading">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2 px-4 py-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="divide-y divide-border-soft" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-6 px-4 py-3.5">
          {Array.from({ length: Math.max(2, Math.min(columns, 6)) }).map((__, j) => (
            <Skeleton key={j} className={`h-4 ${j === 0 ? 'w-1/4' : 'w-24'}`} />
          ))}
        </div>
      ))}
    </div>
  )
}

function Pager({
  page,
  totalPages,
  total,
  pageSize,
  pageSizeOptions,
  onPage,
  onPageSize,
  filteredFrom,
}: {
  page: number
  totalPages: number
  total: number
  pageSize: number
  pageSizeOptions: number[]
  onPage: (p: number) => void
  onPageSize: (s: number) => void
  filteredFrom: number | null
}) {
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  const pagerButton =
    'flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-sm tabular-nums transition-colors disabled:pointer-events-none disabled:opacity-40'
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-soft px-3 py-2.5 text-sm text-text-muted sm:px-4">
      <p aria-live="polite">
        <span className="tabular-nums">
          {from}–{to}
        </span>{' '}
        of <span className="tabular-nums">{total}</span>
        {filteredFrom !== null ? <span className="max-sm:hidden"> (filtered from {filteredFrom})</span> : null}
      </p>
      <div className="flex items-center gap-3">
        {pageSizeOptions.length > 1 && total > Math.min(...pageSizeOptions) ? (
          <label className="flex items-center gap-2 max-sm:hidden">
            Rows
            <select
              value={pageSize}
              onChange={(e) => onPageSize(Number(e.target.value))}
              className="min-h-9 rounded-md border border-border bg-surface px-2 text-sm text-text focus:border-button focus:outline-none"
            >
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {totalPages > 1 ? (
          <nav aria-label="Pagination" className="flex items-center gap-0.5">
            <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} className={`${pagerButton} hover:bg-surface-muted`}>
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <span className="px-2 sm:hidden">
              {page} / {totalPages}
            </span>
            {pageList(page, totalPages).map((p, i) =>
              p === '…' ? (
                <span key={`gap-${i}`} className="px-1 max-sm:hidden" aria-hidden="true">
                  …
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  onClick={() => onPage(p)}
                  aria-current={p === page ? 'page' : undefined}
                  aria-label={`Page ${p}`}
                  className={`${pagerButton} max-sm:hidden ${p === page ? 'bg-brand font-medium text-white' : 'text-text hover:bg-surface-muted'}`}
                >
                  {p}
                </button>
              ),
            )}
            <button type="button" aria-label="Next page" disabled={page >= totalPages} onClick={() => onPage(page + 1)} className={`${pagerButton} hover:bg-surface-muted`}>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </nav>
        ) : null}
      </div>
    </div>
  )
}

function toolbarButtonClass(active: boolean) {
  return `inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${
    active ? 'border-button/40 bg-indigo-soft text-button' : 'border-border bg-surface text-text hover:border-border-strong hover:bg-page-bg'
  }`
}

function FilterPanel<T>({
  columns,
  filters,
  columnSearch,
  onFilters,
  onColumnSearch,
  activeCount,
}: {
  columns: DataColumn<T>[]
  filters: Record<string, string[]>
  columnSearch: Record<string, string>
  onFilters: (f: Record<string, string[]>) => void
  onColumnSearch: (s: Record<string, string>) => void
  activeCount: number
}) {
  return (
    <Popover
      label="Filters"
      width="w-80"
      trigger={({ open, ...props }) => (
        <button {...props} className={toolbarButtonClass(open || activeCount > 0)}>
          <ListFilter size={16} aria-hidden="true" />
          Filters
          {activeCount > 0 ? <span className="rounded-full bg-button px-1.5 text-[11px] font-semibold tabular-nums text-white">{activeCount}</span> : null}
        </button>
      )}
    >
      <div className="max-h-[min(70vh,32rem)] divide-y divide-border-soft overflow-y-auto">
        {columns.map((c) => (
          <fieldset key={c.id} className="px-4 py-3">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">{c.header}</legend>
            {c.filter ? (
              <div className="space-y-0.5">
                {c.filter.options.length === 0 ? <p className="text-sm text-text-muted">No values yet.</p> : null}
                {c.filter.options.map((o) => {
                  const checked = (filters[c.id] ?? []).includes(o.value)
                  return (
                    <label key={o.value} className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-1.5 text-sm hover:bg-page-bg">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const current = filters[c.id] ?? []
                          onFilters({ ...filters, [c.id]: checked ? current.filter((v) => v !== o.value) : [...current, o.value] })
                        }}
                        className="h-4 w-4 rounded border-border-strong accent-button"
                      />
                      <span className="truncate">{o.label}</span>
                    </label>
                  )
                })}
              </div>
            ) : (
              <input
                type="text"
                value={columnSearch[c.id] ?? ''}
                onChange={(e) => onColumnSearch({ ...columnSearch, [c.id]: e.target.value })}
                placeholder={`${c.header} contains…`}
                aria-label={`${c.header} contains`}
                className="min-h-10 w-full rounded-lg border border-border-strong/70 bg-surface px-3 text-base focus:border-button focus:outline-none focus:ring-4 focus:ring-button/15 sm:text-sm"
              />
            )}
          </fieldset>
        ))}
      </div>
    </Popover>
  )
}

function ColumnsPanel<T>({ columns, hidden, onChange }: { columns: DataColumn<T>[]; hidden: Set<string>; onChange: (h: Set<string>) => void }) {
  const hideable = columns.filter((c) => c.hideable !== false)
  return (
    <Popover
      label="Visible columns"
      width="w-60"
      trigger={({ open, ...props }) => (
        <button {...props} className={toolbarButtonClass(open)} aria-label="Choose visible columns">
          <Columns3 size={16} aria-hidden="true" />
          <span className="max-lg:sr-only">Columns</span>
        </button>
      )}
    >
      <div className="p-2">
        <p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wider text-text-muted">Show columns</p>
        {hideable.map((c) => {
          const visible = !hidden.has(c.id)
          // Keep at least one hideable column on screen.
          const lastVisible = visible && hideable.filter((x) => !hidden.has(x.id)).length === 1
          return (
            <label key={c.id} className={`flex min-h-9 items-center gap-2.5 rounded-md px-2 text-sm ${lastVisible ? 'opacity-60' : 'cursor-pointer hover:bg-page-bg'}`}>
              <input
                type="checkbox"
                checked={visible}
                disabled={lastVisible}
                onChange={() => {
                  const next = new Set(hidden)
                  if (visible) next.add(c.id)
                  else next.delete(c.id)
                  onChange(next)
                }}
                className="h-4 w-4 rounded border-border-strong accent-button"
              />
              {c.header}
            </label>
          )
        })}
      </div>
    </Popover>
  )
}

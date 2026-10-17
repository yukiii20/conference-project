import type { ReactNode } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from './icons'
import { Skeleton } from './Spinner'
import { EmptyState } from './EmptyState'

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  className?: string
}

/**
 * Generic data table matching the app's existing header/row/border style
 * (used by, e.g., SuperAdminPage's conference/user lists). Wrap any custom
 * hand-rolled <table> in <TableContainer> instead to at least share the
 * outer border/overflow/empty/loading behaviour.
 */
export function TableContainer({ children, minWidth = 640 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-white">
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  )
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  emptyTitle = 'Nothing here yet',
  emptyMessage,
  minWidth = 640,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  loading?: boolean
  emptyTitle?: string
  emptyMessage?: string
  minWidth?: number
}) {
  return (
    <TableContainer minWidth={minWidth}>
      <thead>
        <tr className="border-b border-line text-ink/60">
          {columns.map((c) => (
            <th key={c.key} className={`px-4 py-2 font-medium ${c.className ?? ''}`}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <tr key={`skeleton-${i}`}>
              {columns.map((c) => (
                <td key={c.key} className="px-4 py-3">
                  <Skeleton className="h-4 w-full max-w-[160px]" />
                </td>
              ))}
            </tr>
          ))
        ) : rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className="px-4 py-2">
              <EmptyState title={emptyTitle} message={emptyMessage} />
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} className={`px-4 py-3 ${c.className ?? ''}`}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </TableContainer>
  )
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (totalPages <= 1) return null
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-ink/60">
      <span>
        {from}-{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="flex h-10 w-10 items-center justify-center rounded-md border border-line disabled:opacity-40"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <span className="px-2">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          aria-label="Next page"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="flex h-10 w-10 items-center justify-center rounded-md border border-line disabled:opacity-40"
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

import type { ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useDirtyGuard } from '../DirtyGuard'
import type { TabConfig } from '../sidebarConfig'

export type TabWithElement = TabConfig & { element: ReactNode }

/**
 * One sidebar "page" made of several tabs, each with its own URL
 * (`basePath/tabId`). Renders a horizontally-scrollable tab row (so it never
 * forces the page itself to scroll sideways on a narrow screen) and a nested
 * route per tab, defaulting to the first one.
 */
export function TabbedSection({ basePath, tabs }: { basePath: string; tabs: TabWithElement[] }) {
  const location = useLocation()
  const { confirmLeave } = useDirtyGuard()
  const currentId = location.pathname.slice(basePath.length + 1).split('/')[0]

  if (tabs.length === 0) return null

  function handleTabClick(e: React.MouseEvent, id: string) {
    if (id === currentId) return
    if (!confirmLeave()) {
      e.preventDefault()
    }
  }

  return (
    <div>
      <div className="overflow-x-auto border-b border-border">
        <div className="flex gap-1 whitespace-nowrap">
          {tabs.map((t) => {
            const active = t.id === currentId
            return (
              <Link
                key={t.id}
                to={`${basePath}/${t.id}`}
                onClick={(e) => handleTabClick(e, t.id)}
                aria-current={active ? 'true' : undefined}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                  active ? 'border-brand text-brand' : 'border-transparent text-text-muted hover:text-text'
                }`}
              >
                {t.label}
              </Link>
            )
          })}
        </div>
      </div>

      <Routes>
        <Route index element={<Navigate to={tabs[0]!.id} replace />} />
        {tabs.map((t) => (
          <Route key={t.id} path={t.id} element={t.element} />
        ))}
        <Route path="*" element={<Navigate to={tabs[0]!.id} replace />} />
      </Routes>
    </div>
  )
}

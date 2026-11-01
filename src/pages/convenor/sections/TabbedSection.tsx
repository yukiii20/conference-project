import type { ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
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
  const navigate = useNavigate()
  const { confirmLeave } = useDirtyGuard()
  const currentId = location.pathname.slice(basePath.length + 1).split('/')[0]

  if (tabs.length === 0) return null

  function handleTabClick(e: React.MouseEvent, id: string) {
    if (id === currentId) return
    if (!confirmLeave(() => navigate(`${basePath}/${id}`))) {
      e.preventDefault()
    }
  }

  return (
    <div>
      <nav aria-label="Section tabs" className="mb-8 overflow-x-auto border-b border-border-soft">
        <div className="flex gap-6 whitespace-nowrap">
          {tabs.map((t) => {
            const active = t.id === currentId
            return (
              <Link
                key={t.id}
                to={`${basePath}/${t.id}`}
                onClick={(e) => handleTabClick(e, t.id)}
                aria-current={active ? 'page' : undefined}
                className={`-mb-px border-b-2 px-0.5 py-3 text-sm font-medium transition-colors ${
                  active ? 'border-button text-brand' : 'border-transparent text-text-muted hover:border-border hover:text-text'
                }`}
              >
                {t.label}
              </Link>
            )
          })}
        </div>
      </nav>

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

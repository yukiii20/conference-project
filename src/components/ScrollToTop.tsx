import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Opens every new page at the top. Without this, client-side navigation keeps
 * the old scroll position (e.g. clicking a footer link lands at the bottom of
 * the next page). Links with a #hash are left alone so the target page can
 * scroll to that section itself, and query-string-only changes (filters,
 * ?member=) don't jump.
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) return
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname, hash])
  return null
}

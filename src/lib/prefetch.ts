/**
 * Warms the lazy-loaded chunk for wherever a successful sign-in is about to
 * navigate, so the portal shell's JS is already downloading while the
 * post-login redirect happens instead of only starting once the route
 * actually renders. Matching dynamic import paths as App.tsx's own lazy()
 * calls is what makes Vite/Rollup resolve both to the same chunk.
 */
export function prefetchPortalChunk(path: string | null | undefined): void {
  if (path === '/convenor' || path === '/manager') {
    import('../pages/ConvenorPage')
  } else if (path === '/portal') {
    import('../pages/PortalPage')
  } else if (path === '/super-admin') {
    import('../pages/SuperAdminPage')
  }
}

/**
 * On app start: when the page is opened directly at a signed-in area (e.g. a
 * bookmarked /portal), begin downloading its chunk right away, in parallel with
 * the /api/auth/me check, instead of only after that check finishes and the
 * route renders. This is what pushed /portal's LCP past the 2.5s target.
 */
export function prefetchForCurrentPath(pathname: string): void {
  const area = ['/convenor', '/manager', '/portal', '/super-admin'].find((p) => pathname === p || pathname.startsWith(`${p}/`))
  if (area && !pathname.startsWith('/super-admin/login')) prefetchPortalChunk(area)
}

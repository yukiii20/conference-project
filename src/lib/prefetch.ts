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

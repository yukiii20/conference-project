import { Skeleton } from './ui/Spinner'

/**
 * Shown by ProtectedRoute while the GET /api/auth/me permission check is in
 * flight — replaces a bare "Loading…" string with something that roughly
 * matches the shape every gated page actually has (header bar, sidebar,
 * content cards), so the transition from this to the real page doesn't
 * jump the layout around. Not pixel-perfect per page (convenor/portal/super
 * admin all differ slightly) - close enough that nothing visibly shifts.
 */
export function AppShellSkeleton() {
  return (
    <div className="min-h-screen bg-page-bg" aria-busy="true" aria-label="Loading">
      <div className="h-14 bg-brand" />
      <div className="mx-auto max-w-[1440px] px-6 py-8 sm:px-8">
        <Skeleton className="h-7 w-48" />
        <div className="mt-6 flex flex-col gap-8 md:flex-row">
          <div className="w-full shrink-0 space-y-2 md:w-56">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
          <div className="flex-1 space-y-4">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
            <Skeleton className="h-40 w-full" />
          </div>
        </div>
      </div>
    </div>
  )
}

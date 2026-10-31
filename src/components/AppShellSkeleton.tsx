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
    <div className="min-h-screen bg-page-bg md:flex" aria-busy="true" aria-label="Loading">
      <div className="hidden h-screen w-64 shrink-0 flex-col gap-3 bg-brand p-4 md:flex">
        <div className="h-8 w-36 animate-pulse rounded-md bg-white/10" />
        <div className="mt-6 h-10 animate-pulse rounded-lg bg-white/10" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-9 animate-pulse rounded-lg bg-white/5" />
        ))}
      </div>
      <div className="flex-1">
        <div className="h-16 border-b border-border-soft bg-surface" />
        <div className="mx-auto max-w-[1320px] px-4 py-8 sm:px-6 lg:px-10">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="mt-3 h-4 w-80 max-w-full" />
          <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="mt-6 h-56 w-full rounded-xl" />
        </div>
      </div>
    </div>
  )
}

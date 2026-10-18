import { Spinner } from './ui/Spinner'

/** Full-page loading fallback for a lazy-loaded route (React.lazy + Suspense). */
export function PageLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-ink/60">
      <Spinner size="lg" />
    </div>
  )
}

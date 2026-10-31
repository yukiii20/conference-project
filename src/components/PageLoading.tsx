import { Spinner } from './ui/Spinner'

/** Full-page loading fallback for a lazy-loaded route (React.lazy + Suspense). */
export function PageLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page-bg text-button">
      <Spinner size="lg" />
    </div>
  )
}

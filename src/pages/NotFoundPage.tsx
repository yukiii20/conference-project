import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-brand px-4 text-on-brand">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-on-brand/50">404</p>
        <h1 className="mt-2 text-3xl font-semibold">Page not found</h1>
        <p className="mt-3 text-on-brand/70">
          The page you're looking for doesn't exist, or may have moved.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/"
            className="rounded-md bg-surface px-5 py-2.5 font-medium text-brand hover:opacity-90"
          >
            Go to home
          </Link>
          <Link
            to="/#conferences"
            className="rounded-md border border-on-brand/40 px-5 py-2.5 font-medium text-on-brand hover:bg-white/10"
          >
            Browse conferences
          </Link>
        </div>
      </div>
    </div>
  )
}

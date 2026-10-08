import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-landing-navy-900 px-4 text-white">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-white/50">404</p>
        <h1 className="mt-2 text-3xl font-semibold">Page not found</h1>
        <p className="mt-3 text-white/70">
          The page you're looking for doesn't exist, or may have moved.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/"
            className="rounded-md bg-white px-5 py-2.5 font-medium text-landing-navy-900 hover:opacity-90"
          >
            Go to home
          </Link>
          <Link
            to="/#conferences"
            className="rounded-md border border-white/40 px-5 py-2.5 font-medium text-white hover:bg-white/10"
          >
            Browse conferences
          </Link>
        </div>
      </div>
    </div>
  )
}

import { Star } from 'lucide-react'

/**
 * The "add to My agenda" star shown on every programme session. `locked`
 * is for sessions that are on the agenda automatically (your own talk or a
 * session you chair) - shown filled but not toggleable, since unstarring
 * wouldn't remove them.
 */
export function StarButton({
  starred,
  locked = false,
  busy = false,
  onToggle,
  accent,
  sessionTitle,
}: {
  starred: boolean
  locked?: boolean
  busy?: boolean
  onToggle: () => void
  accent?: string
  sessionTitle: string
}) {
  const on = starred || locked
  const label = locked
    ? `${sessionTitle} is on your agenda automatically`
    : on
      ? `Remove ${sessionTitle} from My agenda`
      : `Add ${sessionTitle} to My agenda`
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy || locked}
      aria-pressed={on}
      aria-label={label}
      title={label}
      style={on && accent ? { color: accent } : undefined}
      className={`inline-flex min-h-10 min-w-10 items-center justify-center rounded-md hover:bg-text/5 disabled:cursor-default ${
        on ? (accent ? '' : 'text-brand') : 'text-text-muted'
      } ${busy ? 'opacity-50' : ''}`}
    >
      <Star aria-hidden className="h-5 w-5" fill={on ? 'currentColor' : 'none'} strokeWidth={2} />
    </button>
  )
}

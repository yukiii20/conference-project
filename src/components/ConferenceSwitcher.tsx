import { useCallback, useState } from 'react'
import { ArrowLeftRight, Check, Clock } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/authContext'
import { getRoleDefinition } from '../lib/roles'
import { publicImageUrl } from '../lib/storage'
import { resolveConferenceBrand } from '../lib/color'
import type { MyConferenceEntry } from '../lib/types'
import { Popover } from './ui/Popover'
import { Spinner } from './ui/Spinner'
import { Icon } from './ui/Icon'

type MyConferencesResponse = {
  current_conference_id: string | null
  conferences: MyConferenceEntry[]
}

/** The portal a conference opens in: convenor first, then manager, otherwise the shared portal. */
export function portalPathForRoles(roles: string[], slug: string): string {
  const base = roles.includes('convenor') ? '/convenor' : roles.includes('manager') ? '/manager' : '/portal'
  return `${base}?conference=${encodeURIComponent(slug)}`
}

function roleList(codes: string[]): string {
  return codes.map((code) => getRoleDefinition(code)?.label ?? code).join(', ')
}

function ConferenceMark({ entry }: { entry: MyConferenceEntry }) {
  const [failed, setFailed] = useState(false)
  const logoUrl = failed ? null : publicImageUrl(entry.logo_path)
  const brand = resolveConferenceBrand(entry.primary_color)
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        onError={() => setFailed(true)}
        className="h-9 w-9 flex-shrink-0 rounded-lg border border-border-soft bg-white object-contain p-0.5"
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-sm font-semibold"
      style={{ backgroundColor: brand.color, color: brand.onColor }}
    >
      {entry.name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

/**
 * "My conferences" in the portal header. Lists only conferences where the
 * person has an ACTIVE role (openable) plus ones where a request is still
 * pending ("Waiting for approval", not openable). Picking one ends the current
 * session and starts a new one bound to that conference — no password, since
 * they're already signed in — then opens that conference's portal.
 *
 * Hidden for platform-admin sessions (they use "View as admin" instead).
 */
export function ConferenceSwitcher() {
  const { conference, switchConference } = useAuth()
  const [data, setData] = useState<MyConferencesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [switchingId, setSwitchingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api.get<MyConferencesResponse>('/auth/my-conferences'))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load your conferences.")
    } finally {
      setLoading(false)
    }
  }, [])

  async function open(entry: MyConferenceEntry) {
    setSwitchingId(entry.conference_id)
    setError(null)
    try {
      const result = await switchConference(entry.conference_id)
      const roles = result.roles.map((r) => r.role_code)
      // Full page load so every portal view starts clean in the new conference.
      window.location.assign(portalPathForRoles(roles.length > 0 ? roles : entry.roles, entry.slug))
    } catch (err) {
      setSwitchingId(null)
      setError(err instanceof ApiError ? err.message : "Couldn't open that conference. Try again.")
    }
  }

  if (!conference) return null

  return (
    <Popover
      label="My conferences"
      width="w-80"
      trigger={({ open: isOpen, onClick, ...props }) => (
        <button
          {...props}
          onClick={() => {
            if (!isOpen) void load()
            onClick()
          }}
          title="My conferences"
          className="flex min-h-10 items-center gap-2 rounded-lg px-2 py-1 text-sm text-text transition-colors hover:bg-surface-muted"
        >
          <Icon icon={ArrowLeftRight} className="text-text-muted" />
          <span className="hidden max-w-[11rem] truncate font-medium lg:inline">{conference.name}</span>
          <span className="sr-only lg:hidden">My conferences</span>
        </button>
      )}
    >
      <div className="p-1.5">
        <p className="px-2.5 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wide text-text-muted">My conferences</p>

        {error ? <p className="mx-2.5 mb-2 rounded-md bg-danger/5 px-2.5 py-2 text-sm text-danger" role="alert">{error}</p> : null}

        {loading && !data ? (
          <div className="flex items-center gap-2 px-2.5 py-4 text-sm text-text-muted">
            <Spinner size="sm" /> Loading…
          </div>
        ) : null}

        {data && data.conferences.length === 0 ? (
          <p className="px-2.5 py-4 text-sm text-text-muted">You don't have a role at any other conference yet.</p>
        ) : null}

        {data ? (
          <ul className="max-h-80 space-y-0.5 overflow-y-auto">
            {data.conferences.map((entry) => {
              const openable = entry.roles.length > 0
              const busy = switchingId === entry.conference_id
              const body = (
                <>
                  <ConferenceMark entry={entry} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text">{entry.name}</span>
                    {openable ? (
                      <span className="block truncate text-xs text-text-muted">{roleList(entry.roles)}</span>
                    ) : null}
                    {entry.pending_roles.length > 0 ? (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-gold-ink">
                        <Icon icon={Clock} size={12} />
                        <span className="truncate">
                          {openable ? `${roleList(entry.pending_roles)}: ` : ''}Waiting for approval
                        </span>
                      </span>
                    ) : null}
                  </span>
                  {entry.is_current ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-success">
                      <Icon icon={Check} size={14} /> Current
                    </span>
                  ) : busy ? (
                    <Spinner size="sm" />
                  ) : null}
                </>
              )
              return (
                <li key={entry.conference_id}>
                  {openable && !entry.is_current ? (
                    <button
                      type="button"
                      disabled={switchingId !== null}
                      onClick={() => void open(entry)}
                      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-page-bg disabled:cursor-wait disabled:opacity-70"
                    >
                      {body}
                    </button>
                  ) : (
                    <div
                      className={`flex items-center gap-3 rounded-lg px-2.5 py-2 ${entry.is_current ? 'bg-page-bg' : 'opacity-75'}`}
                      aria-disabled={!entry.is_current}
                    >
                      {body}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
    </Popover>
  )
}

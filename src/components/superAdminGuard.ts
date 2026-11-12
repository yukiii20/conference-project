import type { SessionCheck } from '../lib/authContext'

export type GuardState = 'checking' | 'ok' | 'denied' | 'expired' | 'unreachable'

/**
 * Turns the result of the session check into what /super-admin/* should show.
 *
 * - confirmed admin                               -> the page
 * - server unreachable, last known answer = admin -> the page (the server still checks every request)
 * - server unreachable, nothing known             -> "Could not reach the server" (never "not found")
 * - signed out, but this tab had an admin session -> "Your admin session expired"
 * - anything else (visitor, signed-in non-admin)  -> the generic not-found page (masking kept)
 */
export function resolveGuardState(result: SessionCheck, hadAdminSessionInThisTab: boolean): Exclude<GuardState, 'checking'> {
  if (result.status === 'signed_in') return result.data.isAdmin ? 'ok' : 'denied'
  if (result.status === 'unreachable') return result.lastKnown?.isAdmin ? 'ok' : 'unreachable'
  return hadAdminSessionInThisTab ? 'expired' : 'denied'
}

// Per-tab marker (sessionStorage): "an admin session was confirmed in this tab". It carries no
// privilege - it only chooses between two messages for someone the server has already signed out.
const ADMIN_SESSION_MARKER = 'cms:sa-session'

export function rememberAdminSession(): void {
  try {
    sessionStorage.setItem(ADMIN_SESSION_MARKER, '1')
  } catch {
    // sessionStorage unavailable: an expired session then shows the generic page, as before.
  }
}

export function forgetAdminSession(): void {
  try {
    sessionStorage.removeItem(ADMIN_SESSION_MARKER)
  } catch {
    // nothing to forget
  }
}

export function hadAdminSession(): boolean {
  try {
    return sessionStorage.getItem(ADMIN_SESSION_MARKER) === '1'
  } catch {
    return false
  }
}

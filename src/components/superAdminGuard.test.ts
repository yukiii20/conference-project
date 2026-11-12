import { describe, expect, it } from 'vitest'
import type { MeResponse } from '../lib/authContext'
import { resolveGuardState } from './superAdminGuard'

const me = (isAdmin: boolean) => ({ user: { id: 'u1' }, roles: [], isAdmin, conference: null }) as unknown as MeResponse

describe('resolveGuardState (what /super-admin shows after the session check)', () => {
  it('shows the page to a confirmed admin', () => {
    expect(resolveGuardState({ status: 'signed_in', data: me(true) }, false)).toBe('ok')
  })

  it('keeps the masked not-found page for a signed-in non-admin, even in a tab that once had an admin session', () => {
    expect(resolveGuardState({ status: 'signed_in', data: me(false) }, false)).toBe('denied')
    expect(resolveGuardState({ status: 'signed_in', data: me(false) }, true)).toBe('denied')
  })

  it('keeps the masked not-found page for a visitor who was never an admin here', () => {
    expect(resolveGuardState({ status: 'signed_out' }, false)).toBe('denied')
  })

  it('says the session expired when this tab had an admin session that the server has ended', () => {
    expect(resolveGuardState({ status: 'signed_out' }, true)).toBe('expired')
  })

  it('never shows not-found for a temporary failure (server waking up, 502, network)', () => {
    expect(resolveGuardState({ status: 'unreachable', lastKnown: null }, false)).toBe('unreachable')
    expect(resolveGuardState({ status: 'unreachable', lastKnown: null }, true)).toBe('unreachable')
    expect(resolveGuardState({ status: 'unreachable', lastKnown: me(false) }, true)).toBe('unreachable')
  })

  it('keeps an admin on the page when the server is unreachable but was last known to accept them', () => {
    expect(resolveGuardState({ status: 'unreachable', lastKnown: me(true) }, true)).toBe('ok')
  })
})

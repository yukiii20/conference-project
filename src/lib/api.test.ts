import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, clearApiCacheForTesting } from './api'

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
    json: async () => body,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  clearApiCacheForTesting()
})

describe('api GET cache', () => {
  it('serves a repeated GET for the same URL from cache instead of refetching', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ value: 1 }))
    vi.stubGlobal('fetch', fetchMock)

    const first = await api.get('/widgets')
    const second = await api.get('/widgets')

    expect(first).toEqual({ value: 1 })
    expect(second).toEqual({ value: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('dedupes two concurrent GETs for the same URL into a single network request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ value: 2 }))
    vi.stubGlobal('fetch', fetchMock)

    const [a, b] = await Promise.all([api.get('/concurrent'), api.get('/concurrent')])

    expect(a).toEqual({ value: 2 })
    expect(b).toEqual({ value: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('invalidates the cache after a write, so the next GET fetches fresh data', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ value: 'old' }))
      .mockResolvedValueOnce(jsonResponse({ message: 'updated' }))
      .mockResolvedValueOnce(jsonResponse({ value: 'new' }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await api.get('/thing')).toEqual({ value: 'old' })
    await api.post('/thing', { value: 'new' })
    expect(await api.get('/thing')).toEqual({ value: 'new' })

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('caches GET requests separately per query string', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ value: 'a' }))
      .mockResolvedValueOnce(jsonResponse({ value: 'b' }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await api.get('/search', { q: 'a' })).toEqual({ value: 'a' })
    expect(await api.get('/search', { q: 'b' })).toEqual({ value: 'b' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('api GET cache vs. a save (date saved once must stay saved)', () => {
  it('never caches or shares a GET that started before a write finished', async () => {
    let releaseStaleGet: (() => void) | null = null
    let serverValue = 'old-date'
    const fetchMock = vi.fn(async (_url: string, init?: { method?: string }) => {
      if (init?.method && init.method !== 'GET') {
        serverValue = 'new-date'
        return jsonResponse({ ok: true })
      }
      const answer = serverValue
      // The first GET is slow (e.g. Render waking up): it answers after the save.
      if (fetchMock.mock.calls.length === 1) await new Promise<void>((resolve) => (releaseStaleGet = resolve))
      return jsonResponse({ date: answer })
    })
    vi.stubGlobal('fetch', fetchMock)

    const staleGet = api.get<{ date: string }>('/conferences/c1/details')
    await api.patch('/conferences/c1', { start_date: 'new-date' })
    // A tab mounting right after the save must not join the old in-flight request...
    const afterSave = api.get<{ date: string }>('/conferences/c1/details')
    releaseStaleGet!()
    expect((await staleGet).date).toBe('old-date')
    expect((await afterSave).date).toBe('new-date')
    // ...and the old answer must not have been put back into the cache.
    expect((await api.get<{ date: string }>('/conferences/c1/details')).date).toBe('new-date')
  })
})

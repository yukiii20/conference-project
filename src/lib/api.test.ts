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

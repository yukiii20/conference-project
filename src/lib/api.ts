export const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

/**
 * Set while an admin is browsing a conference's convenor portal in
 * "View as admin" (read-only) mode — every request carries a header the
 * server rejects on any write, regardless of the admin's usual permission
 * bypass. Cleared the moment the admin leaves that view.
 */
let adminViewAsActive = false

export function setAdminViewAs(active: boolean): void {
  adminViewAsActive = active
}

export function isAdminViewAs(): boolean {
  return adminViewAsActive
}

// Short-lived per-session cache for GET responses, so switching between
// tabs that re-mount the same component (e.g. convenor sidebar nav) doesn't
// always pay a fresh round trip for data that hasn't changed. Cleared
// wholesale on every write (POST/PATCH/PUT/DELETE/upload) so nothing stays
// stale past the next action the visitor actually takes - the TTL below is
// just a bound on how long a read-only navigation can see slightly old data.
const GET_CACHE_TTL_MS = 20_000
const getCache = new Map<string, { data: unknown; expiresAt: number }>()
// Two callers racing to fetch the same URL at the same instant (e.g. the
// notification bell and the notifications tab both mounting at once) await
// the one request already in flight instead of each firing their own.
const pendingGets = new Map<string, Promise<unknown>>()

function clearGetCache(): void {
  getCache.clear()
}

export class ApiError extends Error {
  status: number
  fields?: Record<string, string>
  /** Machine-readable reason from the server (e.g. 'no_role_at_conference', 'account_exists', 'wrong_conference'). */
  code?: string

  constructor(status: number, message: string, fields?: Record<string, string>, code?: string) {
    super(message)
    this.status = status
    this.fields = fields
    this.code = code
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  query?: Record<string, string | undefined>
}

function buildUrl(path: string, query?: Record<string, string | undefined>): string {
  const url = `${API_BASE}${path}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, value)
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

// Render's free tier can take up to ~50s to wake a sleeping instance - a
// request stuck past this long is almost certainly that, not a normal slow
// query. Anything that cares (see SlowRequestBanner) can subscribe here
// instead of guessing from timing itself.
const SLOW_REQUEST_MS = 5_000
type SlowRequestListener = (isSlow: boolean) => void
const slowRequestListeners = new Set<SlowRequestListener>()
let slowRequestCount = 0

/** Subscribes to "is at least one request currently past the slow threshold" — returns an unsubscribe function. */
export function onSlowRequest(listener: SlowRequestListener): () => void {
  slowRequestListeners.add(listener)
  return () => {
    slowRequestListeners.delete(listener)
  }
}

function setSlowRequestCount(next: number): void {
  const wasSlow = slowRequestCount > 0
  slowRequestCount = next
  const isSlow = slowRequestCount > 0
  if (wasSlow !== isSlow) {
    for (const listener of slowRequestListeners) listener(isSlow)
  }
}

/** Wraps a fetch promise so SlowRequestBanner finds out if it's still pending after SLOW_REQUEST_MS — never affects the request itself (no abort, no real timeout). */
function trackSlowRequest<T>(promise: Promise<T>): Promise<T> {
  let firedSlow = false
  const timer = setTimeout(() => {
    firedSlow = true
    setSlowRequestCount(slowRequestCount + 1)
  }, SLOW_REQUEST_MS)
  return promise.finally(() => {
    clearTimeout(timer)
    if (firedSlow) setSlowRequestCount(slowRequestCount - 1)
  })
}

/**
 * Thin fetch wrapper for the new Node/Express backend. Always sends cookies
 * (the session lives in an httpOnly cookie, never in JS) and throws ApiError
 * with the server's { error: { message, fields? } } body on non-2xx.
 */
async function performFetch(url: string, method: string, options: RequestOptions): Promise<unknown> {
  const headers: Record<string, string> = {}
  if (options.body) headers['Content-Type'] = 'application/json'
  if (adminViewAsActive) headers['X-Admin-View-As'] = '1'

  const res = await trackSlowRequest(
    fetch(url, {
      method,
      credentials: 'include',
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    }),
  )

  const isJson = res.headers.get('content-type')?.includes('application/json')
  const data = isJson ? await res.json().catch(() => null) : null

  if (!res.ok) {
    const message = data?.error?.message ?? 'Something went wrong. Please try again.'
    throw new ApiError(res.status, message, data?.error?.fields, data?.error?.code)
  }

  return data
}

async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const url = buildUrl(path, options.query)

  if (method !== 'GET') {
    const data = await performFetch(url, method, options)
    clearGetCache()
    return data as T
  }

  const cached = getCache.get(url)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as T
  }

  const pending = pendingGets.get(url)
  if (pending) {
    return pending as Promise<T>
  }

  const request = performFetch(url, method, options)
    .then((data) => {
      getCache.set(url, { data, expiresAt: Date.now() + GET_CACHE_TTL_MS })
      return data
    })
    .finally(() => {
      pendingGets.delete(url)
    })
  pendingGets.set(url, request)
  return request as Promise<T>
}

/** POSTs a multipart/form-data body (file uploads) — never JSON-encoded, so the browser sets its own boundary header. */
async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const res = await trackSlowRequest(
    fetch(buildUrl(path), {
      method: 'POST',
      credentials: 'include',
      headers: adminViewAsActive ? { 'X-Admin-View-As': '1' } : undefined,
      body: formData,
    }),
  )

  const isJson = res.headers.get('content-type')?.includes('application/json')
  const data = isJson ? await res.json().catch(() => null) : null

  if (!res.ok) {
    const message = data?.error?.message ?? 'Something went wrong. Please try again.'
    throw new ApiError(res.status, message, data?.error?.fields, data?.error?.code)
  }

  clearGetCache()
  return data as T
}

/** Test-only seam: lets tests start each case with a clean cache instead of leaking state between them. */
export function clearApiCacheForTesting(): void {
  clearGetCache()
  pendingGets.clear()
}

export const api = {
  get: <T>(path: string, query?: Record<string, string | undefined>) => apiRequest<T>(path, { method: 'GET', query }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  del: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) => apiUpload<T>(path, formData),
}

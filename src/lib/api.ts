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

export class ApiError extends Error {
  status: number
  fields?: Record<string, string>

  constructor(status: number, message: string, fields?: Record<string, string>) {
    super(message)
    this.status = status
    this.fields = fields
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

/**
 * Thin fetch wrapper for the new Node/Express backend. Always sends cookies
 * (the session lives in an httpOnly cookie, never in JS) and throws ApiError
 * with the server's { error: { message, fields? } } body on non-2xx.
 */
async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.body) headers['Content-Type'] = 'application/json'
  if (adminViewAsActive) headers['X-Admin-View-As'] = '1'

  const res = await fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  const isJson = res.headers.get('content-type')?.includes('application/json')
  const data = isJson ? await res.json().catch(() => null) : null

  if (!res.ok) {
    const message = data?.error?.message ?? 'Something went wrong. Please try again.'
    throw new ApiError(res.status, message, data?.error?.fields)
  }

  return data as T
}

/** POSTs a multipart/form-data body (file uploads) — never JSON-encoded, so the browser sets its own boundary header. */
async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: 'POST',
    credentials: 'include',
    headers: adminViewAsActive ? { 'X-Admin-View-As': '1' } : undefined,
    body: formData,
  })

  const isJson = res.headers.get('content-type')?.includes('application/json')
  const data = isJson ? await res.json().catch(() => null) : null

  if (!res.ok) {
    const message = data?.error?.message ?? 'Something went wrong. Please try again.'
    throw new ApiError(res.status, message, data?.error?.fields)
  }

  return data as T
}

export const api = {
  get: <T>(path: string, query?: Record<string, string | undefined>) => apiRequest<T>(path, { method: 'GET', query }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  del: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) => apiUpload<T>(path, formData),
}

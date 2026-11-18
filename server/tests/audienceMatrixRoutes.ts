import type { Express } from 'express'

/** A route as mounted on the real app: "GET /api/conferences/:id/audience/programme" plus its guard names. */
export type MountedRoute = { method: string; path: string; key: string; middlewareNames: string[] }

type Layer = {
  name: string
  regexp: RegExp
  handle: { stack?: Layer[] }
  route?: { path: string; methods: Record<string, boolean>; stack: Array<{ name: string }> }
}

/** "/^\/api\/conferences\/?(?=\/|$)/i" -> "/api/conferences" (Express 4 static mount prefixes only). */
function prefixOf(regexp: RegExp): string | null {
  const src = regexp.source
  if (src === '^\\/?(?=\\/|$)') return ''
  const m = src.match(/^\^((?:\\\/[A-Za-z0-9_.-]+)+)\\\/\?\(\?=\\\/\|\$\)$/)
  return m ? m[1]!.replace(/\\\//g, '/') : null
}

/** Every route of the app (routers mounted with app.use(prefix, router), one level deep). */
export function listMountedRoutes(app: Express): MountedRoute[] {
  const out: MountedRoute[] = []
  const stack = (app as unknown as { _router: { stack: Layer[] } })._router.stack
  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        const m = method.toUpperCase()
        out.push({ method: m, path: layer.route.path, key: `${m} ${layer.route.path}`, middlewareNames: layer.route.stack.map((s) => s.name) })
      }
      continue
    }
    if (layer.name !== 'router' || !layer.handle.stack) continue
    const prefix = prefixOf(layer.regexp)
    if (prefix === null) continue
    for (const inner of layer.handle.stack) {
      if (!inner.route) continue
      for (const method of Object.keys(inner.route.methods)) {
        const m = method.toUpperCase()
        const path = `${prefix}${inner.route.path === '/' ? '' : inner.route.path}` || '/'
        out.push({ method: m, path, key: `${m} ${path}`, middlewareNames: inner.route.stack.map((s) => s.name) })
      }
    }
  }
  return out
}

/** Fills route parameters: :id -> the conference, :slug -> its slug, anything else -> a random UUID. */
export function fillPath(path: string, values: { conferenceId: string; slug: string }): string {
  return path.replace(/:([A-Za-z_]+)(\([^)]*\))?\??/g, (_m, name: string) => {
    if (name === 'id' || name === 'conferenceId') return values.conferenceId
    if (name === 'slug') return values.slug
    if (name === 'token') return 'x'.repeat(32)
    return crypto.randomUUID()
  })
}

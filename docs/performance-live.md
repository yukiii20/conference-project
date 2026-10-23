# Live site performance - Step 9

Measurements below were taken against the **local throwaway test server**
(`conference_cms_test` DB, same machine, loopback network) — see
`docs/phase4-test-steps.md` for how that server is started. Loopback numbers
are not representative of the live Vercel/Render/Aiven latency (there's no
network hop), but they do answer the question this step cares about: is the
app itself doing unnecessary work (serial queries, missing indexes, no
compression, repeated fetches)? The honest answer for the live site's
*actual* slowness is mostly outside the code — see "What you need to check
outside the code" below.

## Backend: what was measured and fixed

| Call | Before | After | What changed |
|---|---|---|---|
| `GET /api/conferences/:slug` (public conference page) | 6 sequential queries | 1 round trip (`Promise.all` over the 6 independent reads; the 7th, committee members, still runs after since it depends on the others) | `server/src/modules/conferences/service.ts` |
| `GET /api/health` | already parallel | unchanged | — |
| Every JSON response | uncompressed | gzip via `compression` middleware (default 1kb threshold) | `server/src/app.ts` |
| Public, read-only GETs (`/conferences/public`, `/conferences/:slug`, `/public-deadlines`, `/public-track-count`, `/platform-settings`, `/:id/sessions/public`) | `Cache-Control` absent (browser/CDN always revalidates) | `Cache-Control: public, max-age=60, stale-while-revalidate=300` | `conferences/routes.ts`, `conferences/publicExtras.routes.ts`, `platformSettings/routes.ts`, `schedule/routes.ts` — never applied to anything behind auth |
| DB pool connections to Aiven | no keep-alive — an idle pooled connection silently dropped by a NAT/firewall pays a full reconnect (TLS handshake on a cross-region pair) on the next request | `enableKeepAlive: true`, `keepAliveInitialDelay: 10_000` (TCP probes every 10s) | `server/src/db/pool.ts` |
| DB pool size | — | `DB_POOL_SIZE=20` (documented in `server/.env.example`) | unchanged this step, just confirmed documented |
| bcrypt cost | 12 | 12 (unchanged — already ≥10, not touched) | `server/src/modules/auth/service.ts` |

Loopback timings after the above (local test server, `conference_cms_test`,
cold vs. warm where relevant):

```
POST /api/auth/login                         316 ms   (bcrypt.compare at cost 12 — expected, not a bug)
GET  /api/auth/me                               6 ms
GET  /api/conferences/public                    2 ms
GET  /api/conferences/e2e-conf                  4 ms   (was 6 sequential queries before Promise.all)
GET  /api/conferences/:id/dashboard             6 ms   (cold and warm — no meaningful difference locally)
GET  /api/conferences/:id/sessions/public       5 ms
GET  /api/platform-settings                     7 ms
GET  /api/me/notifications                      4 ms
```

Confirmed via `curl -D -`: every public GET above now returns
`Cache-Control: public, max-age=60, stale-while-revalidate=300`, and
`Content-Encoding: gzip` is present with `Accept-Encoding: gzip`.

Everything except login is already sub-10ms locally — there was no
meaningful N+1 problem left once the public conference page's 6 queries were
parallelized (checked every other list/dashboard endpoint; none had
sequential independent queries worth batching). Login's 300ms is bcrypt
doing its job at cost 12 and is deliberately not optimized away (see
"bcrypt cost" above — the task was explicit: don't lower it).

## Frontend

- `src/lib/api.ts`: short-lived (20s) per-session GET cache, keyed by URL,
  cleared on every write. A second `pendingGets` map de-dupes two concurrent
  callers requesting the same URL (e.g. the notification bell and the
  notifications tab both mounting at once) into one network request instead
  of two. Covered by `src/lib/api.test.ts` (cache hit, concurrent dedupe,
  write invalidation, per-query-string isolation).
- `src/lib/prefetch.ts`: `prefetchPortalChunk()` fires the lazy `import()`
  for the portal/convenor/super-admin chunk the moment login succeeds,
  instead of waiting for the route to render — the chunk is already
  downloading during the post-login redirect. Wired into `SignInForm.tsx`
  and `SuperAdminLoginPage.tsx`.
- Notification polling: already 60s (`src/components/NotificationBell.tsx`,
  `POLL_MS = 60_000`) — confirmed, not changed.
- No duplicate `/me` polling found.

## Bundle size (Lucide icon migration)

Main entry chunk, built with `vite build` (`npm run build`), before (last
commit, hand-written SVG icon set) vs. after (Lucide, individually imported
per icon for tree-shaking):

| | Before | After | Delta |
|---|---|---|---|
| `dist/assets/index-*.js` (raw) | 507.62 kB | 507.77 kB | +0.15 kB |
| `dist/assets/index-*.js` (gzip) | 148.32 kB | 148.67 kB | +0.35 kB |

Negligible — tree-shaking individual named imports (`import { Eye } from
'lucide-react'`, never `import * as Icons`) kept the swap essentially free.
(`CheckInPanel`, `ConvenorPage`, `SuperAdminPage`, `PortalPage` and a few
other lazy chunks grew a few kB each from their own new icon imports plus
the dashboard layout rework — all independently lazy-loaded, not part of
the initial bundle.)

## What you need to check outside the code

1. **Render/Aiven region.** `/api/health`'s `database.latency_ms` on the
   *live* deployment was reported around 244 ms — that's a cross-region
   round trip, not something code can fix. Check Aiven's console: **Service
   settings → Cloud and region**. If it doesn't match Render's region
   (**Dashboard → your service → Settings → Region**), either recreate the
   Render service in Aiven's region (free, just redeploy) or migrate the
   Aiven service to Render's region (Aiven supports migrating a running
   service to a new region/cloud from the same console page — no new
   credentials needed, the hostname stays the same). Same-region should
   drop that 244 ms to low single digits.
2. **Render free tier sleeps after 15 minutes of inactivity** (≈50s cold
   start on the next request) and runs on 0.1 shared CPU. Two options,
   neither requires code changes:
   - Free: a free uptime monitor (e.g. UptimeRobot) pinging
     `GET /api/health` every 10 minutes keeps the instance warm. Costs
     nothing, but is against Render's free-tier spirit and doesn't help the
     very first visitor after a deploy.
   - Paid: upgrade to Render's **Starter** plan (currently $7/mo) — no
     sleep, dedicated CPU, resolves both the cold start and the 0.1 CPU
     ceiling at once.

Neither of these is something this step's code change can fix — they're
infrastructure/plan choices, written here per the task's instruction to
report them rather than silently skip them.

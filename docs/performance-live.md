# Live site performance

This version of the doc replaces an earlier one written during the
icons/layout/speed step, which covered that step's own backend fixes
(response compression, parallelized public-conference-page queries, short
`Cache-Control` on public reads, a keep-alive DB pool) — those changes are
still live in the code; the full writeup of them is preserved in
`docs/progress.md`'s entry for that step, not repeated here.

Two kinds of measurement live in *this* version: this step's own timing of
the real, public, read-only endpoints of the deployed site itself
(`https://conference-project-eta.vercel.app`) — no login, no data created,
no load testing, exactly as instructed — and a local measurement pass
against a throwaway test server, which answers a different question: is
the app doing unnecessary work (serial queries, missing indexes, no
compression)? Loopback numbers aren't comparable to the live ones — there's
no network hop locally.

## The live site, measured directly

Five requests each, `curl -w '%{time_total}'`, from this laptop, no
authentication, nothing written. "Cold" means the first request after Render's
instance had gone to sleep from 15 minutes of inactivity; "warm" means
back-to-back requests with the instance already awake.

### Home page (`/`) — served by Vercel, not Render

```
0.430s, 0.470s, 0.464s, 0.434s, 1.046s (first-ever request, includes DNS/TLS setup)
```

Consistently fast and has nothing to do with Render — this is a static
build served from Vercel's CDN, confirmed by `vercel.json`'s long-cache
headers on `/assets/*`.

### `GET /api/health` — hits Render directly, the one true cold-start signal

Two separate cold starts were caught during this step (naturally, not
forced — Render was idle between test runs):

```
Cold start #1:  502 Bad Gateway  (Vercel's rewrite gave up before Render finished booting)
                then 33.1s        (next request, same cold boot, this one succeeded)
Cold start #2:  22.8s             (clean this time, no 502)
Warm (5 back-to-back): 0.55s, 0.55s, 0.56s, 0.55s, 0.67s / 0.55s, 0.77s, 0.52s
```

**The 502 on cold start #1 is the real finding, not just "it's slow."** The
very first visitor after 15 minutes of nobody using the site can get an
actual error page instead of a slow-but-working one, if Vercel's proxy times
out before Render finishes waking up. This is exactly what "Render free tier
sleeps" means in practice — see the ranked list of outside actions below.

`database.latency_ms` from the health body was **243ms and 249ms** across
the two cold starts and stayed close to that on every other call that
touched the database — see the region explanation below.

### Public conference list (`/api/conferences/public`)

```
0.546s (first call this session, Render already warm by then), 0.176s, 0.168s, 0.187s, 0.217s
```

### Public conference page (`/api/conferences/ai`, a real published conference)

```
2.365s (one-off, see note), 0.192s, 0.179s, 0.168s, 0.175s
```

The one 2.4s outlier wasn't reproduced on any other call to any endpoint in
this session — most likely a one-off network blip between this laptop and
Vercel's edge, not a server-side pattern (every other request to the same
endpoint, including the one right after, was ~0.17s).

### Plain-English breakdown of what "slow" is made of on the live site

- **Render cold start (≈23-33s, once per 15+ minutes of inactivity):** the
  single biggest number by far, and the only one that can produce an actual
  502 rather than just a wait. This is Render spinning up a fresh container
  from nothing — nothing in this app's code runs during most of that time.
- **Render CPU (0.1 shared vCPU on the free plan):** not very visible in
  these numbers because every request here was sequential, one at a time —
  this mostly bites under *concurrent* load (several visitors at once),
  which this step was explicitly told not to generate.
- **Vercel → Render hop:** the gap between Vercel's own response time (the
  home page, ~0.2-0.4s baseline for a cold TLS handshake) and a warm
  `/api/health` call (~0.5-0.7s) — call it roughly 100-300ms of proxy +
  network overhead on top of whatever Render itself takes.
- **Render → Aiven database distance (≈245ms, every single DB-touching
  call):** the single most fixable number here, and it shows up on *every*
  warm request that touches the database, not just cold ones — a same-region
  pair would turn this into low single digits. See action #1 below.

## Local measurement and backend/frontend fixes (this step)

Measured against the local throwaway test server (`conference_cms_test`,
same machine — see `docs/phase4-test-steps.md`). Every page's main API
call(s) were timed per role; the slowest ones found, and what was actually
fixed:

| Endpoint | Role | Local time | Queries | Finding / fix |
|---|---|---|---|---|
| `GET /conferences/:id/attendance/dashboard` | convenor/staff | 43ms → ~10ms | 4 sequential → 1 + 3 parallel | **Fixed.** `timezone` has to resolve first (today's date-key depends on it), but the registered-count/today-count/per-session-count queries after it were running one after another for no reason — now `Promise.all`'d. `server/src/modules/registration/service.ts` |
| `GET /conferences/:id/dashboard` | convenor | ~30ms | 16 (already parallel) | Already fixed in an earlier step; extended this step with 6 more queries (setup checklist + pending registrations) — still one `Promise.all`, so the round-trip count didn't change. |
| `GET /conferences/:id/members` | convenor | ~27ms | 1 | Looked like an outlier, turned out to be one clean query — not a real issue, just normal pool/JIT variance on a cold-ish connection. |
| Every other endpoint timed per role (`/auth/me`, `/me/notifications`, `/conferences/:id/registrations`, `/submissions`, `/role-requests`, `/sessions`, `/activity-log`, `/me/certificates`, `/reviewer/assignments`, `/me/chair-sessions`, author's `/my-registration`) | all | <20ms | 1 each | Already fine — no sequential independent queries found. |

**The frontend request waterfall worth fixing wasn't an API call — it was
`ProtectedRoute`.** Every gated page (convenor, portal, super admin) only
rendered its own content — and only *then* started its own data fetch —
after `GET /api/auth/me` resolved, showing a bare "Loading…" string the
whole time. That's a real sequential wait (auth check, *then* the page's own
request), and the loading state itself violated "skeletons instantly, no
flash of no-data." Fixed with `src/components/AppShellSkeleton.tsx` (swapped
in for the bare text in `src/components/ProtectedRoute.tsx`) — doesn't
remove the wait (the auth check is a real permission gate, not something to
skip), but makes it look like a page loading instead of a blank stall, and
keeps the eventual layout from jumping.

No new database index was needed — every endpoint measured was already
sub-50ms locally with no sequential-query pattern left after the
attendance-dashboard fix above, so there was no slow query to build an
index for. (If the *live* site's per-query ~245ms is ever fixed by a region
move and something still comes out slow after that, that's the moment to
revisit this — not before, since an index for a query that isn't actually
slow just adds write overhead for nothing.)

### Debounce and request-waterfall cleanup found while measuring

- **Three search inputs fired an API call on every keystroke, not
  debounced at all:** `RegistrationsList` (convenor Attendance tab and
  staff desk), `MembersTab`'s people search, and `ActivityLogTab`'s action
  filter. All three now debounce at 300ms (`src/components/attendance/RegistrationsList.tsx`,
  `src/pages/convenor/MembersTab.tsx`, `src/pages/convenor/ActivityLogTab.tsx`).
  Everything else that searches (admin Users, admin Appoint-convenor, the
  check-in panel's code/name lookup) was already debounced — normalized the
  check-in panel's 250ms to the same 300ms as everywhere else.
- **"Waking up the server" message:** `src/lib/api.ts` now tracks how long
  each request has been pending; past 5 seconds (Render's free-tier cold
  start is the only realistic cause locally this would never trigger, since
  nothing here takes 5s) a small banner
  (`src/components/SlowRequestBanner.tsx`) appears across the top of the
  page and clears itself the moment the request settles — instead of a
  stuck, unexplained blank screen.
- GET cache (20s, per-session), concurrent-request de-dupe, and
  `prefetchPortalChunk()` on login were all already in place from an
  earlier step and are unchanged.
- Notification polling confirmed still at 60s, no duplicate `/me` polling.

## Bundle size

Main entry chunk, `vite build`:

| | Before this step | After this step |
|---|---|---|
| `dist/assets/index-*.js` (raw) | 507.94 kB | 509.92 kB |
| `dist/assets/index-*.js` (gzip) | 148.79 kB | 149.39 kB |

+~2 kB raw / +0.6 kB gzip for the slow-request banner, app-shell skeleton,
and this step's other shared-module additions (humanize.ts, etc.) — all in
the main chunk since they're used from the very first gated page a visitor
hits. Negligible in absolute terms.

## What you need to check outside the code — ranked by impact

1. **Render/Aiven region mismatch — fixes the ~245ms-per-query number seen
   on every single database-touching request.** Check Aiven's console:
   **Service settings → Cloud and region**, compare against Render's
   **Dashboard → your service → Settings → Region**. If they don't match,
   either recreate the Render service in Aiven's region (free, just
   redeploy) or migrate the Aiven service to Render's region (Aiven
   supports migrating a running service in-place from that same console
   page — same hostname, no new credentials). This is the single biggest
   lever available outside the code: it would shave ~245ms off *every*
   request that touches the database, not just the slow ones.
2. **Render free tier sleeps after 15 minutes idle (≈23-33s cold start,
   and the first request after that can be a 502 rather than just slow —
   see the "cold start #1" measurement above).** Two options, neither needs
   a code change:
   - Free: an uptime monitor (e.g. UptimeRobot) pinging `GET /api/health`
     every 10 minutes keeps the instance warm. Costs nothing, but is
     against Render's free-tier spirit and doesn't help the very first
     visitor after a deploy (before the monitor's first ping lands).
   - Paid: Render's **Starter** plan (currently $7/mo) — no sleep,
     dedicated CPU, fixes both the cold start *and* the 0.1-shared-vCPU
     ceiling at once.
3. **Render's 0.1 shared vCPU** only really shows up under concurrent load
   (several visitors at once), which this step deliberately didn't
   generate (no load testing, per the task). Worth knowing it's there if
   the site ever feels slow with real simultaneous traffic even once #1
   and #2 above are addressed — same Starter-plan fix as #2 covers it.

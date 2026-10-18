# Load testing (k6)

Scripts here hit the backend API directly (not through Vite), against the
**throwaway e2e test backend on :4100 / conference_cms_test** — never the
real dev server on :4000 and never the real database. Use seeded test users
only (`server/tests/e2eSeed.ts`).

## Setup (once per run)

```bash
cd server
npx tsx tests/e2eSeed.ts
DB_NAME=conference_cms_test NODE_ENV=test STORAGE_ROOT=storage-test-e2e \
  CLIENT_ORIGIN=http://localhost:5273 PORT=4100 npm run dev
```

(The frontend dev server isn't needed — these scripts call the JSON API
directly. Rate limits are already skipped under `NODE_ENV=test`, same as
the Vitest/Playwright suites — see `server/src/middleware/rateLimit.ts`.)

## Running

```bash
k6 run load/scenario.js
```

Override the ramp with environment variables, e.g. a quick smoke run:

```bash
k6 run -e VUS_LIST=5,10 -e STAGE_SECONDS=15 load/scenario.js
```

Default ramp (per `docs/finish-8-production-ready.md` Phase 7): 10 → 50 →
100 → 200 virtual users, 30s per step, each sustained for 1 minute.

## What it does

Three weighted scenarios, run together (not sequentially), matching the
doc's required flows:

- **browse** (public, no login): home page's conference list, then one
  conference's public detail page — the read path every real visitor hits
  before ever signing in.
- **portal** (signed in): login, `GET /auth/me`, then the same three calls
  the shared `/portal` shell makes on load (notifications, certificates,
  profile) — rotates through the seeded author/reviewer/staff/manager
  accounts so it isn't hammering one session.
- **register_checkin**: an author registers for the conference (category
  picked from whatever's open), then staff checks them in by registration
  id. Only the FIRST iteration of each actually succeeds end-to-end — the
  one-active-registration-per-user constraint and once-per-day check-in
  logic mean every iteration after that gets a clean 400/409, which is
  intentional: this is exactly the duplicate-action path Phase 3 asks to
  be "safe" (a clear message, never a 500), and the test asserts on that.

Thresholds fail the run (non-zero exit) if p95 latency or the error rate
cross the lines in `scenario.js` — see that file's `options.thresholds`.

# Architecture

**As of 1 November 2026** (`cc7e74b`). This document has two parts:

- **Part A** describes the system as it is today, checked against the code.
- **Part B** is the target we will move towards, step by step.

---

## Part A — current architecture

### A1. Deployment

```
Browser ──HTTPS──> Vercel (static SPA from dist/)
                     │  rewrites /api/*   ──> Render web service (Node/Express, free plan)
                     │  rewrites /files/* ──> Render (public uploads via express.static)
                     └  everything else   ──> index.html (client-side routing)

Render ──TLS (DB_SSL=true, CA pinned)──> Aiven MySQL 8 (database conference_cms)
Render ──HTTPS──> Brevo transactional email API   (EMAIL_MODE=brevo)
Render local disk: server/storage/{public,private}   ← wiped on every deploy (free plan)
```

Because Vercel proxies `/api`, the browser sees a single origin. So the session cookie stays
first-party, and `SameSite=Lax` works.

### A2. Frontend (`src/`)

| Layer | Where | Notes |
|---|---|---|
| Entry | `main.tsx` → `App.tsx` | 25 routes |
| Lazy-loaded sections | `App.tsx` | Super admin, convenor, portal and timer pages load as separate chunks. `lib/prefetch.ts` starts downloading them early. |
| Auth state | `lib/authContext.tsx` | Reads `GET /api/auth/me`. The session itself lives in an httpOnly cookie that JavaScript can't read. |
| API client | `lib/api.ts` | One fetch wrapper: cookies, the `ApiError` type, a 20-second GET cache cleared on every write, slow-request banner, `upload`, `postBlob` |
| Validation | `lib/validation.ts` | Zod schemas that mirror the server's (duplicated — audit M4) |
| Design system | `components/ui/*`, tokens in `index.css` | Button, Input, Select, Card, Modal, Menu, Popover, Tooltip, Tabs, DataTable, Toast, Skeleton, StatCard and more |
| Shared app shell | `components/AppShell.tsx` | Sidebar, top bar, command palette (search), notifications, conference switcher |
| Role portals | `pages/SuperAdminPage.tsx`; `pages/ConvenorPage.tsx` (convenor and manager); `pages/PortalPage.tsx` with `portal/sections/{Author,Reviewer,SessionChair,Staff}Section` | Convenor area: 6 sections (Setup, Papers, People, Schedule, Event, Communication) with tabs |
| Public | `HomePage`, `ConferencePage`, `/c/:slug/*` sign-in pages, `/verify/:token` | **The homepage is frozen** (it won't be redesigned) |

### A3. Backend (`server/src/`)

```
server.ts      starts HTTP + 4 in-process timers (email worker, session cleanup,
               scheduled announcements, review reminders)
app.ts         helmet (strict CSP on API) → CORS(CLIENT_ORIGIN) → compression →
               cookies → JSON 100 KB → Origin check → view-as write block →
               /files/public static → /api/health → 31 module routers → error handler
modules/<x>/   routes.ts (Express router, auth middleware, validateBody(zod))
               service.ts (business logic + SQL), validation.ts (zod), sometimes export.ts (PDF/XLSX)
db/            pool.ts (mysql2, UTC), withTransaction (also sets the audit actor)
middleware/    auth.ts (requireAuth, requireConferencePermission, assertConferencePermission,
               platform admin), validate.ts, rateLimit.ts
storage/       fileStore (public), privateFileStore, imageUpload (file-type + sharp)
email/         worker (queue → provider, retries), provider (console/smtp/brevo), render, layout
jobs/          announcements, cleanup, reviewReminders
utils/         audit, email (queueEmail), notifications, errors, crypto, phone …
```

**Request flow for a write:**

1. Route → `requireAuth`
2. Permission check: `requireConferencePermission('<perm>')`, or an `assert…` call inside the
   service
3. `validateBody(zodSchema)`
4. The service runs `withTransaction(actor, conn => …)`, which does the SQL, writes the audit
   log entry, and queues any emails or notifications **inside the same transaction**
5. JSON response, or `next(err)` → error middleware → `{ error: { message, fields?, code? } }`

**Permission model:**

- `roles` table:
  - platform roles: `admin` (and `organizer`, which nothing uses)
  - conference roles: convenor, manager, author, reviewer, session_chair, staff
- The `permissions` and `role_permissions` tables define what each role can do (base set in `02_reference_data.sql`, extended by later `04_*.sql` files).
- `conference_members` gives a user a role in one conference. `platform_user_roles` gives
  platform roles.
- Each session is bound to one conference (`auth_sessions.conference_id`).

### A4. Database

- MySQL 8.0.16+.
- Base schema files `01_schema.sql` → `02_reference_data.sql` → `03_triggers.sql`.
- Additive extensions after that: `04_*.sql`, `05_*.sql`, `06_*.sql`, and
  `batch-3-sql/04_*.sql`.
- `database/2026-11-01/` holds the combined "run this" files for local, test and Aiven.
- **Integrity in the database:**
  - foreign keys and CHECK constraints
  - triggers for schedule overlaps, fee windows, and the append-only audit log
  - unique keys preventing duplicate certificates and registrations
- Time is stored in UTC. Conferences carry their own `timezone` column (Asia/Kathmandu by
  default).

### A5. Testing

| Layer | Tool | Location |
|---|---|---|
| Server unit and integration | Vitest + supertest, against a real `conference_cms_test` database | `server/tests/` (52 files) |
| Frontend unit | Vitest | `src/**/*.test.ts` (9 files) |
| End to end | Playwright, against a throwaway frontend on port 5273 and a seeded test database | `e2e/` (20 specs) |
| Load | k6 | `load/scenario.js` |

---

## Part B — target architecture

These are principles to move towards. **It is not a big-bang move.**

### B1. Frontend

Keep `pages/` by role (it already matches the brief's `pages/{public,portal,convenor,…}`
idea). Introduce `features/` **only when splitting an oversized file**, so each move has a
reason behind it:

```
src/
  app/            App.tsx, router table, providers (auth, toast, admin view-as)
  components/ui/  design system (unchanged location — already in use everywhere)
  components/     shared composites (AppShell, CommandPalette, ImageUpload, …)
  features/
    programme/     ← split from ProgrammeTab.tsx (rooms, sessions editor, grid, list, copy-day)
    super-admin/   ← split from SuperAdminPage.tsx (one file per tab)
    submissions/   ← split from SubmissionDetail.tsx (authors, files, history, decision panel)
    certificates/  ← split from CertificatesTab.tsx (template editor, issue, issued list)
  pages/          thin route components that compose features
  lib/            api, auth, datetime (Kathmandu-aware "today"), validation, …
```

Rules:

- One component per file, and one data-loading hook per screen.
- No new global state library. React context plus the API cache is enough at this size.
- All dates go through `lib/datetime.ts`. No `toISOString().slice(0, 10)` and no
  `toLocaleString()` without a time zone.

### B2. Backend

Keep the module pattern exactly. The only structural changes:

- **Split oversized services by sub-domain**, keeping one public facade:
  - `schedule/` into sessions, presentations, rooms, export
  - `reviews/` into assignments, reviewing, decisions
  - `admin/` into users, conferences, platform
- **Introduce a `storage` interface** with two implementations:
  - local disk (development and tests)
  - S3-compatible, such as Cloudflare R2 (production)

  This is only if decision D1 picks object storage. Every caller already goes through
  `storage/*`, so the change stays local to that folder.
- **Shared date helper on the server too**, so "today in the conference's time zone" is
  calculated in one place.

### B3. Validation

Short term: keep both schema copies, but add a test that runs sample payloads through both and
fails if they disagree. Long term (optional): move the shared Zod schemas into a small
`shared/` folder that both builds import.

### B4. Scheduled jobs

Keep the in-process timers, and make sure they actually run, either by:

- an always-on Render instance (paid plan), or
- an external cron that calls a protected `POST /api/internal/tick` endpoint every 5 minutes,
  which runs the same job functions.

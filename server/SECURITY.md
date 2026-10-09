# Backend authorization rules (Phase 1 + 2)

MySQL has no row-level security, so every rule below is enforced in the Node
backend. This file is the source of truth for "who can see or change what" —
keep it in sync whenever an endpoint's access rule changes.

## Sessions

- A session cookie (`cms_session`) is an httpOnly, SameSite=Lax cookie holding
  a random 32-byte token. Only its SHA-256 hash is stored (`auth_sessions.token_hash`).
- Non-admin, remember-me: 30-day fixed expiry, persistent cookie.
- Non-admin, not remembered: 12-hour fixed expiry (set once at login, does not
  slide), browser-session cookie.
- Admin sessions: never remember-me, browser-session cookie, 30-minute
  **idle** expiry — `resolveSessionUser` slides `expires_at` forward on every
  authenticated request and revokes the session if more than 30 minutes have
  passed since `last_seen_at`.
- A session is also invalidated if the underlying user's `status` is no
  longer `active` (suspended/deactivated), even if the token itself hasn't
  expired.
- `reset-password` revokes every existing session for that user.

## Endpoints

| Endpoint | Who | Rule |
|---|---|---|
| `POST /api/auth/register` | anyone | creates `users` row + pending `role_requests` row; never logs in |
| `POST /api/auth/login` | anyone | requires an **approved** `role_requests` row for that `role_code` (or active `conference_members` row with `role_code='convenor'` when `role=convenor`); same generic message for unknown email / wrong password / suspended / locked account |
| `POST /api/auth/admin-login` | anyone | additionally requires a `platform_user_roles` row with `role_code='admin'`; same generic message otherwise — never reveals the account exists or is admin-gated |
| `POST /api/auth/logout` | anyone with a session cookie | revokes only that session |
| `GET /api/auth/me` | signed-in user | returns only the caller's own profile, roles and admin flag |
| `PATCH /api/auth/profile` | signed-in user | updates only the caller's own `users` row; all fields optional/partial |
| `POST /api/auth/change-password` | signed-in user | requires the current password |
| `POST /api/auth/forgot-password` | anyone | identical response whether or not the email exists |
| `POST /api/auth/reset-password` | anyone with a valid, unused, unexpired token | token is single-use (`auth_tokens.used_at`) |
| `POST /api/auth/accept-invitation` | anyone with a valid, unused, unexpired `purpose='invitation'` token | sets the password on the invited account and logs it in; a user created by an invite has `password_hash` NULL until this runs, and NULL is treated exactly like "wrong password" everywhere (same generic message) |
| `GET /api/conferences/public` | anyone | only `status <> 'draft' AND deleted_at IS NULL` |
| `GET /api/conferences/:slug` | anyone | same filter; 404 otherwise (never distinguishes "draft" from "doesn't exist") |
| `GET /api/conferences/:id/role-requests` | convenor of **that** conference, or admin | `members.manage` permission, checked against `conference_members` for `:id` specifically — a convenor of conference A gets 403 on conference B's requests |
| `POST /api/role-requests/:id/approve` | convenor of the request's conference, or admin | loads the request's `conference_id` first, then checks `members.manage` against *that* conference; inserts/reactivates `conference_members` + writes `audit_logs` in one transaction |
| `POST /api/role-requests/:id/reject` | same as approve | reason required (min 3 chars) |
| `GET /api/admin/conferences` | admin only | |
| `POST /api/admin/conferences` | admin only | creates conference + settings + 5 default deadlines in one transaction |
| `POST /api/admin/conferences/:id/convenor` | admin only | target must be an existing account (no account creation here); replaces the previous active convenor in one transaction |
| `POST /api/admin/conferences/:id/convenor-invite` | admin only | creates the account (password_hash NULL) + a 7-day `invitation` token only if the email has no account yet; either way, replaces the previous active convenor in the same transaction |
| `POST /api/admin/conferences/:id/publish` | admin only | draft -> submission_open only; no-op otherwise |

## Permission model

- `requireAuth` — valid, non-expired session; attaches `req.user`.
- `requireAdmin` — `requireAuth` + `platform_user_roles.role_code = 'admin'`.
- `requireConferencePermission(permission)` — `requireAuth`, then admins pass
  unconditionally; otherwise requires an **active** `conference_members` row
  for the target conference whose `role_code` carries `permission` via
  `role_permissions`. By seed data: convenor has every permission; manager
  has every permission except `audit.read` and `members.manage`; staff has
  only `conference.view_internal`, `registration.read_all`,
  `attendance.record`; reviewer/session_chair/speaker/author have none
  (their access is scoped to their own assignments/submissions, not
  implemented until later phases).
- `requireConferenceRole(roleCodes)` — `requireAuth`, admins pass; otherwise
  requires an active `conference_members` row with one of the given
  `role_code`s. Not yet used by a Phase 1 route, but available to later
  phases that need "any of these roles" rather than a specific permission.
- Where the target conference isn't known from the URL (role-request
  approve/reject), the service function loads the entity first and calls
  `assertConferencePermission` directly instead of the route-level
  middleware.

## Phase 2 endpoints

| Endpoint | Who | Rule |
|---|---|---|
| `GET /api/conferences/:id/details` | `conference.manage` | full row (incl. draft conferences), unlike the Phase 1 public `/:slug` route |
| `PATCH /api/conferences/:id` | `conference.manage` | partial update, changed-fields-only audit log; `code` only changeable while `status='draft'` |
| `POST/DELETE /api/conferences/:id/logo`, `/banner` | `conference.manage` | multer + magic-byte type check + sharp re-encode; old file deleted after the new one is committed |
| `GET/PUT /api/conferences/:id/deadlines` | `deadline.manage` | `PUT` upserts the full set sent |
| `GET/POST /api/conferences/:id/tracks`, `PATCH /:trackId`, `PATCH /:trackId/deactivate`, `POST /reorder` | `conference.manage` | |
| `GET/POST /api/conferences/:id/supporters`, `PATCH /:supporterId`, `PATCH /:supporterId/active`, `DELETE /:supporterId`, `POST/DELETE /:supporterId/logo`, `POST /reorder` | `conference.manage` | |
| `GET/POST /api/conferences/:id/rooms`, `PATCH /:roomId`, `PATCH /:roomId/status` | `schedule.manage` | |
| `GET/POST /api/conferences/:id/sessions`, `PATCH/DELETE /:sessionId` | `schedule.manage` | service checks the session falls within the conference's dates in its own timezone before writing; DB triggers (room/chair/presenter clash) still apply and their message is passed through as-is |
| `GET /api/conferences/:id/sessions/public` | anyone | published sessions only, joined to room/track names — the public conference page's programme section |
| `GET /api/conferences/public-deadlines`, `/public-track-count` | anyone | small aggregates the public home page needs; restricted to non-draft, non-deleted conferences |
| `GET /api/announcements/public` | anyone | `status='published'` only |
| `GET/PATCH /api/conferences/:id/settings` | **convenor or admin only** (`requireConferenceRole(['convenor'])`, not the broader `conference.manage`, which `manager` also holds) | |
| `GET/PATCH /api/me/profile`, `POST/DELETE /api/me/photo` | signed-in user, own row only | no `email`/`status` field exists on this endpoint at all |
| `GET /api/admin/users` | admin only | search by name/email, optional status filter |
| `POST /api/admin/users/:id/suspend` | admin only | 400 on self-suspend; 400 if it would leave zero active admins (the HTTP path can't actually reach the latter — see the test's comment — but the service function enforces it regardless of caller) |
| `POST /api/admin/users/:id/reactivate` | admin only | |
| `POST /api/admin/conferences/:id/archive`, `/restore` | admin only | sets/clears `deleted_at` |
| `GET /api/admin/dashboard` | admin only | counts only |
| `GET /api/admin/audit-log`, `/audit-log/export.csv` | admin only | read-only; the table itself is append-only by trigger |

## What is intentionally NOT covered yet

Submissions, reviews, registration/payment, attendance, and certificates stay
on Supabase until a later phase — the Node backend doesn't serve those routes
yet.

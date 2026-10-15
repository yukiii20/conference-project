# Conference Management System

A conference management system: sign-up and convenor approval, conference
setup, paper submissions, peer review and decisions, a full programme
(rooms, sessions, chairs), free registration with QR check-in, certificates,
email notifications, and a platform admin console. The frontend is React 19
+ Vite; the backend is Node/Express + MySQL (no Supabase or other
third-party backend — everything runs on your own database and server).

## 1. Install dependencies

```bash
npm install            # frontend, from the repo root
cd server && npm install   # backend
```

## 2. Set up MySQL

Requires **MySQL 8.0.16 or newer** (not MariaDB/XAMPP — it's missing
features this schema needs). From the `database/` folder, run these in
order against your MySQL server (MySQL Workbench: File → Open SQL Script,
then the lightning-bolt "run" icon; or `mysql -u root -p < file.sql`):

```bash
mysql -u root -p < database/01_schema.sql
mysql -u root -p < database/02_reference_data.sql
mysql -u root -p < database/03_triggers.sql
mysql -u root -p < database/04_admin_extensions.sql
```

This creates the `conference_cms` database with all tables, roles,
permissions, and the triggers that enforce things like "a submission can
only move through its allowed statuses." Run every `database/04_*.sql`
file, in filename order, if there's more than one by the time you read
this — each is a small, additive extension, never a change to an earlier
file.

Create a dedicated application user (never let the app connect as root):

```sql
CREATE USER 'cms_app'@'localhost' IDENTIFIED BY '<a strong password>';
GRANT SELECT, INSERT, UPDATE, DELETE ON conference_cms.* TO 'cms_app'@'localhost';
FLUSH PRIVILEGES;
```

If you'll run the backend's automated tests, also run
`database/test-setup.sql` once — it creates a separate `conference_cms_test`
database with the same schema, so tests never touch your real data.

## 3. Configure the backend

```bash
cd server
cp .env.example .env
```

Open `server/.env` and fill in every variable:

| Variable | What it's for |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | How to connect to MySQL. Use the `cms_app` user you created above. |
| `SESSION_SECRET` | Random secret used to sign session data. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. In production this must be 32+ random characters — the server refuses to start otherwise. |
| `CLIENT_ORIGIN` | The exact URL the frontend is served from (e.g. `http://localhost:5173` in dev, `https://your-domain.com` in production). Used for CORS and to reject cross-site requests. |
| `PORT` | Port the backend listens on. Defaults to `4000`. |
| `NODE_ENV` | `development`, `test`, or `production`. Production turns on stricter checks (see below). |
| `TRUST_PROXY` | Only set this when running behind Nginx/a load balancer — see `docs/deploy.md`. Leave empty for local development. |
| `EMAIL_MODE` | `console` (default) prints emails to the server log instead of sending them — good for local development. `smtp` sends real email via the settings below. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Only needed when `EMAIL_MODE=smtp`. For Gmail: `smtp.gmail.com`, `465`, `true`, your Gmail address, and a 16-character [Google App Password](https://myaccount.google.com/apppasswords) (not your normal password — Gmail requires 2-Step Verification to be turned on first). |
| `MAIL_FROM` | The "From" address on outgoing email, e.g. `"Conference CMS <you@example.com>"`. Required when `EMAIL_MODE=smtp`. |
| `APP_URL` | The base URL used to build links *inside* emails (password reset, invitations). Usually the same as `CLIENT_ORIGIN`. |

Never commit `server/.env` — it's already in `.gitignore`.

## 4. Create the first administrator

```bash
cd server
npm run create-admin
```

This asks for an email, name, and password on the command line and creates
a platform administrator account. Sign in at `/super-admin/login`.

## 5. Run it

In one terminal:

```bash
cd server
npm run dev
```

Backend listens on `http://localhost:4000`. It also starts two background
jobs automatically: one that sends queued emails (checks every 10 seconds)
and one that cleans up expired sessions/tokens (once a day).

In another terminal:

```bash
npm run dev
```

Frontend listens on `http://localhost:5173` and proxies `/api` and
`/files/public` to the backend.

## 6. Run the tests

Backend (uses the separate `conference_cms_test` database from step 2 —
never your real data):

```bash
cd server
npm test
```

Frontend unit tests:

```bash
npm test
```

End-to-end (Playwright) tests live in `e2e/` and run against dedicated
throwaway backend/frontend instances on different ports — see
`playwright.config.ts` and `docs/phase4-test-steps.md` for how to start
those.

## Where things live

- **Uploaded files**: private submission files (abstracts, full papers,
  camera-ready copies, slides) are stored under `server/storage/private/`
  and are never served directly — every download goes through
  `/api/submissions/:id/files/:fileId/download`, which checks permission on
  every request. Public images (logos, banners, profile photos) are stored
  under `server/storage/public/` and served from `/files/public/`.
- **Email log**: every email the app queues (sent or not) is recorded in
  the `email_logs` table, visible to platform admins (Email log page) and
  convenors/managers (Emails tab) — never the raw placeholder data, just
  recipient/subject/status/attempts/error.
- **Audit log**: every meaningful write (approvals, decisions, password
  resets, ...) is recorded in `audit_logs`, visible to admins.

## How it works, briefly

- **Sign up** (`/signup`): choose a role (author, reviewer, session chair,
  staff, or manager) and a conference; the account is created but can't
  sign in until that conference's convenor approves the request (Role
  requests tab). Convenor itself is never self-signed-up — a platform admin
  appoints or invites one.
- **Submissions** (`/author`): create a draft abstract, submit it inside the
  conference's submission window, track its status, and — once accepted —
  upload a full paper and (later) a camera-ready copy.
- **Review** (`/convenor`, `/reviewer`): the convenor assigns reviewers
  (blocking an author from reviewing their own paper, or anyone with a
  declared conflict of interest); reviewers accept/decline and submit a
  scored review; the convenor records accept/reject/revision decisions,
  which notify the author by email and in-app notification.
- **Programme** (`/convenor` → Event → Programme, public page's Programme
  section): the convenor manages rooms, optional time slots, and sessions
  (keynote/paper/panel/poster/break, ...), assigns session chairs (from
  members holding that role), and schedules accepted papers or invited
  talks into sessions with auto-computed times. The public page shows
  published sessions with day tabs, a PDF download, and per-session
  "add to calendar" (.ics). Session chairs get their own portal at
  `/session-chair` to mark each presentation presented/absent.
- **Registration and attendance** (public page's Registration section,
  `/convenor` → Event → Attendance, `/staff`): any signed-in user can
  register to attend during the registration window — free, with a
  registration number and a QR-code ticket. Staff (and session chairs, for
  individual sessions) check attendees in by scanning that QR code or by
  manual search; the dedicated `/staff` page exists because staff holds
  neither the convenor nor manager role. Whether registration needs manual
  payment confirmation, whether per-session check-in is enabled, and the
  minimum sessions required for a participation certificate are all set in
  Review settings.
- **Certificates** (`/convenor` → Event → Certificates): the convenor
  designs a PDF template per certificate type (participation, presentation,
  reviewer, session chair, staff, speaker, best paper — background image,
  signatories with signature images), then issues them in bulk (eligibility
  computed automatically per type) or manually (best paper, speaker).
  Certificates are released to recipients after the certificate-release key
  date or a manual "Release now", and anyone can verify one with no login
  at `/verify/:token`.
- **Notifications**: the bell icon in every portal's header shows unread
  in-app notifications (role approvals, new assignments, decisions,
  schedule changes, certificates, ...), polling every 60 seconds.
- **Admin** (`/super-admin`): create conferences, appoint/invite convenors,
  manage user accounts (suspend/reactivate/unlock/anonymise, send a
  password-reset link), grant/revoke other platform admins, "view as admin"
  a conference read-only, edit platform-wide settings (site name, support
  email, home page copy), check system health, and view the audit and
  email logs.

## Security notes

See `docs/deploy.md` for production deployment and `docs/final-test-report.md`
for the security checks already in place (CSRF defense, rate limiting,
route guards, private file access control, and more).

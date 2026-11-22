# Local setup (Windows)

How to run the Conference Management System on your own computer against a local MySQL server.
The old hosted (Aiven) database is no longer used anywhere in this setup.

## What was wrong (22 Nov 2026)

1. **MySQL was not running.** MySQL is installed with Scoop as a normal program, not a
   Windows service, so it does not start after a reboot. The backend still started, but every
   database call failed with `connect ECONNREFUSED 127.0.0.1:3306` and `/api/health` said
   `"ok": false`. That is why most pages failed.
2. **The local databases were three updates behind the code.** The 13, 18 and 19 November
   database changes (Audience role, Q&A, ratings, schedule changes, payment receipts,
   publication info, ...) had never been applied locally, so 7 tables and many columns the
   code uses were missing.
3. **`database/test-setup.sql` is out of date** (it stops at `06_session_conference.sql`), so a
   test database built from it is also behind. Use `database/rebuild-local.sh` instead (below).
4. `server/.env` itself was already correct for local use (local host, SSL off, console email).

## What was changed

| File | Change |
|---|---|
| `database/rebuild-local.sh` (new, not in git: `database/` is private) | Builds `conference_cms` or `conference_cms_test` from every SQL file in the right order. |
| `start.bat` | Stops with a clear message when MySQL is not running, instead of starting an app that cannot reach its database. |
| `server/.env.example`, `.env.example` | Documented `S3_FORCE_PATH_STYLE` and `VITE_API_PROXY_TARGET`. No secrets. |
| `server/src/email/layout.ts` | Plain-text emails (and the terminal output in console mode) now keep link addresses, so password-reset and invitation links are visible. |
| `server/tests/e2eSeed.ts` | The E2E seed can run again on a used test database (it now clears session child rows first). |

UI fixes made in the same branch are listed in the final report of the change, not here.

## One-time setup

### 1. Install the tools

- **Node.js 22 or newer** (tested with v24) and npm.
- **MySQL Community Server 8.0.16 or newer** (tested with 9.7.4 LTS). Not MariaDB/XAMPP.
  Either the official MySQL Installer (installs a Windows service that starts by itself) or
  Scoop: `scoop install mysql-lts`.
- Git Bash (comes with Git for Windows), for `database/rebuild-local.sh`.

### 2. Start MySQL

Skip this if MySQL runs as a Windows service. With Scoop, run this in its own terminal and leave
it open (closing it stops MySQL):

```powershell
mysqld --defaults-file="$env:USERPROFILE\scoop\persist\mysql-lts\my.ini" --console
```

Check it is up: `mysql -u root -p -e "SELECT VERSION()"` (on this computer root has no
password, so leave out `-p`). Stop it cleanly with `mysqladmin -u root shutdown`.

### 3. Create the databases

From the project root, in Git Bash:

```bash
sh database/rebuild-local.sh conference_cms         # the app's database
sh database/rebuild-local.sh conference_cms_test    # the throwaway test database
```

Each prints the 19 files it runs and ends with `Done: ... Tables: 71`. Running it again on an
existing database is safe (every file only adds what is missing). To check, run each
`database/2026-11-*/3-CHECK.sql` file: every row must say `OK`.

### 4. Create the application user (once per computer)

Already done on this computer (`cms_app` exists). On a new computer, as root:

```sql
CREATE USER 'cms_app'@'localhost' IDENTIFIED BY '<a strong password>';
CREATE USER 'cms_app'@'127.0.0.1' IDENTIFIED BY '<the same password>';
GRANT SELECT, INSERT, UPDATE, DELETE ON conference_cms.*      TO 'cms_app'@'localhost', 'cms_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON conference_cms_test.* TO 'cms_app'@'localhost', 'cms_app'@'127.0.0.1';
```

These grants stay in place when a database is dropped and rebuilt.

### 5. Configure the backend

```bash
cd server
cp .env.example .env
```

Fill in:

| Variable | Local value |
|---|---|
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `3306` |
| `DB_USER` / `DB_PASSWORD` | `cms_app` / the password from step 4 |
| `DB_NAME` | `conference_cms` |
| `DB_SSL` | `false` (local MySQL needs no SSL; leave `DB_SSL_CA*` empty) |
| `SESSION_SECRET` | output of `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CLIENT_ORIGIN` and `APP_URL` | `http://localhost:5173` |
| `NODE_ENV` | `development` (cookies then work on plain http) |
| `EMAIL_MODE` | `console` (emails, including reset links, are printed in the backend terminal; nothing is sent) |
| `STORAGE_DRIVER` | `local` (uploads go to `server/storage/`) |

Leave everything else empty. Never commit `.env`.

Then check the setup: `cd server && npm run doctor`. Every line should say OK / found / all present.

### 6. Install dependencies and create the first administrator

```bash
npm install
cd server && npm install
npm run create-admin      # asks for email, name and password
```

Sign in as that administrator at http://localhost:5173/super-admin/login.

## Start the app

Start MySQL first (step 2). Then either double-click `start.bat`, or use two terminals:

```bash
cd server && npm run dev     # backend  -> http://localhost:4000
npm run dev                  # frontend -> http://localhost:5173 (from the project root)
```

| What | URL |
|---|---|
| App | http://localhost:5173 |
| Admin sign-in | http://localhost:5173/super-admin/login |
| Health check | http://localhost:5173/api/health (must show `"ok":true` and `"database":{"ok":true,...}`) |

Password-reset and invitation emails appear in the **backend** terminal between
`--- [console email]` and `--- end email ---`, with the link written out.

## Run the tests

All tests use `conference_cms_test` only, never `conference_cms`.

```bash
npm test                    # frontend unit tests
cd server && npm test       # backend tests (about 8 minutes)
```

End-to-end (Playwright) tests use their own backend on port 4100 and frontend on 5273, so they
never touch your dev servers. In Git Bash, three terminals:

```bash
# 1. test backend
cd server
NODE_ENV=test DB_NAME=conference_cms_test STORAGE_ROOT=storage-test-e2e STORAGE_DRIVER=local \
  PORT=4100 CLIENT_ORIGIN=http://localhost:5273 APP_URL=http://localhost:5273 npx tsx src/server.ts

# 2. test frontend (project root)
VITE_API_PROXY_TARGET=http://localhost:4100 npx vite --port 5273 --strictPort

# 3. seed, then run (project root)
(cd server && npx tsx tests/e2eSeed.ts)
npx playwright test                 # all specs, about 25 minutes
npx playwright test --last-failed   # only what failed last time
```

Re-run the seed before each full Playwright run. The HTML report is in `playwright-report/`.

## Reset the local database

This deletes all local data in that database. Back it up first:

```bash
mysqldump -u root --routines --triggers --databases conference_cms > backup-conference_cms.sql
sh database/rebuild-local.sh conference_cms --drop
cd server && npm run create-admin
```

To restore a backup instead: `mysql -u root < backup-conference_cms.sql`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `connect ECONNREFUSED 127.0.0.1:3306`, health shows `"database":{"ok":false}`, most pages fail | MySQL is not running | Start MySQL (step 2) |
| `start.bat` says "MySQL is not running on port 3306" | Same | Same |
| `Access denied for user 'cms_app'` | Wrong `DB_PASSWORD`, or the user does not exist | Check `server/.env`; redo step 4 |
| `Unknown database 'conference_cms'` | Database not created | Step 3 |
| `Table '...' doesn't exist` / `Unknown column '...'` | Database behind the code | `sh database/rebuild-local.sh conference_cms` (safe, adds only what is missing) |
| `Invalid environment configuration: ...` on start | A required variable is missing or invalid | Fix the variable it names in `server/.env`; run `npm run doctor` |
| `DB_SSL_CA (or DB_SSL_CA_PATH) is required when DB_SSL=true` | SSL switched on for local MySQL | Set `DB_SSL=false` |
| Sign-in works but you are signed out straight away | `NODE_ENV=production` on http (secure cookies) | Use `NODE_ENV=development` locally |
| `CORS` error or "request from another site" in the browser | `CLIENT_ORIGIN` is not exactly `http://localhost:5173` | Fix `CLIENT_ORIGIN` (no trailing slash) |
| Frontend loads but every `/api` call fails | Backend not running, or not on port 4000 | Start the backend; `PORT=4000` |
| `Port 5173 is in use` | Another Vite is running | Close it, or open the URL Vite prints |
| Reset link never arrives | `EMAIL_MODE=console` prints it instead | Look in the backend terminal |
| E2E seed fails with a foreign key error | Old seed script | Use the fixed `server/tests/e2eSeed.ts`, or rebuild `conference_cms_test` |
| `adminPortal.spec.ts` "create a conference" fails only between 00:00 and 05:45 Nepal time | The spec builds "today" in UTC; the app checks Nepal time | Run it outside that window (known test issue) |

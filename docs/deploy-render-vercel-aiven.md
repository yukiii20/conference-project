DEPLOY PREP: Vercel (frontend) + Render (backend) + Aiven (MySQL).
Prepare the code and a beginner guide. Keep local development working exactly as now
(all new settings optional with safe defaults). No SQL run by you. No secrets in git.
Tests only on conference_cms_test. Never weaken tests.

TARGET
- Frontend: Vercel, static Vite build (dist), URL https://<name>.vercel.app
- Backend: Render Web Service (Node), URL https://<name>.onrender.com
- Database: Aiven for MySQL (free plan: 1 GB, max 76 connections, SSL required)
- The browser must ONLY talk to the Vercel domain. Vercel rewrites /api/* and /files/* to the
  Render backend, so session cookies stay first-party (SameSite=Lax keeps working) and our
  Origin/CSRF check keeps using CLIENT_ORIGIN = the Vercel URL. Do not switch cookies to
  SameSite=None.

1. FRONTEND (Vercel)
- Add vercel.json: rewrites /api/:path* and /files/:path* -> https://BACKEND_URL/... (placeholder,
  documented), then SPA fallback (all other routes -> /index.html). Long cache for /assets/*,
  no cache for index.html.
- Confirm the frontend uses relative /api URLs (no hard-coded localhost in the build).

2. BACKEND (Render)
- render.yaml (Blueprint) for a Node web service: build = npm ci && npm run build in server/,
  start = production start command, health check path /api/health, NODE_ENV=production,
  env vars listed with sync:false for secrets.
- Listen on process.env.PORT (Render sets it).
- TRUST_PROXY: requests arrive through Vercel AND Render's proxy. Work out the correct Express
  'trust proxy' setting so req.ip is the real visitor IP (needed for rate limits and audit log);
  document it and add a test for the parsing if it's configurable.
- STORAGE_DIR env (default = current server/storage) so uploads/certificates can live on a
  Render persistent disk mounted at e.g. /var/data/storage. All file reads/writes must use it.
  Render's normal filesystem is wiped on every deploy/restart — say this clearly in the guide.
- Email worker keeps running in the web process (fine).

3. DATABASE (Aiven)
- Add optional DB SSL: DB_SSL=true + DB_SSL_CA (the CA certificate text, or DB_SSL_CA_PATH),
  passed to the mysql2 pool with rejectUnauthorized true. Default off locally.
- Pool size env must stay under Aiven's 76 connection limit (default 10 is fine; document it).
- Write docs/aiven-mysql-setup.md for the user (they run the SQL themselves in MySQL Workbench):
  connect with SSL (Use SSL = Require, CA file from Aiven console), CREATE DATABASE
  conference_cms, run 01_schema, 02_reference_data, 03_triggers, every 04_*.sql in order
  (NOT test-setup.sql), create the cms_app user with only SELECT/INSERT/UPDATE/DELETE on
  conference_cms.* and a strong password. Explain: if CREATE TRIGGER fails with a
  SUPER/binary-logging error, turn on "log_bin_trust_function_creators" in the Aiven service's
  Advanced configuration and re-run 03_triggers.sql. Mention Aiven's sql_require_primary_key
  (check every table in our schema has a primary key and report).
- Check the schema for anything Aiven MySQL 8 refuses (DEFINER clauses, SET GLOBAL, etc.) and
  list it with the fix - do not change the existing files silently; if a change is needed,
  propose a new file and show me.

4. EMAIL
- Render FREE web services block SMTP ports 25/465/587. Keep EMAIL_MODE=smtp for a paid
  Render instance, and ADD an HTTP email provider option so email works on the free plan too:
  EMAIL_MODE=brevo using Brevo's transactional email HTTP API (BREVO_API_KEY, MAIL_FROM must be
  a verified sender). Same queue/retry/redaction/logging as the SMTP provider. Unit test it with
  a mocked fetch (no real emails).

5. GUIDE: docs/deploy-render-vercel-aiven.md, simple numbered steps for a beginner:
  A Aiven: create free MySQL service, download CA cert, run the SQL (link to the doc above).
  B Render: New -> Blueprint from the GitHub repo (or Web Service), set env vars
    (DB_HOST/PORT/USER/PASSWORD/NAME from Aiven, DB_SSL=true, DB_SSL_CA, SESSION_SECRET new,
    CLIENT_ORIGIN and APP_URL = the Vercel URL, TRUST_PROXY, EMAIL_MODE + keys, STORAGE_DIR),
    plan choice explained (Free = sleeps after 15 min idle + uploads lost on restart + no SMTP;
    Starter = always on + persistent disk + SMTP), then create the first admin with
    `npm run create-admin` from the Render Shell.
  C Vercel: import the repo, framework Vite, put the Render URL into vercel.json rewrites,
    deploy, then set CLIENT_ORIGIN/APP_URL on Render to the final Vercel URL and redeploy.
  D Final checks: login, upload a logo, redeploy Render and confirm the logo is still there,
    forgot-password email arrives, QR camera scan on phone (HTTPS), /api/health OK.
  E Updating: git push -> both redeploy automatically.
  F Free-plan limits table (Render, Vercel, Aiven) and when to upgrade.

6. FINISH
- tsc, build, npm test (root + server), re-seed, npx playwright test: all pass locally.
- Commit + push "Deploy: Vercel + Render + Aiven". Update docs/progress.md.
  Show me the new env variables and the guide path.

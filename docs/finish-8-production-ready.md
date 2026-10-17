STEP 8: Make the app production-ready (speed, security, reliability, load test, report).
Run this only after Step 7 is DONE in docs/progress.md.

Act as a senior full-stack engineer, performance engineer and security reviewer.
Inspect the real code first. Improve in small steps. Do not rebuild. Do not redesign the UI.

RULES (all still in force)
- Do not run any SQL. No schema/trigger changes without asking. If an index or change is
  needed, write database/04_*.sql, explain why, show it to me and wait. I run SQL myself.
- Never touch conference_cms for tests: use conference_cms_test only.
- No real emails in tests. Never weaken or delete tests. Don't kill my dev servers (use 4100/5273).
- No secrets in frontend code or git. Never commit server/.env, storage, node_modules.
- Don't log passwords, session ids, tokens or document contents.
- No fake numbers: report only what you actually measured.

PHASE 1: AUDIT (write docs/production-audit.md first and show me the top problems + plan)
- Frontend bundle size per chunk, slow pages, repeated API calls.
- Backend: slow endpoints, N+1 queries, endpoints returning too many fields or all rows.
- Security: every route's auth/permission, file downloads, uploads, cookies, CORS, rate limits,
  env validation, npm audit (root + server).
- Reliability: transactions, duplicate actions (double registration, double check-in,
  double certificate), storage folders, backups.

PHASE 2: FRONTEND SPEED
- Route-based lazy loading for big pages (convenor portal, super admin, check-in scanner,
  charts/Excel). Goal: main bundle clearly smaller than now (~773 KB); report before/after.
- Avoid repeated fetches (small shared cache per page, no refetch loops).
- Server-side pagination + search for big tables (users, registrations, submissions,
  email log, audit log). Don't load thousands of rows into the browser.
- Lazy-load images below the fold, set width/height to avoid layout shift, compress uploaded
  logos/banners with sharp (already used).
- Measure with Lighthouse (mobile) on home, conference page, login, /portal:
  targets LCP <= 2.5 s, CLS <= 0.1, INP <= 200 ms. Report real numbers before/after.

PHASE 3: BACKEND AND DATABASE
- Fix N+1 queries, select only needed columns, add LIMIT/OFFSET or cursor paging + filters.
- Request size limits and timeouts; sensible MySQL pool size.
- Check indexes against the real WHERE/ORDER BY of slow queries (EXPLAIN on the test DB).
  Any new index -> database/04_*.sql shown to me first.
- Keep triggers and transactions. Make duplicate actions safe (unique flags already exist:
  confirm the API returns a clear message, not a 500).
- Certificate issue/revoke and check-in stay consistent if two people click at once.

PHASE 4: SECURITY
- Every protected route checked on the server (routeGuards.test.ts must cover all routes).
- Roles: super admin, convenor, manager, staff, reviewer, session chair, author as in
  docs/role-matrix.md. No silent extra permissions.
- Parameterized SQL everywhere, input validation (zod), safe error messages (no stack traces
  in production), helmet, CORS = CLIENT_ORIGIN only, CSRF protection suitable for our
  cookie sessions (SameSite + Origin check on writes), rate limits on login, signup, forgot
  password, uploads.
- Cookies: httpOnly, Secure in production, SameSite=Lax. Session expiry + logout everywhere
  after password change.
- Uploads: type by content (file-type), size limits, private files only via permission check.
- Production env check: refuse to start in production with weak SESSION_SECRET, missing SMTP,
  or console email mode (warn clearly).
- Audit log for all admin and sensitive actions (already exists: confirm coverage).

PHASE 5: WORKFLOW CHECK (real app, test DB)
Test end to end and fix gaps:
admin appoints convenor -> convenor sets up conference -> author submits abstract + file ->
reviewer reviews (blind) -> convenor decides -> author uploads full paper -> programme published
-> attendee registers, gets confirmation email (console mode in tests) + QR ticket ->
staff scans -> invalid/revoked/already-used tickets are rejected with a clear message ->
convenor generates + releases certificates -> attendee downloads from My certificates ->
/verify shows valid; revoke -> shows revoked -> unauthorized users get blocked from pages,
APIs and files.

PHASE 6: BACKUPS AND MONITORING (for the Ubuntu VPS in docs/deploy.md)
- Write deploy/backup.sh: daily mysqldump (gzip) + tar of server/storage, keep 14 days,
  optional copy to a second place (another server / cloud bucket). deploy/restore.md with
  exact restore steps. Test backup + restore on the TEST database only and report the result.
- Health endpoint already exists: add uptime, DB ping, email queue counts (no secrets).
- Write docs/monitoring.md: what to watch (p50/p95/p99 response time, error rate, CPU, RAM,
  disk, MySQL connections, slow query log, failed/queued emails, PM2 restarts) and cheap tools
  (PM2 logs/monit, UptimeRobot free, MySQL slow log).

PHASE 7: LOAD TEST (k6, local test servers only, never production)
- Write load/k6 scripts: browse home + conference page, login, view /portal, register,
  check-in. Use seeded test users only.
- Plan for 10,000 REGISTERED users. Explain that concurrent users are far fewer
  (e.g. 100-300 at peak). Ramp up slowly: 10 -> 50 -> 100 -> 200 virtual users.
- Report the real machine, VUs, duration, p50/p95/p99, requests/sec, error rate, CPU/RAM.
  Do not invent results.

PHASE 8: FINISH
- npx tsc --noEmit, builds, npm test (root + server), re-seed, npx playwright test, npm audit.
- Write docs/production-readiness.md:
  1 problems found, 2 files changed and why, 3 performance before/after, 4 security fixes and
  remaining risks, 5 commands run and real results, 6 missing features, 7 recommended VPS size
  (CPU/RAM/disk), MySQL settings, storage and backups, 8 tasks left before going live,
  9 paid services needed and cheaper options (domain, VPS, email provider, backup storage).
- Commit + push "Step 8: production readiness". Update docs/progress.md.
  Show me the summary, test totals and commit hash.

STEP 0 — Make sure the WHOLE project is on GitHub and teammates can run it.

1. Check git: run `git ls-files server database | head` style checks. If server/src,
   server/package.json, server/package-lock.json, server/tsconfig.json, server/tests,
   database/*.sql, docs/ are NOT tracked, add them. Never add: server/.env, any .env /
   .env.local, node_modules, server/node_modules, server/storage, dist, server/dist,
   test-results, playwright-report. Fix .gitignore so those stay out and everything else
   is included. If any .env was ever tracked: `git rm --cached` it (keep the file on disk)
   and tell me.
2. Make sure server/.env.example lists EVERY variable the server reads (from
   src/config/env.ts) with safe placeholder values and a one-line comment each
   (EMAIL_MODE=console by default, SMTP_* empty). No real secrets.
3. Write docs/TEAM_SETUP.md in plain simple English for a teammate on Windows:
   install Node 20+ and MySQL 8 + Workbench; clone; run database/01_schema.sql,
   02_reference_data.sql, 03_triggers.sql, every 04_*.sql in order, then test-setup.sql;
   create the cms_app MySQL user (SQL given); copy server/.env.example to server/.env and
   fill it (generate SESSION_SECRET with a node one-liner); `npm install` in the root and
   in server/; `npm run create-admin` in server/; run backend + frontend; open
   http://localhost:5173. Add a "Common errors" section: "Invalid environment
   configuration" (= .env missing), EADDRINUSE 4000 (= backend already running),
   ECONNREFUSED (= backend not running), Access denied for cms_app (= wrong DB password).
   Note that each laptop has its own database (data is not shared).
4. Add a root start.bat that opens backend and frontend in two windows and then the browser.
5. Add a check script `npm run doctor` in server/ that prints (no secrets): Node version,
   whether .env exists, which required variables are missing, whether MySQL is reachable,
   whether all tables exist, EMAIL_MODE.
6. Run tsc + npm test, then commit and push ("Team setup: docs, start.bat, doctor").
   Show me `git ls-files | wc -l` style summary and the pushed commit hash.

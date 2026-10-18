# Monitoring (what to watch, and with what)

Cheap/free tooling only — no paid APM for a system this size. Revisit if
usage grows past a few hundred concurrent users (see
`docs/production-readiness.md` for the capacity reasoning).

## What to watch

| Signal | Why | Where to see it |
|---|---|---|
| Response time (p50/p95/p99) | Catches slow endpoints before users complain | `pm2 monit` live; PM2 doesn't keep history by default — for real percentiles over time, tail Nginx's access log and run it through `goaccess` (`sudo apt install goaccess`, free, reads the log format already in `docs/deploy.md`'s Nginx config) |
| Error rate (5xx) | A spike means something is actually broken, not just slow | `pm2 logs cms-backend --err`, or grep Nginx's access log for ` 5\d\d ` |
| `/api/health` | One request tells you: DB reachable, how long it took, uptime since last restart, queued/failed email counts | `curl https://your-domain.com/api/health` — see below for the free uptime-monitor setup |
| CPU / RAM | Sustained high CPU = undersized VPS or a runaway query; climbing RAM with no plateau = a leak | `pm2 monit`, or `htop` for the whole box |
| Disk space | Full disk = failed uploads, failed backups, MySQL refusing writes | `df -h`; `/api/health`'s `database.ok` won't catch this on its own, so don't rely on it alone - check disk directly, or wire the admin dashboard's `storage_disk` figures (already computed server-side, see `server/src/utils/health.ts`'s `getStorageDiskSpace`) into an alert if free space drops below ~10% |
| MySQL connections in use | Approaching `pool` size's max means requests start queueing or timing out | `SHOW STATUS LIKE 'Threads_connected';` vs. the pool's configured max (`server/src/db/pool.ts`) |
| Slow query log | Finds the exact queries worth indexing, instead of guessing | Enable with `slow_query_log = 1` and `long_query_time = 1` in `/etc/mysql/mysql.conf.d/mysqld.cnf`, then `mysqldumpslow /var/log/mysql/mysql-slow.log` periodically |
| Failed / queued emails | A stuck SMTP relay silently breaks password resets and invitations | `/api/health`'s `email_queue`, or the admin dashboard's System health card (`SuperAdminPage` → Dashboard) |
| PM2 restarts | A process that keeps restarting is crash-looping, not just briefly down | `pm2 list` shows a restart count per process; a climbing number between checks is the signal |

## Free tools, in order of effort

1. **PM2** (already used to run the backend, `docs/deploy.md` section 4):
   `pm2 monit` for a live CPU/RAM/restart view, `pm2 logs` for errors.
   Zero setup cost beyond what's already there.
2. **UptimeRobot** (free tier: 50 monitors, 5-minute interval): point an
   HTTP(s) monitor at `https://your-domain.com/api/health` and set it to
   alert (email/SMS/Slack) on anything other than a `200` with
   `"ok": true` in the body. Catches the backend being down, the database
   being unreachable, or the whole VPS being down, in one check.
3. **MySQL slow query log** (built into MySQL, just needs enabling - see
   table above): the cheapest way to find real indexing problems instead
   of guessing from the schema.
4. **goaccess** (free, open-source): point it at Nginx's access log for a
   live terminal/HTML dashboard of request rate, response times, and
   status-code breakdown, without running a separate metrics stack.
5. **UFW / fail2ban** (already partly covered by the app's own rate
   limiting on login/signup/forgot-password/uploads — `server/src/
   middleware/rateLimit.ts` — but `fail2ban` on `sshd` is a cheap extra
   layer against brute-forced server access, not application logins).

## What this app does NOT need yet

A dedicated APM (Datadog, New Relic, etc.), a log aggregator (ELK,
Loki), or a metrics time-series database (Prometheus/Grafana) — all of
these cost money or meaningful setup time, and at the traffic this app is
sized for (see the capacity estimate in `docs/production-readiness.md`)
`pm2 monit` + UptimeRobot + the slow query log catch the failure modes
that actually matter. Revisit once there's a reason to (sustained growth,
a recurring issue the above tools can't pin down).

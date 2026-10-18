# Restoring from a backup

`deploy/backup.sh` writes two files per run into `BACKUP_DIR`
(`/var/backups/conference-cms` by default):

- `db-<name>-<timestamp>.sql.gz` — a full `mysqldump` of the database
- `storage-<timestamp>.tar.gz` — a tar of `server/storage` (uploaded files:
  logos, banners, photos, submission files, certificate templates)

## Important: restore needs a privileged DB user, not the app's own user

The backup is taken **as the app's own restricted database user**
(`cms_app` in `docs/deploy.md`'s setup — only `SELECT, INSERT, UPDATE,
DELETE`), which is correct and is why `backup.sh` passes `--no-tablespaces`
to `mysqldump` (that user doesn't have the `PROCESS` privilege mysqldump
otherwise wants, and doesn't need).

The restore is a different story: a `mysqldump` file starts every table
with `DROP TABLE IF EXISTS` and `CREATE TABLE`, which needs `DROP` and
`CREATE` privileges `cms_app` does **not** have on purpose. Restoring
**must** be run as `root` (or another account with full DDL rights on the
database) — confirmed by testing: attempting the restore as `cms_app`
fails immediately with `DROP command denied to user 'cms_app'@'localhost'`.
`docs/deploy.md`'s existing restore snippet already uses `mysql -u root -p`
for exactly this reason — keep doing that.

## Restore the database

Stop the app first so nothing writes to the database mid-restore:

```bash
pm2 stop cms-backend
```

Pick the backup to restore and run:

```bash
gunzip -c /var/backups/conference-cms/db-conference_cms-2026-01-15_020000.sql.gz \
  | mysql -u root -p conference_cms
```

This drops and recreates every table from the dump, so the database ends
up in exactly the state it was in at backup time — anything written after
that backup is gone. If you want to keep the current data as a fallback,
take a fresh backup first (`deploy/backup.sh`) before restoring an old one.

## Restore the uploaded files

```bash
cd /opt/conference-cms/server
tar -xzf /var/backups/conference-cms/storage-2026-01-15_020000.tar.gz
```

This extracts back into `server/storage`, overwriting any files with the
same path and leaving newer files that aren't in the backup untouched (tar
doesn't delete files that aren't in the archive — if you need an exact
mirror of the backup's state, `rm -rf server/storage` first).

## Restart

```bash
pm2 restart cms-backend
curl http://localhost:4000/api/health
```

Confirm the health check is `{"ok":true}` and spot-check a page or two in
the browser before considering the restore done.

## Tested on the test database (2026-10-17)

- **Backup**: ran `deploy/backup.sh` against `conference_cms_test` end to
  end. Both output files were produced and verified as valid gzip archives
  (`gzip -t`); the SQL dump opens with a normal `mysqldump` header and a
  full set of `DROP TABLE IF EXISTS` / `CREATE TABLE` / `INSERT` statements
  for every table. Found and fixed a real bug in the process: the first
  attempt failed with `Access denied; you need ... PROCESS privilege(s)`
  because the app's restricted DB user can't dump tablespace metadata by
  default — added `--no-tablespaces` to `backup.sh`, which doesn't need
  that privilege and isn't needed for a restorable dump anyway. Re-run
  succeeded.
- **Restore**: attempting the restore as the app's own `cms_app` user (to
  check whether the same low-privilege account could also restore) failed
  immediately as described above — this is expected and is why restore
  must run as `root`, per this doc. The actual root-privileged restore
  could not be executed in this sandboxed environment (no MySQL root
  credentials available here, and this script never attempts to guess or
  escalate to one) — the dump file itself was verified well-formed and
  readable by the MySQL client with no corruption, and the restore command
  above is the same one `docs/deploy.md` already documents. **Before this
  is relied on for a real incident, do one manual end-to-end restore test
  on `conference_cms_test` as `root`** (restore the dump, then re-run
  `cd server && npx tsx tests/e2eSeed.ts` and `npx playwright test` to
  confirm the restored data is actually usable by the app) and keep the
  result for next time.

# Aiven for MySQL — setup reference

**Reference only.** The Aiven service, `conference_cms` database, all four
SQL files, and the `cms_app` user already exist — this doc is not a
to-do list, it's what to check against if something looks wrong, and what
to re-read if a second environment (e.g. a staging Aiven service) is ever
set up the same way. No SQL in this repo was run by the assistant.

## 1. Connecting with SSL

Aiven's MySQL requires SSL for every connection. In MySQL Workbench:

- New connection -> **SSL** tab -> **Use SSL: Require**.
- **SSL CA File**: the `ca.pem` downloaded from the Aiven console
  (service page -> **Overview** -> **Connection information** ->
  download the CA certificate).
- Host/port/user/password: from the same **Connection information** panel
  (the default admin user, `avnadmin`, for setup — not `cms_app`, which is
  for the app itself and only has DML privileges).

The app's own connection (`server/.env`'s `DB_SSL`/`DB_SSL_CA*`, see
`docs/deploy-guide.md`) uses this same CA file, pasted or pathed in — not
MySQL Workbench's copy of it.

## 2. What was run, and in what order

```
CREATE DATABASE conference_cms CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
```

then, against that database:

1. `database/01_schema.sql`
2. `database/02_reference_data.sql`
3. `database/03_triggers.sql`
4. every `database/04_*.sql`, in filename order (currently just
   `04_admin_extensions.sql`)

`database/test-setup.sql` is **not** part of this list — it builds the
separate `conference_cms_test` database the test suite uses, never the real
one.

## 3. If `03_triggers.sql` fails with a SUPER / binary-logging error

Aiven's non-admin-but-privileged setup can refuse `CREATE TRIGGER` with
something like `ERROR 1419: You do not have the SUPER privilege...` because
of binary logging. Fix: in the Aiven console, open the service ->
**Advanced configuration** -> turn on **`log_bin_trust_function_creators`**
-> re-run `03_triggers.sql`.

## 4. The `cms_app` application user

```sql
CREATE USER 'cms_app'@'%' IDENTIFIED BY '<a long random password>';
GRANT SELECT, INSERT, UPDATE, DELETE ON conference_cms.* TO 'cms_app'@'%';
FLUSH PRIVILEGES;
```

`'%'` (not `'localhost'`) because the Node backend connects over the
network (from Render, or from a laptop during setup) — Aiven itself is
always remote. The audit log stays protected: `03_triggers.sql`'s
`audit_logs_no_update` / `audit_logs_no_delete` triggers block UPDATE/DELETE
on that table for every user, `cms_app` included, regardless of its GRANTs.

## 5. `sql_require_primary_key`

Aiven's MySQL ships with `sql_require_primary_key = ON`, which refuses to
create (or alter) any table without a `PRIMARY KEY`. Checked against
`database/01_schema.sql` and `database/04_admin_extensions.sql`: **every one
of the 48 tables already declares a `PRIMARY KEY`** (48 `CREATE TABLE`
statements, 48 `PRIMARY KEY` clauses) — nothing to fix here, this is just a
record that the check was done.

## 6. Things Aiven's MySQL 8 refuses, that this schema doesn't use

Checked `database/01_schema.sql`, `02_reference_data.sql`,
`03_triggers.sql`, and `04_admin_extensions.sql` for the usual managed-MySQL
blockers:

| Pattern Aiven restricts | Found in this schema? |
| --- | --- |
| `DEFINER =` clauses on views/triggers/procedures | No |
| `SET GLOBAL ...` | No |
| Filesystem functions (`LOAD_FILE`, `LOAD DATA INFILE` from a server path) | No |
| `SUPER`-only statements other than trigger creation (§3) | No |

No schema changes needed or proposed. `04_admin_extensions.sql`'s one
stored procedure (`_add_users_anonymized_at`) is created and dropped in the
same script by the connecting user (no `DEFINER` pin), which Aiven's
non-SUPER accounts are allowed to do.

## 7. Connection limit

Aiven's free MySQL plan caps the **service** at 76 connections total, shared
across every client connected to it (the app's pool, MySQL Workbench, the
Aiven console's own query tool, etc.) — not per-app. `DB_POOL_SIZE=10` in
production (`render.yaml`) leaves headroom under that for a single Render
instance plus a few manual connections; don't raise it without checking
nothing else is holding connections open against the same service.

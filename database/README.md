# Conference Management System - MySQL database

Requires **MySQL 8.0.16 or newer** (tested on MySQL 8.0.46).
Do not use XAMPP: it ships MariaDB, which lacks REGEXP_LIKE and handles JSON differently.
On Windows, install "MySQL Community Server 8.x" with MySQL Installer (includes MySQL Workbench).

## Install (run in this order)
    mysql -u root -p < 01_schema.sql
    mysql -u root -p < 02_reference_data.sql
    mysql -u root -p < 03_triggers.sql
    mysql -u root -p < 04_admin_extensions.sql
    mysql -u root -p < 04_suggestions.sql

(MySQL Workbench: File > Open SQL Script, open each file, click the lightning icon.)

Creates database `conference_cms` with 48 tables, 10 roles, 21 permissions,
7 deadline types, 21 email templates and 14 triggers.

`04_admin_extensions.sql` adds `platform_settings` (key-value platform-wide
settings, edited from `/super-admin`) and `users.anonymized_at` (set when an
account is anonymised via the admin privacy action). Safe to re-run.

`04_suggestions.sql` adds `suggestions` (the home page "suggestion box";
public visitors can post feedback, platform admins triage it from
`/super-admin`). No IP address column — rate limiting for the public submit
endpoint is in-memory in the backend, never persisted. Safe to re-run.

## Create the application user (never let the app connect as root)
    CREATE USER 'cms_app'@'localhost' IDENTIFIED BY '<strong password>';
    GRANT SELECT, INSERT, UPDATE, DELETE ON conference_cms.* TO 'cms_app'@'localhost';
    FLUSH PRIVILEGES;

(The audit log is protected by triggers, which block UPDATE and DELETE for every user.)

## What the database enforces itself
Keys, CHECK constraints (email, phone E.164, codes, dates, scores 1-5), one active
convenor per conference, one pending role request, one active registration per person,
one corresponding author, a paper scheduled only once, no duplicate certificates,
and triggers for: room/chair/presenter clashes, presentations inside their session,
overlapping fee windows, the submission status workflow + history, locked reviews
and decisions, append-only audit log.

## What the Node backend must enforce
Who may see or change each row (MySQL has no row-level security), deadlines and
submission windows, word limits, file types and sizes, reviewer eligibility,
sessions within conference dates (time-zone aware), payments, certificate eligibility.

## Conventions for the backend
- Every connection: SET time_zone = '+00:00' (all DATETIMEs are UTC).
- At the start of each write transaction: SET @app_user_id = '<current user id>';
  (and @app_reason for withdrawals) so status history records who did it.
- Trigger errors use SQLSTATE 45000; show their message to the user as-is.
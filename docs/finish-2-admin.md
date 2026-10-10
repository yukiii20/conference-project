STEP 2 — Super admin: build ONLY the missing pieces (the rest already exists; do not rebuild).
Keep the current API convention: 401 not signed in, 403 not admin (the /super-admin page
already shows a 404 page to non-admins). Do not run SQL.

The table platform_settings already exists (database/04_platform_settings.sql):
setting_key VARCHAR(80) PK, setting_value JSON, updated_by CHAR(36) NULL, updated_at.
If database/04_platform_settings.sql is missing from the repo, create it with exactly:
CREATE TABLE IF NOT EXISTS platform_settings (setting_key VARCHAR(80) NOT NULL,
setting_value JSON NOT NULL, updated_by CHAR(36) NULL, updated_at DATETIME(3) NOT NULL
DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), PRIMARY KEY (setting_key),
CONSTRAINT platform_settings_user_fk FOREIGN KEY (updated_by) REFERENCES users (id)
ON DELETE SET NULL) ENGINE=InnoDB;   (and make test DB setup include it).

1. Admins: list platform admins; add admin (existing user by email -> platform_user_roles);
   remove admin (never the last admin, never yourself). Audit both.
2. Unlock: POST /api/admin/users/:id/unlock -> failed_login_count = 0, locked_until = NULL,
   status unchanged. "Locked until ..." badge + Unlock button in the users list.
3. View conference as admin: convenor portal in READ-ONLY mode (banner "Viewing as admin",
   save buttons disabled, server rejects writes in this mode).
4. System health card on the admin dashboard: DB ping ms, EMAIL_MODE, failed emails last
   24 h, queued emails, free disk space for server/storage. No secrets.
5. Platform settings page (platform_settings): platform name, support email, footer text,
   home hero heading/subtext, FAQ items. Public home page and footer read them (current
   texts as defaults). Sanitise, audit.
6. Anonymise user: placeholders for name/email/phone, remove photo, revoke sessions,
   status deactivated, keep submissions/reviews history. Confirm by typing the email.
   Never for an admin account.
7. Audit: pass req.ip and user-agent into insertAuditLog for all admin and auth actions.
Tests for every new route (routeGuards.test.ts must still pass); tsc, build, npm test,
Playwright; update docs/final-test-report.md.

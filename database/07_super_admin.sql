-- =====================================================================
-- Conference Management System - super administrator role (MySQL)
-- File: database/07_super_admin.sql  (run after 01..06)
--
-- Adds the platform role 'super_admin'. A super administrator is a
-- platform admin who may ALSO add/remove administrators, change platform
-- settings and lock other admin accounts. Ordinary admins keep everything
-- else (conferences, users, audit log...).
--
-- Nobody is given the role here. Until someone holds it, the backend
-- treats every admin as a super admin (exactly the old behaviour). Pick
-- your super admins in the app: Super admin -> Administrators -> "Make
-- super admin". The first grant also makes YOU one, so you can't lock
-- yourself out.
--
-- Data only (one row in `roles`), no table changes. Safe to run more than
-- once. Run it against the right database first, e.g. `USE conference_cms;`.
-- =====================================================================

INSERT IGNORE INTO roles (code, name, scope, description) VALUES
  ('super_admin', 'Super Administrator', 'platform',
   'Platform admin who can also manage administrators and platform settings');

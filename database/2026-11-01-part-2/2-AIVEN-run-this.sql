-- =====================================================================
-- STEP 2 - AIVEN (live): updates the live database only
-- Contents: 07_super_admin.sql (one roles row). Safe to run more than once.
-- Run it while connected to the Aiven database (the one DB_NAME points at).
-- =====================================================================
SET NAMES utf8mb4;
USE conference_cms;

INSERT IGNORE INTO roles (code, name, scope, description) VALUES
  ('super_admin', 'Super Administrator', 'platform',
   'Platform admin who can also manage administrators and platform settings');

SELECT 'Done - Aiven database is up to date' AS result;

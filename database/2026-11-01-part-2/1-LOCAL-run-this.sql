-- =====================================================================
-- STEP 1 - LOCAL: updates conference_cms AND conference_cms_test
-- Contents: 07_super_admin.sql (one roles row). Safe to run more than once.
-- =====================================================================
SET NAMES utf8mb4;

USE conference_cms;
INSERT IGNORE INTO roles (code, name, scope, description) VALUES
  ('super_admin', 'Super Administrator', 'platform',
   'Platform admin who can also manage administrators and platform settings');

USE conference_cms_test;
INSERT IGNORE INTO roles (code, name, scope, description) VALUES
  ('super_admin', 'Super Administrator', 'platform',
   'Platform admin who can also manage administrators and platform settings');

SELECT 'Done - local and test databases are up to date' AS result;

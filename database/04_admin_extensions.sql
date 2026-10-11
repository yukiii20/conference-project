-- =====================================================================
-- Conference Management System - admin panel extensions (MySQL)
-- File: database/04_admin_extensions.sql  (run after 01/02/03)
--
-- STATUS (checked against the live conference_cms / conference_cms_test
-- databases via information_schema before writing this file):
--  (1) platform_settings - ALREADY APPLIED by hand in both databases, as a
--      key-value table: setting_key VARCHAR(80) PK, setting_value JSON,
--      updated_by CHAR(36) NULL FK -> users(id) ON DELETE SET NULL,
--      updated_at DATETIME(3). This file only re-states that exact shape
--      with CREATE TABLE IF NOT EXISTS so it's safe to run again and so a
--      fresh database (test-setup.sql) ends up with the same table.
--  (2) users.anonymized_at - NOT YET APPLIED in either database. Added
--      here, guarded so re-running this file is a no-op if it's already
--      there. Marks a user anonymised via the admin privacy action;
--      anonymising also sets status = 'deactivated' (an existing value,
--      not a new one) - this column exists only so the action is
--      auditable/queryable without having to infer it from a placeholder
--      email pattern.
--
-- Safe to run more than once: both changes are guarded (IF NOT EXISTS /
-- information_schema check), so re-running this file does nothing on a
-- database that already has them.
-- =====================================================================
USE conference_cms;

CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key   VARCHAR(80)  NOT NULL,
  setting_value JSON         NOT NULL,
  updated_by    CHAR(36)     NULL,
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (setting_key),
  CONSTRAINT platform_settings_user_fk FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='Key-value platform-wide settings, edited from /super-admin.';

DELIMITER $$
DROP PROCEDURE IF EXISTS _add_users_anonymized_at$$
CREATE PROCEDURE _add_users_anonymized_at()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'anonymized_at'
  ) THEN
    ALTER TABLE users ADD COLUMN anonymized_at DATETIME(3) NULL AFTER status;
  END IF;
END$$
CALL _add_users_anonymized_at()$$
DROP PROCEDURE _add_users_anonymized_at$$
DELIMITER ;

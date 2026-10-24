-- =====================================================================
-- Conference Management System - name badge printing (MySQL)
-- File: database/04_badges.sql  (run after 01/02/03; independent of the
-- other 04_*.sql files)
--
-- Adds registrations.printed_at - set when a badge for that registration
-- has been generated (single or as part of a sheet), so the "Print badges"
-- screen can filter to "only not printed yet" and the desk can tell who
-- already has one. No new table: badges are generated on request (like a
-- certificate template preview), never stored - there's nothing else to
-- persist. Reuses the existing attendance.record permission (staff +
-- convenor already have it); no new permission needed.
--
-- Safe to run more than once: guarded by an information_schema check
-- (same pattern as users.anonymized_at in 04_admin_extensions.sql), so
-- re-running this file on a database that already has the column does
-- nothing.
-- =====================================================================
USE conference_cms;

DELIMITER $$
DROP PROCEDURE IF EXISTS _add_registrations_printed_at$$
CREATE PROCEDURE _add_registrations_printed_at()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'registrations' AND COLUMN_NAME = 'printed_at'
  ) THEN
    ALTER TABLE registrations ADD COLUMN printed_at DATETIME(3) NULL AFTER qr_token;
  END IF;
END$$
CALL _add_registrations_printed_at()$$
DROP PROCEDURE _add_registrations_printed_at$$
DELIMITER ;

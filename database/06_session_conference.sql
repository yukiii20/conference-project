-- =====================================================================
-- Conference Management System - sessions bound to one conference (MySQL)
-- File: database/06_session_conference.sql  (run after 01..05)
--
-- Adds auth_sessions.conference_id: the conference a person signed in at.
-- A membership only works at its own conference, so every normal sign-in
-- session is bound to exactly one conference and the backend refuses (403)
-- anything that belongs to another one. Platform admin sessions (the
-- /super-admin/login sign-in) keep conference_id = NULL.
--
-- Existing sessions are NOT changed by this file. They have
-- conference_id = NULL, which the backend treats as invalid for a normal
-- (non-admin) session: those people are simply asked to sign in again at
-- their conference. No rows are deleted.
--
-- The foreign key uses ON DELETE CASCADE only for a hard delete of a
-- conference row (the app itself soft-deletes via conferences.deleted_at,
-- and the backend already ends sessions bound to a soft-deleted one).
--
-- Safe to run more than once: each step is guarded by an
-- information_schema check (same pattern as 04_badges.sql).
--
-- Run it against the right database first, e.g. `USE conference_cms;`
-- locally, or the Aiven database your DB_NAME points at.
-- =====================================================================

DELIMITER $$
DROP PROCEDURE IF EXISTS _add_auth_sessions_conference_id$$
CREATE PROCEDURE _add_auth_sessions_conference_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_sessions' AND COLUMN_NAME = 'conference_id'
  ) THEN
    ALTER TABLE auth_sessions ADD COLUMN conference_id CHAR(36) NULL AFTER is_admin_session;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_sessions' AND INDEX_NAME = 'auth_sessions_conference_idx'
  ) THEN
    ALTER TABLE auth_sessions ADD KEY auth_sessions_conference_idx (conference_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_sessions'
      AND CONSTRAINT_NAME = 'auth_sessions_conference_fk' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE auth_sessions
      ADD CONSTRAINT auth_sessions_conference_fk FOREIGN KEY (conference_id) REFERENCES conferences (id) ON DELETE CASCADE;
  END IF;
END$$
CALL _add_auth_sessions_conference_id()$$
DROP PROCEDURE _add_auth_sessions_conference_id$$
DELIMITER ;

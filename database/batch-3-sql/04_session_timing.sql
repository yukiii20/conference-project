-- =====================================================================
-- Conference Management System - session timer timings (MySQL)
-- File: database/batch-3-sql/04_session_timing.sql  (run after 01/02/03;
-- independent of the other 04_*.sql files)
--
-- Adds:
--  (1) conference_settings.timer_talk_minutes / timer_qa_minutes - the
--      conference-wide default talk and Q&A time the session chair's
--      full-screen timer uses for every talk (default 15 + 5 minutes).
--  (2) conference_sessions.timer_talk_minutes / timer_qa_minutes - an
--      optional per-session override the convenor sets from the
--      programme editor (NULL = use the conference default above), e.g.
--      a 25 + 5 minute keynote slot.
--      No new permission: the convenor changes timings through the
--      existing `schedule.manage` permission; chairs only read them.
--
-- Safe to run more than once: every column addition is guarded by an
-- information_schema check, so re-running this file does nothing.
-- =====================================================================
USE conference_cms;

DELIMITER $$
DROP PROCEDURE IF EXISTS _add_session_timing_columns$$
CREATE PROCEDURE _add_session_timing_columns()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conference_settings' AND COLUMN_NAME = 'timer_talk_minutes'
  ) THEN
    ALTER TABLE conference_settings
      ADD COLUMN timer_talk_minutes SMALLINT NOT NULL DEFAULT 15 AFTER default_currency,
      ADD COLUMN timer_qa_minutes   SMALLINT NOT NULL DEFAULT 5  AFTER timer_talk_minutes,
      ADD CONSTRAINT conference_settings_timer_chk CHECK (timer_talk_minutes BETWEEN 1 AND 240 AND timer_qa_minutes BETWEEN 0 AND 120);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conference_sessions' AND COLUMN_NAME = 'timer_talk_minutes'
  ) THEN
    ALTER TABLE conference_sessions
      ADD COLUMN timer_talk_minutes SMALLINT NULL AFTER status,
      ADD COLUMN timer_qa_minutes   SMALLINT NULL AFTER timer_talk_minutes,
      ADD CONSTRAINT conference_sessions_timer_chk CHECK (
        (timer_talk_minutes IS NULL OR timer_talk_minutes BETWEEN 1 AND 240)
        AND (timer_qa_minutes IS NULL OR timer_qa_minutes BETWEEN 0 AND 120));
  END IF;
END$$
CALL _add_session_timing_columns()$$
DROP PROCEDURE _add_session_timing_columns$$
DELIMITER ;

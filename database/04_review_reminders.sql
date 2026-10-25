-- =====================================================================
-- Conference Management System - review reminders (MySQL)
-- File: database/04_review_reminders.sql  (run after 01/02/03; independent
-- of the other 04_*.sql files)
--
-- Adds:
--  (1) conference_settings.review_reminders_enabled / review_reminder_days_before
--      / review_overdue_reminder_enabled - the Review settings tab's
--      reminder controls. review_reminder_days_before is a JSON array of
--      whole numbers (default [3, 1]) - how many days before due_at a
--      not-yet-submitted review gets nudged; review_overdue_reminder_enabled
--      gates a separate once-only nudge after due_at has passed.
--  (2) review_reminders - records which automatic reminder has already
--      gone out for a given review_assignments row, so the hourly
--      background job (server/src/jobs/reviewReminders.ts) sends each one
--      exactly once even with two servers running: it always tries an
--      INSERT first and only queues the email if the insert actually
--      happened (a duplicate hits the unique key and is silently skipped -
--      no SELECT-then-INSERT race). `kind` is 'before_<N>' (N = a value
--      from review_reminder_days_before at the time it was sent) or
--      'overdue'. triggered_by is NULL for the automatic job, or the
--      convenor's user id for a manual "Send reminder now" click recorded
--      here too so it still counts toward "sent once" for that kind.
--      No new permission: reminder actions reuse the existing
--      `review.assign` permission (convenor + manager already have it).
--
-- Safe to run more than once: the column additions are guarded
-- (information_schema check), the table is CREATE TABLE IF NOT EXISTS, and
-- the email template inserts are INSERT IGNORE - so re-running this file on
-- a database that already has these changes does nothing.
-- =====================================================================
USE conference_cms;

DELIMITER $$
DROP PROCEDURE IF EXISTS _add_review_reminder_settings$$
CREATE PROCEDURE _add_review_reminder_settings()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conference_settings' AND COLUMN_NAME = 'review_reminders_enabled'
  ) THEN
    ALTER TABLE conference_settings
      ADD COLUMN review_reminders_enabled        BOOLEAN NOT NULL DEFAULT TRUE AFTER default_currency,
      ADD COLUMN review_reminder_days_before      JSON    NOT NULL DEFAULT (JSON_ARRAY(3, 1)) AFTER review_reminders_enabled,
      ADD COLUMN review_overdue_reminder_enabled  BOOLEAN NOT NULL DEFAULT TRUE AFTER review_reminder_days_before,
      ADD CONSTRAINT conference_settings_reminder_days_chk CHECK (JSON_TYPE(review_reminder_days_before) = 'ARRAY');
  END IF;
END$$
CALL _add_review_reminder_settings()$$
DROP PROCEDURE _add_review_reminder_settings$$
DELIMITER ;

CREATE TABLE IF NOT EXISTS review_reminders (
  id             CHAR(36)    NOT NULL DEFAULT (UUID()),
  assignment_id  CHAR(36)    NOT NULL,
  kind           VARCHAR(20) NOT NULL,
  sent_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  triggered_by   CHAR(36)    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY review_reminders_uq (assignment_id, kind),
  CONSTRAINT review_reminders_assignment_fk FOREIGN KEY (assignment_id) REFERENCES review_assignments (id),
  CONSTRAINT review_reminders_user_fk       FOREIGN KEY (triggered_by)  REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
  COMMENT='Which automatic review-due reminder (kind = before_<days> or overdue) has been sent for each assignment, so it is sent at most once.';

INSERT IGNORE INTO email_templates (conference_id, template_key, subject, body_html) VALUES
  (NULL, 'review_reminder', '[{{conference_code}}] Reminder: review due {{due_at}}',
         '<p>Dear {{full_name}},</p><p>This is a reminder that your review of "{{title}}" ({{submission_code}}) is due {{due_at}}.</p>'),
  (NULL, 'review_overdue',  '[{{conference_code}}] Overdue: review of {{submission_code}}',
         '<p>Dear {{full_name}},</p><p>Your review of "{{title}}" ({{submission_code}}) was due {{due_at}} and has not been submitted yet. Please submit it as soon as you can.</p>');

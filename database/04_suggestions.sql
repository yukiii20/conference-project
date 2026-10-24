-- =====================================================================
-- Conference Management System - suggestion box (MySQL)
-- File: database/04_suggestions.sql  (run after 01/02/03; independent of
-- 04_admin_extensions.sql — order between the two 04_*.sql files doesn't matter)
--
-- Adds a single new table, suggestions: public visitors (logged in or not)
-- can send feedback/bug reports from the home page; platform admins triage
-- them from /super-admin.
--
-- Privacy: no IP address column on purpose. Rate limiting for the public
-- POST endpoint is enforced in the Node backend using an in-memory store,
-- never written to this table or any other.
--
-- Safe to run more than once: CREATE TABLE IF NOT EXISTS.
-- =====================================================================
USE conference_cms;

CREATE TABLE IF NOT EXISTS suggestions (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  name        VARCHAR(120) NULL,
  email       VARCHAR(254) NULL,
  category    ENUM('feature','bug','question','other') NOT NULL DEFAULT 'other',
  message     VARCHAR(2000) NOT NULL,
  page_url    VARCHAR(500) NULL,
  user_id     CHAR(36)     NULL,
  status      ENUM('new','read','in_progress','resolved','archived') NOT NULL DEFAULT 'new',
  admin_note  VARCHAR(2000) NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  handled_by  CHAR(36)     NULL,
  PRIMARY KEY (id),
  KEY suggestions_status_created_idx (status, created_at),
  CONSTRAINT suggestions_user_fk    FOREIGN KEY (user_id)    REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT suggestions_handler_fk FOREIGN KEY (handled_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT suggestions_email_chk  CHECK (email IS NULL OR REGEXP_LIKE(email, '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$')),
  CONSTRAINT suggestions_message_chk CHECK (CHAR_LENGTH(TRIM(message)) BETWEEN 1 AND 2000)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
  COMMENT='Public suggestion box (home page) triaged from /super-admin. No IP address stored.';

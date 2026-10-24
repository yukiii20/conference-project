-- =====================================================================
-- Conference Management System - bulk email to groups (MySQL)
-- File: database/04_bulk_email.sql  (run after 01/02/03; independent of
-- 04_admin_extensions.sql and 04_suggestions.sql)
--
-- Adds:
--  (1) bulk_emails - one row per compose/send from the convenor's
--      Communication -> Bulk email tab. Stores the subject and sanitised
--      body HTML (with {{placeholder}} tokens) the convenor composed, plus
--      which recipient groups they picked. The email worker loads body_html
--      from here (by bulk_email_id in each email_logs.template_data) the
--      same way it loads a stored template's body_html for every other
--      email - see server/src/email/worker.ts. A draft row (status='draft')
--      has never been sent; 'sent' rows are immutable history.
--  (2) bulk_email_recipients - one row per person the send went to (or
--      would go to, for a draft that's only been previewed - draft rows
--      have no recipients yet). Links to the email_logs row so per-
--      recipient delivery status can be read live via a JOIN, never
--      duplicated here. recipient_name is a snapshot (not every author has
--      an account to join users against).
--  (3) permission 'communication.bulk_email' - convenor gets it explicitly
--      below (the blanket "convenor gets every permission" INSERT in
--      02_reference_data.sql already ran before this permission existed).
--      Manager does NOT get it here on purpose: default off, per the spec.
--      role_permissions has no conference_id column (every role's grants
--      are platform-wide - see 02_reference_data.sql), so there's no "turn
--      it on for this one manager" UI action; switching it on for managers
--      everywhere is a one-row data change:
--        INSERT INTO role_permissions (role_code, permission_code) VALUES ('manager', 'communication.bulk_email');
--
-- Safe to run more than once: every statement is IF NOT EXISTS / INSERT
-- IGNORE, so re-running this file on a database that already has these
-- changes does nothing.
-- =====================================================================
USE conference_cms;

CREATE TABLE IF NOT EXISTS bulk_emails (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()),
  conference_id     CHAR(36)     NOT NULL,
  created_by        CHAR(36)     NOT NULL,
  subject           VARCHAR(300) NOT NULL,
  body_html         TEXT         NOT NULL,
  recipient_groups  JSON         NOT NULL DEFAULT (JSON_ARRAY()),
  status            ENUM('draft','sent') NOT NULL DEFAULT 'draft',
  recipient_count   INT          NOT NULL DEFAULT 0,
  sent_at           DATETIME(3)  NULL,
  created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY bulk_emails_conf_created_idx (conference_id, created_at),
  CONSTRAINT bulk_emails_conf_fk    FOREIGN KEY (conference_id) REFERENCES conferences (id),
  CONSTRAINT bulk_emails_creator_fk FOREIGN KEY (created_by)    REFERENCES users (id),
  CONSTRAINT bulk_emails_subject_chk CHECK (CHAR_LENGTH(TRIM(subject)) BETWEEN 1 AND 300),
  CONSTRAINT bulk_emails_body_chk    CHECK (CHAR_LENGTH(TRIM(body_html)) BETWEEN 1 AND 20000),
  CONSTRAINT bulk_emails_groups_chk  CHECK (JSON_TYPE(recipient_groups) = 'ARRAY')
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
  COMMENT='Bulk emails composed/sent from the convenor Communication -> Bulk email tab.';

CREATE TABLE IF NOT EXISTS bulk_email_recipients (
  id               BIGINT       NOT NULL AUTO_INCREMENT,
  bulk_email_id    CHAR(36)     NOT NULL,
  email_log_id     BIGINT       NULL,
  user_id          CHAR(36)     NULL,
  recipient_email  VARCHAR(254) NOT NULL,
  recipient_name   VARCHAR(200) NULL,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY bulk_email_recipients_uq (bulk_email_id, recipient_email),
  KEY bulk_email_recipients_user_idx (user_id),
  KEY bulk_email_recipients_log_idx (email_log_id),
  CONSTRAINT bulk_email_recipients_bulk_fk FOREIGN KEY (bulk_email_id) REFERENCES bulk_emails (id) ON DELETE CASCADE,
  CONSTRAINT bulk_email_recipients_log_fk  FOREIGN KEY (email_log_id)  REFERENCES email_logs (id)  ON DELETE SET NULL,
  CONSTRAINT bulk_email_recipients_user_fk FOREIGN KEY (user_id)       REFERENCES users (id)       ON DELETE SET NULL
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
  COMMENT='One row per person a bulk email was sent to; email_log_id is the live delivery status.';

INSERT IGNORE INTO permissions (code, module, description) VALUES
  ('communication.bulk_email', 'communication', 'Compose and send bulk email to recipient groups');

-- Convenor: grant explicitly (the blanket "every permission" grant in
-- 02_reference_data.sql ran before this permission existed). Manager: not
-- granted here - default off (see the file header above for how to change it).
INSERT IGNORE INTO role_permissions (role_code, permission_code) VALUES
  ('convenor', 'communication.bulk_email');

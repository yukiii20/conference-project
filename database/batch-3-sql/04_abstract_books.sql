-- =====================================================================
-- Conference Management System - book of abstracts (MySQL)
-- File: database/batch-3-sql/04_abstract_books.sql  (run after 01/02/03;
-- independent of the other 04_*.sql files)
--
-- Adds:
--  abstract_books - at most one row per conference: the most recently
--      generated book-of-abstracts PDF (stored under the private storage
--      folder, path in file_path), the options it was generated with, how
--      many abstracts/pages it holds, and the "Publish on conference page"
--      toggle (is_published) that turns on the public download link.
--      Re-generating replaces the file and keeps the publish toggle.
--      No new permission: generating and publishing reuse the existing
--      `schedule.manage` permission (same people who build the programme).
--
-- Safe to run more than once: CREATE TABLE IF NOT EXISTS.
-- =====================================================================
USE conference_cms;

CREATE TABLE IF NOT EXISTS abstract_books (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()),
  conference_id   CHAR(36)     NOT NULL,
  file_path       VARCHAR(500) NOT NULL,
  options         JSON         NOT NULL DEFAULT (JSON_OBJECT()),
  abstract_count  INT          NOT NULL DEFAULT 0,
  page_count      INT          NOT NULL DEFAULT 0,
  is_published    BOOLEAN      NOT NULL DEFAULT FALSE,
  generated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  generated_by    CHAR(36)     NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY abstract_books_conf_uq (conference_id),
  CONSTRAINT abstract_books_conf_fk FOREIGN KEY (conference_id) REFERENCES conferences (id),
  CONSTRAINT abstract_books_user_fk FOREIGN KEY (generated_by)  REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT abstract_books_options_chk CHECK (JSON_TYPE(options) = 'OBJECT')
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
  COMMENT='Latest generated book-of-abstracts PDF per conference, plus its public-download toggle.';

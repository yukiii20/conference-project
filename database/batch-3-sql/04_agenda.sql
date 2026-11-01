-- =====================================================================
-- Conference Management System - My agenda + calendar feed (MySQL)
-- File: database/batch-3-sql/04_agenda.sql  (run after 01/02/03; independent of the
-- other 04_*.sql files)
--
-- Adds:
--  (1) agenda_items - one row per (user, session) a person has starred
--      with the star button on the public programme or in the portal.
--      Only explicit stars are stored: authors' own presentations and
--      chairs' own sessions are added to "My agenda" automatically by the
--      backend from presentations / session_chairs at read time (and shown
--      as marked), so they can never go stale. Deleting a session removes
--      its stars (ON DELETE CASCADE).
--  (2) agenda_feed_tokens - one secret per (user, conference) for the
--      private calendar-feed URL (/api/calendar/<token>.ics) that Google
--      Calendar / Outlook subscribe to. Anyone holding the URL can read
--      that one person's agenda for that one conference and nothing else;
--      "Reset link" replaces the token, so the old URL stops working at
--      once. The token is random (32 bytes, hex) and stored as-is so the
--      portal can show the URL again (same approach as
--      certificates.verification_token).
--      No new permission: everyone manages only their own agenda, checked
--      by signed-in user on the server.
--
-- Safe to run more than once: both tables are CREATE TABLE IF NOT EXISTS,
-- so re-running this file on a database that already has them does
-- nothing.
-- =====================================================================
USE conference_cms;

CREATE TABLE IF NOT EXISTS agenda_items (
  id             CHAR(36)    NOT NULL DEFAULT (UUID()),
  conference_id  CHAR(36)    NOT NULL,
  user_id        CHAR(36)    NOT NULL,
  session_id     CHAR(36)    NOT NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY agenda_items_uq (user_id, session_id),
  KEY agenda_items_conf_user_idx (conference_id, user_id),
  KEY agenda_items_session_idx (session_id),
  CONSTRAINT agenda_items_session_fk FOREIGN KEY (session_id, conference_id) REFERENCES conference_sessions (id, conference_id) ON DELETE CASCADE,
  CONSTRAINT agenda_items_user_fk    FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
  COMMENT='Sessions a person starred for My agenda (automatic author/chair entries are not stored).';

CREATE TABLE IF NOT EXISTS agenda_feed_tokens (
  id             CHAR(36)    NOT NULL DEFAULT (UUID()),
  conference_id  CHAR(36)    NOT NULL,
  user_id        CHAR(36)    NOT NULL,
  token          CHAR(64)    NOT NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY agenda_feed_tokens_user_uq (conference_id, user_id),
  UNIQUE KEY agenda_feed_tokens_token_uq (token),
  CONSTRAINT agenda_feed_tokens_conf_fk FOREIGN KEY (conference_id) REFERENCES conferences (id),
  CONSTRAINT agenda_feed_tokens_user_fk FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT agenda_feed_tokens_token_chk CHECK (REGEXP_LIKE(token, '^[0-9a-f]{64}$', 'c'))
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
  COMMENT='Secret token behind each person''s private My agenda calendar-feed URL (resettable).';

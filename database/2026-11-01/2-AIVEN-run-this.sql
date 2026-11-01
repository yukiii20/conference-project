-- =====================================================================
-- STEP 2 - AIVEN (live): updates conference_cms only
-- Built by build.sh on 2026-11-01. Everything here is safe to run
-- more than once: tables/columns are only added when missing, nothing is
-- deleted. Contents: My agenda, session timer, book of abstracts, feedback
-- survey (batch 3) + sessions bound to one conference (06).
-- =====================================================================
SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ===================== conference_cms (Aiven) =====================

-- ---------- 04_agenda.sql (conference_cms) ----------
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

-- ---------- 04_session_timing.sql (conference_cms) ----------
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

-- ---------- 04_abstract_books.sql (conference_cms) ----------
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

-- ---------- 04_feedback.sql (conference_cms) ----------
-- =====================================================================
-- Conference Management System - feedback survey (MySQL)
-- File: database/batch-3-sql/04_feedback.sql  (run after 01/02/03;
-- independent of the other 04_*.sql files)
--
-- Adds:
--  (1) feedback_surveys - at most one survey per conference, with the
--      window it is open (opens_at/closes_at, both required before it can
--      be opened), whether it is switched on at all (is_open), and whether
--      respondents may answer anonymously (allow_anonymous).
--  (2) feedback_questions - the survey's questions in order. The standard
--      ones (overall / organisation / venue / sessions ratings, best
--      session pick, comments) are created with the survey and carry a
--      builtin_key; the convenor's own custom questions have builtin_key
--      NULL. kind: rating (1-5), text, choice (options = JSON array of
--      strings) or session (pick one session from the programme).
--  (3) feedback_responses - one per person per survey (UNIQUE survey_id,
--      user_id). user_id is stored ONLY to stop a second response; when
--      is_anonymous is TRUE the backend never returns it to the convenor.
--  (4) feedback_answers - one row per answered question per response.
--  (5) feedback_invitations - who has already been emailed the survey
--      link, so bulk invitations can be spread over several days to stay
--      under Brevo's 300/day free limit and nobody is emailed twice.
--  (6) The 'feedback_invitation' email template.
--      No new permission: the convenor builds the survey and reads results
--      through the existing `conference.manage` permission; eligible people
--      answer on their own behalf, checked on the server.
--
-- Safe to run more than once: CREATE TABLE IF NOT EXISTS / INSERT IGNORE.
-- =====================================================================
USE conference_cms;

CREATE TABLE IF NOT EXISTS feedback_surveys (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  conference_id    CHAR(36)     NOT NULL,
  title            VARCHAR(200) NOT NULL,
  intro            VARCHAR(2000) NULL,
  is_open          BOOLEAN      NOT NULL DEFAULT FALSE,
  opens_at         DATETIME(3)  NULL,
  closes_at        DATETIME(3)  NULL,
  allow_anonymous  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by       CHAR(36)     NULL,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY feedback_surveys_conf_uq (conference_id),
  UNIQUE KEY feedback_surveys_id_conf_uq (id, conference_id),
  CONSTRAINT feedback_surveys_conf_fk    FOREIGN KEY (conference_id) REFERENCES conferences (id),
  CONSTRAINT feedback_surveys_creator_fk FOREIGN KEY (created_by)    REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT feedback_surveys_title_chk  CHECK (CHAR_LENGTH(TRIM(title)) BETWEEN 2 AND 200),
  CONSTRAINT feedback_surveys_dates_chk  CHECK (opens_at IS NULL OR closes_at IS NULL OR closes_at > opens_at)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
  COMMENT='One post-conference feedback survey per conference.';

CREATE TABLE IF NOT EXISTS feedback_questions (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  survey_id    CHAR(36)     NOT NULL,
  position     SMALLINT     NOT NULL,
  builtin_key  VARCHAR(30)  NULL,
  kind         ENUM('rating','text','choice','session') NOT NULL,
  prompt       VARCHAR(300) NOT NULL,
  options      JSON         NOT NULL DEFAULT (JSON_ARRAY()),
  is_required  BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY feedback_questions_builtin_uq (survey_id, builtin_key),
  KEY feedback_questions_survey_idx (survey_id, position),
  CONSTRAINT feedback_questions_survey_fk FOREIGN KEY (survey_id) REFERENCES feedback_surveys (id) ON DELETE CASCADE,
  CONSTRAINT feedback_questions_prompt_chk CHECK (CHAR_LENGTH(TRIM(prompt)) BETWEEN 2 AND 300),
  CONSTRAINT feedback_questions_options_chk CHECK (JSON_TYPE(options) = 'ARRAY')
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
  COMMENT='Questions of a feedback survey; builtin_key marks the standard ones.';

CREATE TABLE IF NOT EXISTS feedback_responses (
  id             CHAR(36)    NOT NULL DEFAULT (UUID()),
  survey_id      CHAR(36)    NOT NULL,
  conference_id  CHAR(36)    NOT NULL,
  user_id        CHAR(36)    NOT NULL,
  is_anonymous   BOOLEAN     NOT NULL DEFAULT FALSE,
  submitted_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY feedback_responses_once_uq (survey_id, user_id),
  KEY feedback_responses_conf_idx (conference_id),
  CONSTRAINT feedback_responses_survey_fk FOREIGN KEY (survey_id, conference_id) REFERENCES feedback_surveys (id, conference_id) ON DELETE CASCADE,
  CONSTRAINT feedback_responses_user_fk   FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
  COMMENT='One response per person per survey; user_id is for de-duplication only when is_anonymous.';

CREATE TABLE IF NOT EXISTS feedback_answers (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()),
  response_id    CHAR(36)     NOT NULL,
  question_id    CHAR(36)     NOT NULL,
  rating         TINYINT      NULL,
  text_value     TEXT         NULL,
  choice_value   VARCHAR(200) NULL,
  session_id     CHAR(36)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY feedback_answers_uq (response_id, question_id),
  KEY feedback_answers_question_idx (question_id),
  CONSTRAINT feedback_answers_response_fk FOREIGN KEY (response_id) REFERENCES feedback_responses (id) ON DELETE CASCADE,
  CONSTRAINT feedback_answers_question_fk FOREIGN KEY (question_id) REFERENCES feedback_questions (id) ON DELETE CASCADE,
  CONSTRAINT feedback_answers_session_fk  FOREIGN KEY (session_id)  REFERENCES conference_sessions (id) ON DELETE SET NULL,
  CONSTRAINT feedback_answers_rating_chk  CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
  COMMENT='Answers to feedback survey questions.';

CREATE TABLE IF NOT EXISTS feedback_invitations (
  id          CHAR(36)    NOT NULL DEFAULT (UUID()),
  survey_id   CHAR(36)    NOT NULL,
  user_id     CHAR(36)    NOT NULL,
  sent_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY feedback_invitations_uq (survey_id, user_id),
  CONSTRAINT feedback_invitations_survey_fk FOREIGN KEY (survey_id) REFERENCES feedback_surveys (id) ON DELETE CASCADE,
  CONSTRAINT feedback_invitations_user_fk   FOREIGN KEY (user_id)   REFERENCES users (id)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
  COMMENT='Who has been emailed the feedback survey link (sent once each).';

INSERT IGNORE INTO email_templates (conference_id, template_key, subject, body_html) VALUES
  (NULL, 'feedback_invitation', '[{{conference_code}}] Tell us how {{conference_name}} went',
         '<p>Dear {{full_name}},</p><p>Thank you for taking part in {{conference_name}}. We would love to hear your feedback - it takes about two minutes.</p><p><a href="{{link}}">Give feedback</a></p><p>The survey closes {{closes_at}}.</p>');

-- ---------- 06_session_conference.sql (conference_cms) ----------
USE conference_cms;
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

SELECT 'Done - Aiven database is up to date' AS result;

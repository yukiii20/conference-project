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

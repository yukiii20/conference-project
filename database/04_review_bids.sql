-- =====================================================================
-- Conference Management System - reviewer bidding (MySQL)
-- File: database/04_review_bids.sql  (run after 01/02/03; independent of
-- the other 04_*.sql files)
--
-- Adds:
--  (1) conference_settings.bidding_enabled / bidding_start_at / bidding_end_at
--      - the "Bidding period" toggle + window shown on the convenor's
--      Review settings tab. Bidding is only open when bidding_enabled is
--      TRUE and now() falls between the two dates (either side may be
--      NULL on its own, but the backend requires both before switching
--      bidding_enabled on). Nothing reads these yet outside this feature.
--  (2) review_bids - one row per (submission, reviewer): the reviewer's
--      self-reported preference, set instantly from the reviewer portal's
--      "Bid on papers" screen (list shows title/track/keywords/abstract
--      only - never author names/affiliations/files, same blind-review
--      rule as everywhere else reviewers see a paper). The convenor's
--      Assign screen reads this to show each reviewer's bid next to their
--      name, and the Auto-assign wizard (04_review_bids.sql has no
--      dependency on 04_review_reminders.sql; auto-assign needs no schema
--      change of its own) uses it to prioritise Want > Can > no bid, and
--      to always exclude a declared Conflict.
--      No new permission: reviewers bid on their own behalf (checked by
--      conference membership, like submitting a review), and the convenor
--      already reads bids through the existing `review.assign` permission.
--
-- Safe to run more than once: the column additions are guarded
-- (information_schema check) and the table is CREATE TABLE IF NOT EXISTS,
-- so re-running this file on a database that already has these changes
-- does nothing.
-- =====================================================================
USE conference_cms;

DELIMITER $$
DROP PROCEDURE IF EXISTS _add_review_bidding_settings$$
CREATE PROCEDURE _add_review_bidding_settings()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conference_settings' AND COLUMN_NAME = 'bidding_enabled'
  ) THEN
    ALTER TABLE conference_settings
      ADD COLUMN bidding_enabled   BOOLEAN     NOT NULL DEFAULT FALSE AFTER authors_see_review_comments,
      ADD COLUMN bidding_start_at  DATETIME(3) NULL     AFTER bidding_enabled,
      ADD COLUMN bidding_end_at    DATETIME(3) NULL     AFTER bidding_start_at;
  END IF;
END$$
CALL _add_review_bidding_settings()$$
DROP PROCEDURE _add_review_bidding_settings$$
DELIMITER ;

CREATE TABLE IF NOT EXISTS review_bids (
  id             CHAR(36)    NOT NULL DEFAULT (UUID()),
  conference_id  CHAR(36)    NOT NULL,
  submission_id  CHAR(36)    NOT NULL,
  reviewer_id    CHAR(36)    NOT NULL,
  preference     ENUM('want','can','not_interested','conflict') NOT NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY review_bids_uq (submission_id, reviewer_id),
  KEY review_bids_conf_reviewer_idx (conference_id, reviewer_id),
  CONSTRAINT review_bids_sub_fk      FOREIGN KEY (submission_id, conference_id) REFERENCES submissions (id, conference_id),
  CONSTRAINT review_bids_reviewer_fk FOREIGN KEY (reviewer_id) REFERENCES users (id)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
  COMMENT='Reviewer bids (want/can/not_interested/conflict) from the reviewer portal Bid on papers screen.';

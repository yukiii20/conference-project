-- =====================================================================
-- Conference Management System - database-level rules (MySQL triggers)
-- File: database/03_triggers.sql  (run after 02_reference_data.sql)
-- =====================================================================
-- MySQL has no exclusion constraints and no row-level security, so most
-- rules live in the Node backend. These triggers are a safety net for the
-- rules that must NEVER be broken, even by a bug in the backend:
--   1. no two sessions in the same room at overlapping times
--   2. presentations fit inside their session and don't overlap each other
--   3. a person can't present twice, or present and chair, at the same time
--   4. a chair can't chair two overlapping sessions
--   5. no overlapping active price windows for one registration category
--   6. submission status can only move along the allowed workflow
--   7. every status change is recorded in submission_status_history
--   8. submitted reviews and recorded decisions are locked
--   9. the audit log is append-only
--
-- The backend sets @app_user_id = '<user uuid>' at the start of each
-- request transaction so history rows know who made the change.
-- Error messages use SQLSTATE 45000 so the backend can show them as-is.
-- Run with the mysql client (it understands DELIMITER), MySQL Workbench,
-- or phpMyAdmin with the delimiter field set to $$.
-- =====================================================================
USE conference_cms;

DROP TRIGGER IF EXISTS sessions_room_overlap_bi;
DROP TRIGGER IF EXISTS sessions_room_overlap_bu;
DROP TRIGGER IF EXISTS presentations_rules_bi;
DROP TRIGGER IF EXISTS presentations_rules_bu;
DROP TRIGGER IF EXISTS session_chairs_overlap_bi;
DROP TRIGGER IF EXISTS fees_overlap_bi;
DROP TRIGGER IF EXISTS fees_overlap_bu;
DROP TRIGGER IF EXISTS submissions_transition_bu;
DROP TRIGGER IF EXISTS submissions_history_ai;
DROP TRIGGER IF EXISTS submissions_history_au;
DROP TRIGGER IF EXISTS reviews_lock_bu;
DROP TRIGGER IF EXISTS decisions_lock_bu;
DROP TRIGGER IF EXISTS audit_logs_no_update;
DROP TRIGGER IF EXISTS audit_logs_no_delete;

DELIMITER $$

-- ---------------------------------------------------------------------
-- 1. Room clash between sessions
-- ---------------------------------------------------------------------
CREATE TRIGGER sessions_room_overlap_bi BEFORE INSERT ON conference_sessions
FOR EACH ROW
BEGIN
  IF NEW.status <> 'cancelled' AND EXISTS (
       SELECT 1 FROM conference_sessions s
       WHERE s.room_id = NEW.room_id AND s.status <> 'cancelled'
         AND s.starts_at < NEW.ends_at AND s.ends_at > NEW.starts_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This room already has a session at that time.';
  END IF;
END$$

CREATE TRIGGER sessions_room_overlap_bu BEFORE UPDATE ON conference_sessions
FOR EACH ROW
BEGIN
  IF NEW.status <> 'cancelled' AND EXISTS (
       SELECT 1 FROM conference_sessions s
       WHERE s.id <> NEW.id AND s.room_id = NEW.room_id AND s.status <> 'cancelled'
         AND s.starts_at < NEW.ends_at AND s.ends_at > NEW.starts_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This room already has a session at that time.';
  END IF;
  IF (NEW.starts_at <> OLD.starts_at OR NEW.ends_at <> OLD.ends_at) AND EXISTS (
       SELECT 1 FROM presentations p
       WHERE p.session_id = NEW.id AND p.status <> 'cancelled'
         AND (p.starts_at < NEW.starts_at OR p.ends_at > NEW.ends_at)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Some presentations would fall outside the new session time. Move them first.';
  END IF;
END$$

-- ---------------------------------------------------------------------
-- 2 + 3. Presentation rules
-- ---------------------------------------------------------------------
CREATE TRIGGER presentations_rules_bi BEFORE INSERT ON presentations
FOR EACH ROW
BEGIN
  DECLARE v_start DATETIME(3);
  DECLARE v_end   DATETIME(3);
  SELECT starts_at, ends_at INTO v_start, v_end FROM conference_sessions WHERE id = NEW.session_id;

  IF NEW.starts_at < v_start OR NEW.ends_at > v_end THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A presentation must fit inside its session time.';
  END IF;
  IF NEW.status <> 'cancelled' THEN
    IF EXISTS (SELECT 1 FROM presentations p
               WHERE p.session_id = NEW.session_id AND p.status <> 'cancelled'
                 AND p.starts_at < NEW.ends_at AND p.ends_at > NEW.starts_at) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Another presentation in this session overlaps that time.';
    END IF;
    IF NEW.presenter_user_id IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM presentations p
                 WHERE p.presenter_user_id = NEW.presenter_user_id AND p.status <> 'cancelled'
                   AND p.starts_at < NEW.ends_at AND p.ends_at > NEW.starts_at) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This presenter already has another presentation at that time.';
      END IF;
      IF EXISTS (SELECT 1 FROM session_chairs c JOIN conference_sessions s ON s.id = c.session_id
                 WHERE c.user_id = NEW.presenter_user_id AND s.status <> 'cancelled'
                   AND s.id <> NEW.session_id
                   AND s.starts_at < NEW.ends_at AND s.ends_at > NEW.starts_at) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This presenter is chairing another session at that time.';
      END IF;
    END IF;
  END IF;
END$$

CREATE TRIGGER presentations_rules_bu BEFORE UPDATE ON presentations
FOR EACH ROW
BEGIN
  DECLARE v_start DATETIME(3);
  DECLARE v_end   DATETIME(3);
  SELECT starts_at, ends_at INTO v_start, v_end FROM conference_sessions WHERE id = NEW.session_id;

  IF NEW.starts_at < v_start OR NEW.ends_at > v_end THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A presentation must fit inside its session time.';
  END IF;
  IF NEW.status <> 'cancelled' THEN
    IF EXISTS (SELECT 1 FROM presentations p
               WHERE p.id <> NEW.id AND p.session_id = NEW.session_id AND p.status <> 'cancelled'
                 AND p.starts_at < NEW.ends_at AND p.ends_at > NEW.starts_at) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Another presentation in this session overlaps that time.';
    END IF;
    IF NEW.presenter_user_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM presentations p
         WHERE p.id <> NEW.id AND p.presenter_user_id = NEW.presenter_user_id AND p.status <> 'cancelled'
           AND p.starts_at < NEW.ends_at AND p.ends_at > NEW.starts_at) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This presenter already has another presentation at that time.';
    END IF;
  END IF;
END$$

-- ---------------------------------------------------------------------
-- 4. Chair clash
-- ---------------------------------------------------------------------
CREATE TRIGGER session_chairs_overlap_bi BEFORE INSERT ON session_chairs
FOR EACH ROW
BEGIN
  DECLARE v_start DATETIME(3);
  DECLARE v_end   DATETIME(3);
  SELECT starts_at, ends_at INTO v_start, v_end FROM conference_sessions WHERE id = NEW.session_id;

  IF EXISTS (SELECT 1 FROM session_chairs c JOIN conference_sessions s ON s.id = c.session_id
             WHERE c.user_id = NEW.user_id AND s.status <> 'cancelled'
               AND s.starts_at < v_end AND s.ends_at > v_start) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This person already chairs another session at that time.';
  END IF;
  IF EXISTS (SELECT 1 FROM presentations p
             WHERE p.presenter_user_id = NEW.user_id AND p.status <> 'cancelled'
               AND p.session_id <> NEW.session_id
               AND p.starts_at < v_end AND p.ends_at > v_start) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This person is presenting in another session at that time.';
  END IF;
END$$

-- ---------------------------------------------------------------------
-- 5. Overlapping fee windows
-- ---------------------------------------------------------------------
CREATE TRIGGER fees_overlap_bi BEFORE INSERT ON registration_fees
FOR EACH ROW
BEGIN
  IF NEW.is_active AND EXISTS (
       SELECT 1 FROM registration_fees f
       WHERE f.category_id = NEW.category_id AND f.is_active
         AND f.valid_from < NEW.valid_until AND f.valid_until > NEW.valid_from) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This category already has an active price for part of that period.';
  END IF;
END$$

CREATE TRIGGER fees_overlap_bu BEFORE UPDATE ON registration_fees
FOR EACH ROW
BEGIN
  IF NEW.is_active AND EXISTS (
       SELECT 1 FROM registration_fees f
       WHERE f.id <> NEW.id AND f.category_id = NEW.category_id AND f.is_active
         AND f.valid_from < NEW.valid_until AND f.valid_until > NEW.valid_from) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This category already has an active price for part of that period.';
  END IF;
END$$

-- ---------------------------------------------------------------------
-- 6. Submission workflow
-- ---------------------------------------------------------------------
CREATE TRIGGER submissions_transition_bu BEFORE UPDATE ON submissions
FOR EACH ROW
BEGIN
  DECLARE v_msg VARCHAR(200);
  IF NEW.conference_id <> OLD.conference_id OR NEW.created_by <> OLD.created_by THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The conference and creator of a submission cannot change.';
  END IF;

  IF NEW.status <> OLD.status AND CONCAT(OLD.status, '>', NEW.status) NOT IN (
       'draft>submitted', 'draft>withdrawn',
       'submitted>under_review', 'submitted>accepted', 'submitted>rejected',
       'submitted>revision_required', 'submitted>withdrawn',
       'under_review>accepted', 'under_review>rejected', 'under_review>revision_required',
       'under_review>withdrawn',
       'revision_required>submitted', 'revision_required>withdrawn',
       'accepted>full_paper_pending', 'accepted>full_paper_submitted', 'accepted>final_approved',
       'accepted>scheduled', 'accepted>withdrawn',
       'full_paper_pending>full_paper_submitted', 'full_paper_pending>withdrawn',
       'full_paper_submitted>final_approved', 'full_paper_submitted>revision_required',
       'full_paper_submitted>rejected', 'full_paper_submitted>withdrawn',
       'final_approved>scheduled', 'final_approved>withdrawn',
       'scheduled>presented', 'scheduled>final_approved', 'scheduled>accepted', 'scheduled>withdrawn',
       'presented>completed') THEN
    SET v_msg = CONCAT('A submission cannot move from ', OLD.status, ' to ', NEW.status, '.');
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;

  IF NEW.status = 'submitted' AND OLD.status = 'draft' AND NEW.submitted_at IS NULL THEN
    SET NEW.submitted_at = CURRENT_TIMESTAMP(3);
  END IF;
  IF NEW.status = 'submitted' AND OLD.status = 'revision_required' THEN
    SET NEW.current_round = OLD.current_round + 1;
  END IF;
  IF NEW.status = 'withdrawn' AND OLD.status <> 'withdrawn' THEN
    SET NEW.withdrawn_at = CURRENT_TIMESTAMP(3);
  END IF;
END$$

-- ---------------------------------------------------------------------
-- 7. Status history
-- ---------------------------------------------------------------------
CREATE TRIGGER submissions_history_ai AFTER INSERT ON submissions
FOR EACH ROW
BEGIN
  INSERT INTO submission_status_history (submission_id, from_status, to_status, changed_by)
  VALUES (NEW.id, NULL, NEW.status, NEW.created_by);
END$$

CREATE TRIGGER submissions_history_au AFTER UPDATE ON submissions
FOR EACH ROW
BEGIN
  IF NEW.status <> OLD.status THEN
    INSERT INTO submission_status_history (submission_id, from_status, to_status, changed_by, reason)
    VALUES (NEW.id, OLD.status, NEW.status, @app_user_id, @app_reason);
  END IF;
END$$

-- ---------------------------------------------------------------------
-- 8. Locks
-- ---------------------------------------------------------------------
CREATE TRIGGER reviews_lock_bu BEFORE UPDATE ON reviews
FOR EACH ROW
BEGIN
  IF OLD.status = 'submitted' AND IFNULL(@app_allow_review_reopen, 0) <> 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Submitted reviews are locked. Ask the convenor to reopen it.';
  END IF;
  IF NEW.status = 'submitted' AND OLD.status = 'draft' THEN
    SET NEW.submitted_at = CURRENT_TIMESTAMP(3);
  END IF;
END$$

CREATE TRIGGER decisions_lock_bu BEFORE UPDATE ON submission_decisions
FOR EACH ROW
BEGIN
  IF NEW.submission_id <> OLD.submission_id OR NEW.stage <> OLD.stage
     OR NEW.round <> OLD.round OR NEW.decision <> OLD.decision THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A recorded decision cannot be changed. Record a new round instead.';
  END IF;
END$$

-- ---------------------------------------------------------------------
-- 9. Append-only audit log
-- ---------------------------------------------------------------------
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The audit log cannot be changed.';
END$$

CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The audit log cannot be changed.';
END$$

DELIMITER ;

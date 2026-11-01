-- =====================================================================
-- STEP 3 - CHECK: run after 1-LOCAL / 2-AIVEN. Every row should say OK.
-- To check the test database, change the next line to: USE conference_cms_test;
-- =====================================================================
USE conference_cms;

SELECT 'agenda_items (My agenda)' AS checked,
       IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agenda_items'), 'OK', 'MISSING') AS status
UNION ALL SELECT 'agenda_feed_tokens (calendar feed)',
       IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agenda_feed_tokens'), 'OK', 'MISSING')
UNION ALL SELECT 'conference_settings.timer_talk_minutes (session timer)',
       IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conference_settings' AND COLUMN_NAME = 'timer_talk_minutes'), 'OK', 'MISSING')
UNION ALL SELECT 'abstract_books (book of abstracts)',
       IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'abstract_books'), 'OK', 'MISSING')
UNION ALL SELECT 'feedback_surveys (feedback survey)',
       IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'feedback_surveys'), 'OK', 'MISSING')
UNION ALL SELECT 'feedback_invitation email template',
       IF(EXISTS(SELECT 1 FROM email_templates WHERE conference_id IS NULL AND template_key = 'feedback_invitation'), 'OK', 'MISSING')
UNION ALL SELECT 'auth_sessions.conference_id (per-conference sign-in)',
       IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_sessions' AND COLUMN_NAME = 'conference_id'), 'OK', 'MISSING');

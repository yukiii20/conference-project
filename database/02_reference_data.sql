-- =====================================================================
-- Conference Management System - reference data (MySQL)
-- File: database/02_reference_data.sql  (run after 01_schema.sql)
-- Roles and permissions are DATA: changing what a role can do is an
-- insert/delete in role_permissions, not a code change.
-- =====================================================================
USE conference_cms;

INSERT IGNORE INTO roles (code, name, scope, description) VALUES
  ('admin',         'System Administrator', 'platform',   'Full platform control; creates conferences and appoints convenors'),
  ('organizer',     'Conference Organizer', 'platform',   'May create conferences'),
  ('convenor',      'Conference Convenor',  'conference', 'Runs one conference; approves every other role; one active per conference'),
  ('manager',       'Conference Manager',   'conference', 'Day-to-day operations'),
  ('staff',         'Conference Staff',     'conference', 'Registration desk and attendance'),
  ('reviewer',      'Reviewer',             'conference', 'Reviews papers assigned to them'),
  ('session_chair', 'Session Chair',        'conference', 'Chairs assigned sessions'),
  ('speaker',       'Invited Speaker',      'conference', 'Keynote or invited speaker'),
  ('author',        'Author',               'conference', 'Submits papers (approved by the convenor)'),
  ('attendee',      'Attendee',             'derived',    'Derived from registrations');

INSERT IGNORE INTO permissions (code, module, description) VALUES
  ('conference.manage',        'conference',    'Edit conference details, settings, tracks, supporters'),
  ('conference.view_internal', 'conference',    'See draft and internal conference data'),
  ('members.manage',           'conference',    'Approve role requests, add or remove members'),
  ('committee.manage',         'conference',    'Manage committees'),
  ('deadline.manage',          'conference',    'Manage key dates and extensions'),
  ('submission.read_all',      'submissions',   'Read every submission in the conference'),
  ('submission.manage',        'submissions',   'Edit any submission and change its status'),
  ('review.assign',            'review',        'Assign and cancel reviewers'),
  ('review.read_all',          'review',        'Read all reviews including confidential comments'),
  ('decision.make',            'review',        'Record accept / reject / revision decisions'),
  ('schedule.manage',          'program',       'Manage rooms, sessions, chairs, presentations'),
  ('registration.read_all',    'registration',  'View all registrations'),
  ('registration.manage',      'registration',  'Edit registrations, categories, fees, waivers'),
  ('payment.read_all',         'payment',       'View all payments'),
  ('payment.manage',           'payment',       'Record manual (cash / bank) payments'),
  ('attendance.record',        'attendance',    'Check people in'),
  ('certificate.manage',       'certificates',  'Issue and revoke certificates'),
  ('announcement.manage',      'communication', 'Publish announcements'),
  ('email.read',               'communication', 'View the email log'),
  ('report.view',              'reports',       'View and export reports'),
  ('audit.read',               'reports',       'View the audit log');

-- Convenor: everything. Manager: everything except approving members and the audit log.
INSERT IGNORE INTO role_permissions (role_code, permission_code)
  SELECT 'convenor', code FROM permissions;
INSERT IGNORE INTO role_permissions (role_code, permission_code)
  SELECT 'manager', code FROM permissions WHERE code NOT IN ('audit.read', 'members.manage');
INSERT IGNORE INTO role_permissions (role_code, permission_code) VALUES
  ('staff', 'conference.view_internal'),
  ('staff', 'registration.read_all'),
  ('staff', 'attendance.record');
-- reviewer, session_chair, speaker, author get no conference-wide permissions;
-- their access is limited to their own assignments, sessions and papers.

INSERT IGNORE INTO deadline_types (code, name, is_window, sort_order) VALUES
  ('registration',            'Participant registration',   TRUE,  10),
  ('abstract_submission',     'Abstract submission',        TRUE,  20),
  ('review',                  'Review period',              TRUE,  30),
  ('acceptance_notification', 'Acceptance notification',    FALSE, 40),
  ('full_paper',              'Full paper submission',      TRUE,  50),
  ('final_paper',             'Final (camera-ready) paper', TRUE,  60),
  ('certificate_release',     'Certificate release',        FALSE, 90);

-- Platform default email templates; {{placeholders}} are filled by the backend.
INSERT IGNORE INTO email_templates (conference_id, template_key, subject, body_html) VALUES
  (NULL, 'account_created',            'Welcome to {{platform_name}}',
         '<p>Hello {{full_name}},</p><p>Your account has been created.</p>'),
  (NULL, 'invitation',                 'You are invited to {{conference_name}} as {{role_name}}',
         '<p>Hello,</p><p>You have been invited to join {{conference_name}} as {{role_name}}.</p><p><a href="{{accept_url}}">Accept invitation</a></p>'),
  (NULL, 'submission_received',        '[{{conference_code}}] Submission {{submission_code}} received',
         '<p>Dear {{full_name}},</p><p>We received your submission "{{title}}" ({{submission_code}}).</p>'),
  (NULL, 'review_assigned',            '[{{conference_code}}] New review assignment {{submission_code}}',
         '<p>Dear {{full_name}},</p><p>You have been assigned a paper to review. Due: {{due_at}}.</p>'),
  (NULL, 'decision_accepted',          '[{{conference_code}}] Your paper {{submission_code}} has been accepted',
         '<p>Dear {{full_name}},</p><p>Congratulations! "{{title}}" has been accepted.</p>'),
  (NULL, 'decision_rejected',          '[{{conference_code}}] Decision on {{submission_code}}',
         '<p>Dear {{full_name}},</p><p>We regret that "{{title}}" was not accepted.</p>'),
  (NULL, 'decision_revision_required', '[{{conference_code}}] Revision requested for {{submission_code}}',
         '<p>Dear {{full_name}},</p><p>Reviewers have requested revisions to "{{title}}".</p>'),
  (NULL, 'full_paper_reminder',        '[{{conference_code}}] Full paper due {{deadline}}',
         '<p>Dear {{full_name}},</p><p>Please upload your full paper before {{deadline}}.</p>'),
  (NULL, 'deadline_reminder',          '[{{conference_code}}] Reminder: {{deadline_name}} closes {{deadline}}',
         '<p>Dear {{full_name}},</p><p>{{deadline_name}} closes on {{deadline}}.</p>'),
  (NULL, 'presentation_scheduled',     '[{{conference_code}}] Your presentation schedule',
         '<p>Dear {{full_name}},</p><p>"{{title}}" is scheduled on {{starts_at}} in {{room_name}}.</p>'),
  (NULL, 'schedule_changed',           '[{{conference_code}}] Schedule change for your presentation',
         '<p>Dear {{full_name}},</p><p>Your presentation "{{title}}" has moved to {{starts_at}} in {{room_name}}.</p>'),
  (NULL, 'announcement',               '[{{conference_code}}] {{title}}',
         '<p>{{body}}</p>'),
  (NULL, 'registration_received',      '[{{conference_code}}] Registration {{registration_number}} received',
         '<p>Dear {{full_name}},</p><p>Your registration is pending payment of {{amount}} {{currency}}.</p>'),
  (NULL, 'registration_confirmed',     '[{{conference_code}}] Registration {{registration_number}} confirmed',
         '<p>Dear {{full_name}},</p><p>Your registration is confirmed. Show your QR code at the desk.</p>'),
  (NULL, 'payment_received',           '[{{conference_code}}] Payment received',
         '<p>Dear {{full_name}},</p><p>We received your payment of {{amount}} {{currency}}.</p>'),
  (NULL, 'attendance_confirmed',       '[{{conference_code}}] Welcome — you are checked in',
         '<p>Dear {{full_name}},</p><p>Your attendance has been recorded.</p>'),
  (NULL, 'certificate_available',      '[{{conference_code}}] Your certificate is ready',
         '<p>Dear {{full_name}},</p><p>Your {{certificate_type}} certificate ({{certificate_number}}) is available.</p>'),
  (NULL, 'role_request_approved', '[{{conference_code}}] Your {{role_name}} request was approved',
         '<p>Dear {{full_name}},</p><p>Your request to join {{conference_name}} as {{role_name}} was approved. You can now sign in.</p>'),
  (NULL, 'role_request_rejected', '[{{conference_code}}] Your {{role_name}} request',
         '<p>Dear {{full_name}},</p><p>Your request to join {{conference_name}} as {{role_name}} was not approved.</p><p>Reason: {{reason}}</p>'),
  (NULL, 'password_reset', 'Reset your password',
         '<p>Dear {{full_name}},</p><p><a href="{{reset_url}}">Set a new password</a>. This link expires in 1 hour.</p>'),
  (NULL, 'convenor_invitation', 'You have been appointed convenor of {{conference_name}}',
         '<p>Dear {{full_name}},</p><p>You have been appointed convenor of {{conference_name}}.</p><p><a href="{{invite_url}}">Set your password</a>. This link expires in 7 days.</p>');

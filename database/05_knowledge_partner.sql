-- Add the Knowledge partner supporter category.
-- Safe to re-run; existing supporter categories and rows are preserved.
ALTER TABLE conference_supporters
  MODIFY COLUMN tier ENUM(
    'organizer',
    'co_organizer',
    'sponsor',
    'partner',
    'knowledge_partner',
    'media'
  ) NOT NULL DEFAULT 'sponsor';

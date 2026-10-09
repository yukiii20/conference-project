-- Part A3: free-text content for the conference submission-portal page.
-- Idempotent: safe to run more than once. Run in the Supabase SQL Editor.
--
-- No RLS changes: these ride along on the same existing policies as every
-- other conferences column (convenors update their own conference via
-- private.has_conf_permission(conference_id, 'conference.manage'); everyone
-- can read non-draft conferences).

alter table public.conferences
  add column if not exists welcome_text text,
  add column if not exists submission_guidelines text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'conferences_welcome_text_length_check') then
    alter table public.conferences add constraint conferences_welcome_text_length_check
      check (welcome_text is null or char_length(welcome_text) <= 3000);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'conferences_submission_guidelines_length_check') then
    alter table public.conferences add constraint conferences_submission_guidelines_length_check
      check (submission_guidelines is null or char_length(submission_guidelines) <= 10000);
  end if;
end $$;

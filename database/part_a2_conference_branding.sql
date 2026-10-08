-- Part A2: per-conference branding for the multi-conference public site.
-- Idempotent: safe to run more than once. Run in the Supabase SQL Editor.
--
-- No RLS changes needed: convenors can already update their own conference
-- (private.has_conf_permission(conference_id, 'conference.manage')) and
-- everyone can already read non-draft conferences — these three columns
-- ride along on those same existing policies.

alter table public.conferences
  add column if not exists primary_color text,
  add column if not exists banner_path text,
  add column if not exists tagline text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'conferences_primary_color_hex_check') then
    alter table public.conferences add constraint conferences_primary_color_hex_check
      check (primary_color is null or primary_color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'conferences_tagline_length_check') then
    alter table public.conferences add constraint conferences_tagline_length_check
      check (tagline is null or char_length(tagline) <= 200);
  end if;
end $$;

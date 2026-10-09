-- Part A: conference website content (convenor edits, public sees).
-- Idempotent: safe to run more than once. Run in the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- (1) conferences.location_map_url — Google Maps embed URL
-- ---------------------------------------------------------------------------
alter table public.conferences add column if not exists location_map_url text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'conferences_location_map_url_https_check') then
    alter table public.conferences add constraint conferences_location_map_url_https_check
      check (location_map_url is null or location_map_url ~* '^https://');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- (2) shared updated_at trigger helper (safe to redefine if it already exists
-- elsewhere with the same behaviour)
-- ---------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- (3) conference_supporters
-- ---------------------------------------------------------------------------
create table if not exists public.conference_supporters (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 200),
  tier text not null default 'sponsor'
    check (tier in ('organizer', 'co_organizer', 'sponsor', 'partner', 'media')),
  logo_path text,
  website_url text check (website_url is null or website_url ~* '^https://'),
  display_order smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conference_supporters_conference_id_idx
  on public.conference_supporters (conference_id);

drop trigger if exists conference_supporters_set_updated_at on public.conference_supporters;
create trigger conference_supporters_set_updated_at
  before update on public.conference_supporters
  for each row
  execute function private.set_updated_at();

alter table public.conference_supporters enable row level security;

-- Public (anon + authenticated) can see active supporters of a non-draft
-- conference. Convenors see their own conference's rows through the manage
-- policy below regardless of is_active, so the convenor portal can also
-- list inactive/hidden supporters for editing.
drop policy if exists conference_supporters_select_public on public.conference_supporters;
create policy conference_supporters_select_public
  on public.conference_supporters for select
  using (is_active and private.is_conference_public(conference_id));

drop policy if exists conference_supporters_manage on public.conference_supporters;
create policy conference_supporters_manage
  on public.conference_supporters for all
  using (private.has_conf_permission(conference_id, 'conference.manage'))
  with check (private.has_conf_permission(conference_id, 'conference.manage'));

grant select on public.conference_supporters to anon, authenticated;
grant insert, update, delete on public.conference_supporters to authenticated;

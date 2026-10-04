-- Role requests: non-author roles are requested at signup and approved by
-- a conference manager/convenor before they take effect. Authors need no
-- approval and are unaffected by this migration.

-- (a) table ----------------------------------------------------------------
create table public.role_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  conference_id uuid not null references public.conferences(id) on delete cascade,
  role_code text not null check (role_code in ('reviewer','session_chair','staff','manager','convenor')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  note text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only one *pending* request per person/conference/role at a time. A prior
-- rejected or cancelled request does not block a new attempt.
create unique index role_requests_one_pending_per_user_conf_role
  on public.role_requests (user_id, conference_id, role_code)
  where status = 'pending';

-- (b) RLS --------------------------------------------------------------------
alter table public.role_requests enable row level security;

create policy role_requests_select_own
  on public.role_requests for select
  using (user_id = auth.uid());

create policy role_requests_select_reviewer
  on public.role_requests for select
  using (private.has_conf_permission(conference_id, 'members.manage'));

-- A user may cancel their own pending request. No insert policy is defined
-- anywhere on this table, so RLS's default-deny blocks client-side inserts
-- entirely; rows are only ever created by the trigger below.
create policy role_requests_cancel_own
  on public.role_requests for update
  using (user_id = auth.uid() and status = 'pending')
  with check (status = 'cancelled' and user_id = auth.uid());

-- (c) signup side-effects trigger ---------------------------------------------
-- Fires when email_confirmed_at transitions from null to set. Separate from
-- the existing on_auth_user_created trigger, which this does not modify.
create or replace function private.handle_signup_extras()
returns trigger
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_phone text;
  v_role text;
  v_conference_id uuid;
  v_conference_ok boolean;
begin
  if new.email_confirmed_at is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.email_confirmed_at is not null then
    return new; -- already processed on a previous update
  end if;

  -- Copy the phone number out of signup metadata. Defense in depth: the
  -- app already validates this shape before signup, so this should always
  -- match, but we re-check before writing to profiles.
  v_phone := new.raw_user_meta_data->>'phone';
  if v_phone is not null and v_phone ~ '^\+[1-9]\d{7,14}$' then
    update public.profiles
      set phone = v_phone, updated_at = now()
      where id = new.id;
  end if;

  -- If a non-author role + conference were requested at signup, and the
  -- conference is still valid (non-draft, not deleted), create one pending
  -- role_requests row. conference_members is never touched here.
  v_role := new.raw_user_meta_data->>'requested_role';
  if v_role in ('reviewer','session_chair','staff','manager','convenor') then
    begin
      v_conference_id := (new.raw_user_meta_data->>'requested_conference_id')::uuid;
    exception when others then
      v_conference_id := null;
    end;

    if v_conference_id is not null then
      select exists (
        select 1 from public.conferences c
        where c.id = v_conference_id
          and c.status <> 'draft'
          and c.deleted_at is null
      ) into v_conference_ok;

      if v_conference_ok then
        insert into public.role_requests (user_id, conference_id, role_code)
        values (new.id, v_conference_id, v_role)
        on conflict (user_id, conference_id, role_code) where status = 'pending'
        do nothing;
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_signup_extras
  after insert or update of email_confirmed_at on auth.users
  for each row
  execute function private.handle_signup_extras();

-- (d) phone format constraint --------------------------------------------------
-- If this fails, an existing profiles.phone value doesn't match E.164 —
-- tell me and I'll switch this to `not valid` instead of retroactive.
alter table public.profiles
  add constraint profiles_phone_e164_check
  check (phone is null or phone ~ '^\+[1-9]\d{7,14}$');

-- (e) approval RPC ----------------------------------------------------------
-- Callable by any authenticated user, but the real authorization check is
-- inside: it raises unless the caller has members.manage on this specific
-- request's conference.
create or replace function public.review_role_request(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
)
returns public.role_requests
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_request public.role_requests;
  v_result public.role_requests;
begin
  select * into v_request from public.role_requests where id = p_request_id;

  if v_request is null then
    raise exception 'Role request not found';
  end if;

  if not private.has_conf_permission(v_request.conference_id, 'members.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request has already been reviewed';
  end if;

  update public.role_requests
    set status = case when p_approve then 'approved' else 'rejected' end,
        note = p_note,
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        updated_at = now()
    where id = p_request_id
    returning * into v_result;

  if p_approve then
    -- Update-then-insert instead of an upsert: the exact unique constraint
    -- on conference_members isn't known to this migration. Any existing
    -- trigger on conference_members (e.g. restricting who can become
    -- convenor) still fires normally here.
    update public.conference_members
      set status = 'active'
      where conference_id = v_request.conference_id
        and user_id = v_request.user_id
        and role_code = v_request.role_code;

    if not found then
      insert into public.conference_members (conference_id, user_id, role_code, status)
      values (v_request.conference_id, v_request.user_id, v_request.role_code, 'active');
    end if;
  end if;

  return v_result;
end;
$$;

revoke all on function public.review_role_request(uuid, boolean, text) from public;
grant execute on function public.review_role_request(uuid, boolean, text) to authenticated;

-- (f) caller's own requests --------------------------------------------------
create or replace function public.get_my_role_requests()
returns table (
  id uuid,
  conference_id uuid,
  conference_code text,
  conference_name text,
  role_code text,
  status text,
  note text,
  created_at timestamptz,
  reviewed_at timestamptz
)
language sql
security definer
set search_path = public, extensions
stable
as $$
  select
    rr.id, rr.conference_id, c.code, c.name,
    rr.role_code, rr.status, rr.note, rr.created_at, rr.reviewed_at
  from public.role_requests rr
  join public.conferences c on c.id = rr.conference_id
  where rr.user_id = auth.uid();
$$;

revoke all on function public.get_my_role_requests() from public;
grant execute on function public.get_my_role_requests() to authenticated;

-- (g) reviewer-facing pending list -------------------------------------------
-- Addition beyond the original request: profiles RLS only allows reading
-- one's own row, so a manager querying role_requests with a nested
-- profiles(...) embed would see nulls for the requester's name/email/phone
-- (PostgREST embeds still enforce the embedded table's own RLS). Rather
-- than widen profiles RLS for everyone, this narrow security definer RPC
-- returns exactly the columns the review UI needs, pre-filtered to
-- conferences the caller can manage.
create or replace function public.get_reviewable_role_requests()
returns table (
  id uuid,
  conference_id uuid,
  conference_code text,
  conference_name text,
  role_code text,
  status text,
  requester_name text,
  requester_email text,
  requester_phone text,
  created_at timestamptz
)
language sql
security definer
set search_path = public, extensions
stable
as $$
  select
    rr.id, rr.conference_id, c.code, c.name,
    rr.role_code, rr.status, p.full_name, p.email, p.phone, rr.created_at
  from public.role_requests rr
  join public.conferences c on c.id = rr.conference_id
  join public.profiles p on p.id = rr.user_id
  where rr.status = 'pending'
    and private.has_conf_permission(rr.conference_id, 'members.manage');
$$;

revoke all on function public.get_reviewable_role_requests() from public;
grant execute on function public.get_reviewable_role_requests() to authenticated;

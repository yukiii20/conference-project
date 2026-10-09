-- Simplified convenor-approval system. Replaces everything from the
-- previous role_requests design (incompatible shapes), while leaving
-- profiles, conferences, conference_members, and on_auth_user_created
-- untouched. Every signup (including author) is pending until a convenor
-- or platform admin approves it.

-- ---------------------------------------------------------------------------
-- Drop the previous design
-- ---------------------------------------------------------------------------
drop function if exists public.remove_member(uuid);
drop function if exists public.get_conference_team(uuid);
drop function if exists public.cancel_my_role_request(uuid);
drop function if exists public.request_role(uuid, text, text);
drop function if exists public.get_role_requests_for_review(uuid, text);
drop function if exists public.review_role_request(uuid, boolean, text);
drop function if exists public.get_my_role_requests();
drop function if exists public.get_reviewable_role_requests();
drop trigger if exists on_auth_user_signup_extras on auth.users;
drop function if exists private.handle_signup_extras();

-- Must come before dropping can_review_requests(): the old
-- role_requests_select_reviewer policy on this table depends on it.
drop table if exists public.role_requests;

drop function if exists private.can_review_requests(uuid);

-- ---------------------------------------------------------------------------
-- (1) role_requests table + RLS
-- ---------------------------------------------------------------------------
create table public.role_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  conference_id uuid not null references public.conferences(id) on delete cascade,
  role_code text not null check (role_code in ('author', 'reviewer', 'session_chair', 'staff', 'manager')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, conference_id, role_code)
);

alter table public.role_requests enable row level security;

create policy role_requests_select
  on public.role_requests for select
  using (
    user_id = auth.uid()
    or private.is_platform_admin()
    or private.has_conf_role(conference_id, array['convenor'])
  );

-- No insert/update/delete policy: RLS default-deny blocks direct client
-- writes entirely. Rows are only ever created by the trigger below and
-- modified by review_role_request() below.

-- ---------------------------------------------------------------------------
-- (2) signup trigger
-- ---------------------------------------------------------------------------
create or replace function private.handle_signup_request()
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
  v_phone := new.raw_user_meta_data->>'phone';
  if v_phone is not null and v_phone ~ '^\+[1-9]\d{7,14}$' then
    update public.profiles set phone = v_phone where id = new.id;
  end if;

  v_role := new.raw_user_meta_data->>'requested_role';
  if v_role in ('author', 'reviewer', 'session_chair', 'staff', 'manager') then
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
        on conflict (user_id, conference_id, role_code) do nothing;
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- Fires after the existing on_auth_user_created (alphabetically
-- "created" < "signup_request", so the profile row already exists).
create trigger on_auth_user_signup_request
  after insert on auth.users
  for each row
  execute function private.handle_signup_request();

-- ---------------------------------------------------------------------------
-- (3) get_my_role_requests
-- ---------------------------------------------------------------------------
create function public.get_my_role_requests()
returns table (
  id uuid,
  conference_id uuid,
  conference_code text,
  conference_name text,
  role_code text,
  status text,
  reject_reason text,
  created_at timestamptz
)
language sql
security definer
set search_path = public, extensions
stable
as $$
  select rr.id, rr.conference_id, c.code, c.name, rr.role_code, rr.status, rr.reject_reason, rr.created_at
  from public.role_requests rr
  join public.conferences c on c.id = rr.conference_id
  where rr.user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- (4) get_role_requests — convenor/admin only
-- ---------------------------------------------------------------------------
create function public.get_role_requests(p_conference_id uuid)
returns table (
  id uuid,
  role_code text,
  status text,
  reject_reason text,
  applicant_id uuid,
  applicant_name text,
  applicant_email text,
  applicant_phone text,
  created_at timestamptz,
  reviewed_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
stable
as $$
begin
  if not (
    private.is_platform_admin()
    or private.has_conf_role(p_conference_id, array['convenor'])
  ) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  return query
  select
    rr.id, rr.role_code, rr.status, rr.reject_reason,
    p.id, p.full_name, p.email, p.phone, rr.created_at, rr.reviewed_at
  from public.role_requests rr
  join public.profiles p on p.id = rr.user_id
  where rr.conference_id = p_conference_id
  order by rr.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- (5) review_role_request — convenor/admin only
-- ---------------------------------------------------------------------------
create function public.review_role_request(
  p_request_id uuid,
  p_approve boolean,
  p_reason text default null
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
    raise exception 'Role request not found.';
  end if;

  if not (
    private.is_platform_admin()
    or private.has_conf_role(v_request.conference_id, array['convenor'])
  ) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request has already been reviewed.';
  end if;

  update public.role_requests
    set status = case when p_approve then 'approved' else 'rejected' end,
        reject_reason = case when p_approve then null else p_reason end,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = p_request_id
    returning * into v_result;

  if p_approve and v_request.role_code <> 'author' then
    -- Update-then-insert rather than ON CONFLICT: the exact unique
    -- constraint on conference_members isn't known to this migration.
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

-- ---------------------------------------------------------------------------
-- Grants — authenticated only
-- ---------------------------------------------------------------------------
revoke all on function public.get_my_role_requests() from public, anon;
grant execute on function public.get_my_role_requests() to authenticated;

revoke all on function public.get_role_requests(uuid) from public, anon;
grant execute on function public.get_role_requests(uuid) to authenticated;

revoke all on function public.review_role_request(uuid, boolean, text) from public, anon;
grant execute on function public.review_role_request(uuid, boolean, text) to authenticated;

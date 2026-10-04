-- Convenor-only approval for role sign-ups. Builds on
-- 20261003000009_role_requests.sql (table/functions already live). See the
-- chat explanation for the three additions beyond the original spec:
-- public.notifications, conference_members.added_by, and
-- public.get_conference_team(). All statements are idempotent.

-- Superseded by get_role_requests_for_review() below: the old version let
-- managers (members.manage) read applicant PII, which contradicts
-- "managers can NOT approve" in the new design.
drop function if exists public.get_reviewable_role_requests();

-- ---------------------------------------------------------------------------
-- (1) role_requests: four requestable roles, decision_reason, length limits
-- ---------------------------------------------------------------------------
alter table public.role_requests drop constraint if exists role_requests_role_code_check;
alter table public.role_requests add constraint role_requests_role_code_check
  check (role_code in ('reviewer', 'session_chair', 'staff', 'manager'));

alter table public.role_requests add column if not exists decision_reason text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'role_requests_note_length_check') then
    alter table public.role_requests add constraint role_requests_note_length_check
      check (note is null or char_length(note) <= 500);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'role_requests_decision_reason_length_check') then
    alter table public.role_requests add constraint role_requests_decision_reason_length_check
      check (decision_reason is null or char_length(decision_reason) <= 500);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- (2) notifications table — addition, see chat explanation
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'system',
  title text not null,
  body text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
  on public.notifications for select
  using (user_id = auth.uid());

-- Client marks a notification read by updating read_at. No insert policy:
-- rows are only ever created by review_role_request() below.
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own
  on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- (3) conference_members.added_by — addition, see chat explanation
-- ---------------------------------------------------------------------------
alter table public.conference_members add column if not exists added_by uuid references public.profiles(id);

-- ---------------------------------------------------------------------------
-- (4) profiles.phone constraint — add only if missing
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_phone_e164_check') then
    alter table public.profiles add constraint profiles_phone_e164_check
      check (phone is null or phone ~ '^\+[1-9]\d{7,14}$');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- (5) private.can_review_requests — platform admin OR active convenor only
-- ---------------------------------------------------------------------------
create or replace function private.can_review_requests(p_conference_id uuid)
returns boolean
language sql
security definer
set search_path = public, extensions
stable
as $$
  select private.is_platform_admin()
    or private.has_conf_role(p_conference_id, array['convenor']);
$$;

-- ---------------------------------------------------------------------------
-- (6) role_requests RLS: reviewer-select now convenor/admin only; no direct
-- client-side update (cancellation goes through the RPC below)
-- ---------------------------------------------------------------------------
drop policy if exists role_requests_select_reviewer on public.role_requests;
create policy role_requests_select_reviewer
  on public.role_requests for select
  using (private.can_review_requests(conference_id));

drop policy if exists role_requests_cancel_own on public.role_requests;

-- ---------------------------------------------------------------------------
-- (7) signup trigger: four roles only, captures optional note
-- ---------------------------------------------------------------------------
create or replace function private.handle_signup_extras()
returns trigger
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_phone text;
  v_role text;
  v_note text;
  v_conference_id uuid;
  v_conference_ok boolean;
begin
  if new.email_confirmed_at is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.email_confirmed_at is not null then
    return new; -- already processed on a previous update
  end if;

  v_phone := new.raw_user_meta_data->>'phone';
  if v_phone is not null and v_phone ~ '^\+[1-9]\d{7,14}$' then
    update public.profiles
      set phone = v_phone, updated_at = now()
      where id = new.id;
  end if;

  v_role := new.raw_user_meta_data->>'requested_role';
  if v_role in ('reviewer', 'session_chair', 'staff', 'manager') then
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
        v_note := new.raw_user_meta_data->>'note';
        if v_note is not null and char_length(v_note) > 500 then
          v_note := left(v_note, 500);
        end if;

        insert into public.role_requests (user_id, conference_id, role_code, note)
        values (new.id, v_conference_id, v_role, v_note)
        on conflict (user_id, conference_id, role_code) where status = 'pending'
        do nothing;
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- (8) request_role — ask for a role later, outside signup
-- ---------------------------------------------------------------------------
create or replace function public.request_role(
  p_conference_id uuid,
  p_role text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_conference_ok boolean;
  v_already_holds boolean;
  v_already_pending boolean;
  v_id uuid;
begin
  if p_role not in ('reviewer', 'session_chair', 'staff', 'manager') then
    raise exception 'Not a requestable role.';
  end if;

  if p_note is not null and char_length(p_note) > 500 then
    raise exception 'Message is too long (500 characters max).';
  end if;

  select exists (
    select 1 from public.conferences c
    where c.id = p_conference_id and c.status <> 'draft' and c.deleted_at is null
  ) into v_conference_ok;

  if not v_conference_ok then
    raise exception 'This conference is not open for role requests.';
  end if;

  select exists (
    select 1 from public.conference_members m
    where m.conference_id = p_conference_id
      and m.user_id = auth.uid()
      and m.role_code = p_role
      and m.status = 'active'
  ) into v_already_holds;

  if v_already_holds then
    raise exception 'You already hold this role for this conference.';
  end if;

  select exists (
    select 1 from public.role_requests r
    where r.conference_id = p_conference_id
      and r.user_id = auth.uid()
      and r.role_code = p_role
      and r.status = 'pending'
  ) into v_already_pending;

  if v_already_pending then
    raise exception 'You already have a pending request for this role.';
  end if;

  insert into public.role_requests (user_id, conference_id, role_code, note)
  values (auth.uid(), p_conference_id, p_role, p_note)
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- (9) review_role_request — convenor/admin only, notifies the applicant
-- ---------------------------------------------------------------------------
-- Postgres won't let CREATE OR REPLACE rename a parameter (p_note ->
-- p_reason) on the existing function from migration 0009, so drop it first.
drop function if exists public.review_role_request(uuid, boolean, text);

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
  v_title text;
begin
  select * into v_request from public.role_requests where id = p_request_id;

  if v_request is null then
    raise exception 'Role request not found.';
  end if;

  if not private.can_review_requests(v_request.conference_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request has already been reviewed.';
  end if;

  if not p_approve then
    if p_reason is null or char_length(trim(p_reason)) < 5 then
      raise exception 'A reason (5-500 characters) is required when rejecting.';
    end if;
    if char_length(p_reason) > 500 then
      raise exception 'Reason is too long (500 characters max).';
    end if;
  end if;

  update public.role_requests
    set status = case when p_approve then 'approved' else 'rejected' end,
        decision_reason = p_reason,
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        updated_at = now()
    where id = p_request_id
    returning * into v_result;

  if p_approve then
    update public.conference_members
      set status = 'active'
      where conference_id = v_request.conference_id
        and user_id = v_request.user_id
        and role_code = v_request.role_code;

    if not found then
      insert into public.conference_members (conference_id, user_id, role_code, status, added_by)
      values (v_request.conference_id, v_request.user_id, v_request.role_code, 'active', auth.uid());
    end if;
  end if;

  v_title := case
    when p_approve then 'Your ' || replace(v_request.role_code, '_', ' ') || ' request was approved'
    else 'Your ' || replace(v_request.role_code, '_', ' ') || ' request was not approved'
  end;

  insert into public.notifications (user_id, type, title, body)
  values (v_request.user_id, 'system', v_title, case when p_approve then null else p_reason end);

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- (10) cancel_my_role_request — own pending requests only
-- ---------------------------------------------------------------------------
create or replace function public.cancel_my_role_request(p_request_id uuid)
returns public.role_requests
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_result public.role_requests;
begin
  update public.role_requests
    set status = 'cancelled', updated_at = now()
    where id = p_request_id
      and user_id = auth.uid()
      and status = 'pending'
    returning * into v_result;

  if v_result is null then
    raise exception 'Request not found or not cancellable.';
  end if;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- (11) get_my_role_requests — dropped and recreated: output columns changed
-- ---------------------------------------------------------------------------
drop function if exists public.get_my_role_requests();

create function public.get_my_role_requests()
returns table (
  id uuid,
  conference_id uuid,
  conference_code text,
  conference_name text,
  role_code text,
  status text,
  note text,
  decision_reason text,
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
    rr.role_code, rr.status, rr.note, rr.decision_reason, rr.created_at, rr.reviewed_at
  from public.role_requests rr
  join public.conferences c on c.id = rr.conference_id
  where rr.user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- (12) get_role_requests_for_review — convenor/admin only, with applicant info
-- ---------------------------------------------------------------------------
create or replace function public.get_role_requests_for_review(
  p_conference_id uuid,
  p_status text default 'pending'
)
returns table (
  id uuid,
  conference_id uuid,
  role_code text,
  status text,
  note text,
  decision_reason text,
  applicant_id uuid,
  applicant_name text,
  applicant_email text,
  applicant_phone text,
  applicant_institution text,
  created_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
stable
as $$
begin
  if not private.can_review_requests(p_conference_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  return query
  select
    rr.id, rr.conference_id, rr.role_code, rr.status, rr.note, rr.decision_reason,
    p.id, p.full_name, p.email, p.phone, p.institution,
    rr.created_at, rr.reviewed_by, rr.reviewed_at
  from public.role_requests rr
  join public.profiles p on p.id = rr.user_id
  where rr.conference_id = p_conference_id
    and (p_status is null or rr.status = p_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- (13) remove_member — convenor/admin only, convenor row protected
-- ---------------------------------------------------------------------------
create or replace function public.remove_member(p_member_id uuid)
returns public.conference_members
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_member public.conference_members;
  v_result public.conference_members;
begin
  select * into v_member from public.conference_members where id = p_member_id;

  if v_member is null then
    raise exception 'Member not found.';
  end if;

  if not private.can_review_requests(v_member.conference_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if v_member.role_code = 'convenor' then
    raise exception 'The convenor cannot be removed here.';
  end if;

  update public.conference_members
    set status = 'removed'
    where id = p_member_id
    returning * into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- (14) get_conference_team — addition, see chat explanation
-- ---------------------------------------------------------------------------
create or replace function public.get_conference_team(p_conference_id uuid)
returns table (
  member_id uuid,
  user_id uuid,
  role_code text,
  status text,
  full_name text,
  email text,
  phone text
)
language plpgsql
security definer
set search_path = public, extensions
stable
as $$
begin
  if not private.can_review_requests(p_conference_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  return query
  select m.id, m.user_id, m.role_code, m.status, p.full_name, p.email, p.phone
  from public.conference_members m
  join public.profiles p on p.id = m.user_id
  where m.conference_id = p_conference_id
    and m.status = 'active';
end;
$$;

-- ---------------------------------------------------------------------------
-- (15) grants — authenticated only
-- ---------------------------------------------------------------------------
revoke all on function public.request_role(uuid, text, text) from public, anon;
grant execute on function public.request_role(uuid, text, text) to authenticated;

revoke all on function public.review_role_request(uuid, boolean, text) from public, anon;
grant execute on function public.review_role_request(uuid, boolean, text) to authenticated;

revoke all on function public.cancel_my_role_request(uuid) from public, anon;
grant execute on function public.cancel_my_role_request(uuid) to authenticated;

revoke all on function public.get_my_role_requests() from public, anon;
grant execute on function public.get_my_role_requests() to authenticated;

revoke all on function public.get_role_requests_for_review(uuid, text) from public, anon;
grant execute on function public.get_role_requests_for_review(uuid, text) to authenticated;

revoke all on function public.remove_member(uuid) from public, anon;
grant execute on function public.remove_member(uuid) to authenticated;

revoke all on function public.get_conference_team(uuid) from public, anon;
grant execute on function public.get_conference_team(uuid) to authenticated;

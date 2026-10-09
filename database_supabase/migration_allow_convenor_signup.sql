-- Allow "convenor" to be requested through the same signup/approval flow
-- as the other five roles, instead of being admin-only. Approval still
-- goes through the existing review_role_request() rule unchanged: a
-- platform admin, or an existing convenor of that same conference, can
-- approve it. (A conference with no convenor yet needs a platform admin to
-- approve its first one.)

alter table public.role_requests drop constraint if exists role_requests_role_code_check;
alter table public.role_requests add constraint role_requests_role_code_check
  check (role_code in ('author', 'reviewer', 'session_chair', 'staff', 'manager', 'convenor'));

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
  if v_role in ('author', 'reviewer', 'session_chair', 'staff', 'manager', 'convenor') then
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

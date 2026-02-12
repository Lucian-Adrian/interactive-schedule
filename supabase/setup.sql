-- Schedule Sync: clean schema + secure RPCs.
-- This migration is idempotent and handles dirty legacy states.

create extension if not exists pgcrypto with schema extensions;

-- 1) Core tables
create table if not exists public.schedule_configs (
  id bigint primary key,
  title text not null default 'Disponibilitate',
  default_language text,
  timezone text,
  show_full_slots boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.schedule_configs add column if not exists title text;
alter table public.schedule_configs add column if not exists default_language text;
alter table public.schedule_configs add column if not exists timezone text;
alter table public.schedule_configs add column if not exists show_full_slots boolean;
alter table public.schedule_configs add column if not exists updated_at timestamptz;

update public.schedule_configs
set
  title = coalesce(nullif(btrim(title), ''), 'Disponibilitate'),
  show_full_slots = coalesce(show_full_slots, true),
  updated_at = coalesce(updated_at, now());

alter table public.schedule_configs alter column title set default 'Disponibilitate';
alter table public.schedule_configs alter column show_full_slots set default true;
alter table public.schedule_configs alter column updated_at set default now();

create table if not exists public.slots (
  id text primary key,
  day_of_week int not null,
  start_time text not null,
  end_time text not null,
  status text not null,
  spots_total int,
  spots_available int,
  label text not null,
  note text,
  visibility boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.slots add column if not exists day_of_week int;
alter table public.slots add column if not exists start_time text;
alter table public.slots add column if not exists end_time text;
alter table public.slots add column if not exists status text;
alter table public.slots add column if not exists spots_total int;
alter table public.slots add column if not exists spots_available int;
alter table public.slots add column if not exists label text;
alter table public.slots add column if not exists note text;
alter table public.slots add column if not exists visibility boolean;
alter table public.slots add column if not exists updated_at timestamptz;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'slots'
      and column_name = 'id'
      and data_type <> 'text'
  ) then
    alter table public.slots alter column id drop default;
    alter table public.slots alter column id type text using id::text;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'slots'
      and column_name = 'start_time'
      and data_type <> 'text'
  ) then
    alter table public.slots alter column start_time type text using start_time::text;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'slots'
      and column_name = 'end_time'
      and data_type <> 'text'
  ) then
    alter table public.slots alter column end_time type text using end_time::text;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'slots'
      and column_name = 'status'
      and data_type <> 'text'
  ) then
    alter table public.slots alter column status type text using status::text;
  end if;
end $$;

update public.slots
set
  day_of_week = coalesce(day_of_week, 1),
  start_time = coalesce(nullif(start_time, ''), '10:00'),
  end_time = coalesce(nullif(end_time, ''), '11:00'),
  status = case
    when status in ('Available', 'FewLeft', 'Full', 'Occupied', 'Hidden') then status
    else 'Available'
  end,
  label = coalesce(nullif(btrim(label), ''), 'Slot'),
  visibility = coalesce(visibility, true),
  updated_at = coalesce(updated_at, now());

alter table public.slots alter column day_of_week set not null;
alter table public.slots alter column start_time set not null;
alter table public.slots alter column end_time set not null;
alter table public.slots alter column status set not null;
alter table public.slots alter column label set not null;
alter table public.slots alter column visibility set not null;
alter table public.slots alter column updated_at set not null;
alter table public.slots alter column visibility set default true;
alter table public.slots alter column updated_at set default now();

alter table public.slots drop constraint if exists slots_status_check;
alter table public.slots
  add constraint slots_status_check
  check (status in ('Available', 'FewLeft', 'Full', 'Occupied', 'Hidden'));

-- 2) Admin password storage
create table if not exists public.admin_settings (
  id int primary key,
  password_hash text not null,
  updated_at timestamptz not null default now()
);

alter table public.admin_settings add column if not exists password_hash text;
alter table public.admin_settings add column if not exists updated_at timestamptz;

update public.admin_settings
set
  updated_at = coalesce(updated_at, now()),
  password_hash = coalesce(password_hash, extensions.crypt(encode(extensions.gen_random_bytes(20), 'hex'), extensions.gen_salt('bf')))
where id = 1;

alter table public.admin_settings alter column updated_at set default now();
alter table public.admin_settings alter column updated_at set not null;
alter table public.admin_settings alter column password_hash set not null;

-- Insert randomized bootstrap password only when missing.
-- Set a real admin password in Supabase SQL Editor after first deploy:
-- update public.admin_settings
-- set password_hash = extensions.crypt('<your-strong-password>', extensions.gen_salt('bf')),
--     updated_at = now()
-- where id = 1;
insert into public.admin_settings (id, password_hash)
select 1, extensions.crypt(encode(extensions.gen_random_bytes(20), 'hex'), extensions.gen_salt('bf'))
where not exists (select 1 from public.admin_settings where id = 1);

-- 3) Slot requests
create table if not exists public.slot_requests (
  id uuid primary key default gen_random_uuid(),
  slot_id text not null,
  student_name text,
  student_contact text not null,
  student_class text,
  student_note text,
  status text not null default 'pending',
  admin_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.slot_requests add column if not exists slot_id text;
alter table public.slot_requests add column if not exists student_name text;
alter table public.slot_requests add column if not exists student_contact text;
alter table public.slot_requests add column if not exists student_class text;
alter table public.slot_requests add column if not exists student_note text;
alter table public.slot_requests add column if not exists status text;
alter table public.slot_requests add column if not exists admin_note text;
alter table public.slot_requests add column if not exists created_at timestamptz;
alter table public.slot_requests add column if not exists reviewed_at timestamptz;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'slot_requests'
      and column_name = 'slot_id'
      and data_type <> 'text'
  ) then
    alter table public.slot_requests alter column slot_id type text using slot_id::text;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'slot_requests'
      and column_name = 'student_contact'
      and data_type <> 'text'
  ) then
    alter table public.slot_requests alter column student_contact type text using student_contact::text;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'slot_requests'
      and column_name = 'status'
      and data_type <> 'text'
  ) then
    alter table public.slot_requests alter column status type text using status::text;
  end if;
end $$;

update public.slot_requests
set
  student_contact = coalesce(nullif(btrim(student_contact), ''), 'unknown'),
  status = case
    when status in ('pending', 'approved', 'rejected') then status
    else 'pending'
  end,
  created_at = coalesce(created_at, now());

alter table public.slot_requests alter column slot_id set not null;
alter table public.slot_requests alter column student_contact set not null;
alter table public.slot_requests alter column status set not null;
alter table public.slot_requests alter column created_at set not null;
alter table public.slot_requests alter column status set default 'pending';
alter table public.slot_requests alter column created_at set default now();

alter table public.slot_requests drop constraint if exists slot_requests_status_check;
alter table public.slot_requests
  add constraint slot_requests_status_check
  check (status in ('pending', 'approved', 'rejected'));

alter table public.slot_requests drop constraint if exists slot_requests_slot_id_fkey;
alter table public.slot_requests
  add constraint slot_requests_slot_id_fkey
  foreign key (slot_id) references public.slots(id) on delete cascade;

create index if not exists slots_day_time_idx on public.slots (day_of_week, start_time);
create index if not exists slot_requests_status_created_idx on public.slot_requests (status, created_at desc);
create index if not exists slot_requests_slot_id_idx on public.slot_requests (slot_id);

-- 4) RLS + least privilege table permissions
alter table public.schedule_configs enable row level security;
alter table public.slots enable row level security;
alter table public.admin_settings enable row level security;
alter table public.slot_requests enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname, schemaname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('schedule_configs', 'slots', 'admin_settings', 'slot_requests')
  loop
    execute format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

create policy "public read schedule_configs"
on public.schedule_configs
for select
to anon, authenticated
using (true);

create policy "public read slots"
on public.slots
for select
to anon, authenticated
using (visibility = true);

grant select on table public.schedule_configs to anon, authenticated;
grant select on table public.slots to anon, authenticated;

revoke insert, update, delete on table public.schedule_configs from anon, authenticated;
revoke insert, update, delete on table public.slots from anon, authenticated;
revoke all on table public.admin_settings from anon, authenticated;
revoke all on table public.slot_requests from anon, authenticated;

-- 5) RPCs (all with password gate for admin actions)
drop function if exists public.verify_admin_password(text);
create function public.verify_admin_password(input_password text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.admin_settings s
    where s.id = 1
      and s.password_hash = extensions.crypt(input_password, s.password_hash)
  );
$$;

drop function if exists public.admin_upsert_slot(text, jsonb);
create function public.admin_upsert_slot(input_password text, payload jsonb)
returns public.slots
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  ok boolean;
  upserted public.slots;
begin
  select public.verify_admin_password(input_password) into ok;
  if not ok then
    raise exception 'invalid_admin_password';
  end if;

  if coalesce(payload->>'id', '') = '' then
    raise exception 'slot_id_required';
  end if;

  insert into public.slots (
    id,
    day_of_week,
    start_time,
    end_time,
    status,
    spots_total,
    spots_available,
    label,
    note,
    visibility,
    updated_at
  )
  values (
    payload->>'id',
    coalesce((payload->>'day_of_week')::int, 1),
    coalesce(payload->>'start_time', '10:00'),
    coalesce(payload->>'end_time', '11:00'),
    case
      when payload->>'status' in ('Available', 'FewLeft', 'Full', 'Occupied', 'Hidden') then payload->>'status'
      else 'Available'
    end,
    nullif(payload->>'spots_total', '')::int,
    nullif(payload->>'spots_available', '')::int,
    coalesce(nullif(payload->>'label', ''), 'Slot'),
    nullif(payload->>'note', ''),
    case
      when payload ? 'visibility' then coalesce((payload->>'visibility')::boolean, true)
      else true
    end,
    now()
  )
  on conflict (id)
  do update set
    day_of_week = excluded.day_of_week,
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    status = excluded.status,
    spots_total = excluded.spots_total,
    spots_available = excluded.spots_available,
    label = excluded.label,
    note = excluded.note,
    visibility = excluded.visibility,
    updated_at = now()
  returning * into upserted;

  return upserted;
end;
$$;

drop function if exists public.admin_delete_slot(text, text);
create function public.admin_delete_slot(input_password text, p_id text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  ok boolean;
begin
  select public.verify_admin_password(input_password) into ok;
  if not ok then
    raise exception 'invalid_admin_password';
  end if;

  delete from public.slots where id = p_id;
end;
$$;

drop function if exists public.submit_slot_request(text, text, text, text, text);
create function public.submit_slot_request(
  p_slot_id text,
  p_student_name text,
  p_student_contact text,
  p_student_class text,
  p_student_note text
)
returns public.slot_requests
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  created_request public.slot_requests;
begin
  if p_slot_id is null or btrim(p_slot_id) = '' then
    raise exception 'slot_id_required';
  end if;

  if p_student_contact is null or btrim(p_student_contact) = '' then
    raise exception 'student_contact_required';
  end if;

  insert into public.slot_requests (
    slot_id,
    student_name,
    student_contact,
    student_class,
    student_note,
    status,
    created_at
  )
  values (
    btrim(p_slot_id),
    nullif(btrim(p_student_name), ''),
    btrim(p_student_contact),
    nullif(btrim(p_student_class), ''),
    nullif(btrim(p_student_note), ''),
    'pending',
    now()
  )
  returning * into created_request;

  return created_request;
end;
$$;

drop function if exists public.submit_slot_request(text, text, text, text);
create function public.submit_slot_request(
  p_slot_id text,
  p_student_name text,
  p_student_contact text,
  p_student_note text
)
returns public.slot_requests
language sql
security definer
set search_path = public, extensions
as $$
  select public.submit_slot_request(p_slot_id, p_student_name, p_student_contact, null, p_student_note);
$$;

drop function if exists public.admin_get_slot_requests(text);
create function public.admin_get_slot_requests(input_password text)
returns table (
  id uuid,
  slot_id text,
  student_name text,
  student_contact text,
  student_class text,
  student_note text,
  status text,
  admin_note text,
  created_at timestamptz,
  reviewed_at timestamptz,
  slot_day_of_week int,
  slot_start_time text,
  slot_end_time text,
  slot_label text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  ok boolean;
begin
  select public.verify_admin_password(input_password) into ok;
  if not ok then
    raise exception 'invalid_admin_password';
  end if;

  return query
  select
    r.id,
    r.slot_id,
    r.student_name,
    r.student_contact,
    r.student_class,
    r.student_note,
    r.status,
    r.admin_note,
    r.created_at,
    r.reviewed_at,
    s.day_of_week,
    s.start_time,
    s.end_time,
    s.label
  from public.slot_requests r
  left join public.slots s on s.id = r.slot_id
  order by
    case r.status when 'pending' then 0 when 'approved' then 1 else 2 end,
    r.created_at desc;
end;
$$;

drop function if exists public.admin_review_slot_request(text, uuid, text, text);
create function public.admin_review_slot_request(
  input_password text,
  p_request_id uuid,
  p_status text,
  p_admin_note text
)
returns public.slot_requests
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  ok boolean;
  updated_request public.slot_requests;
begin
  select public.verify_admin_password(input_password) into ok;
  if not ok then
    raise exception 'invalid_admin_password';
  end if;

  if p_status not in ('approved', 'rejected') then
    raise exception 'invalid_status';
  end if;

  update public.slot_requests
  set
    status = p_status,
    admin_note = nullif(btrim(p_admin_note), ''),
    reviewed_at = now()
  where id = p_request_id
  returning * into updated_request;

  if updated_request.id is null then
    raise exception 'request_not_found';
  end if;

  return updated_request;
end;
$$;

drop function if exists public.admin_update_slot_request(text, uuid, text, text, text, text);
create function public.admin_update_slot_request(
  input_password text,
  p_request_id uuid,
  p_student_name text,
  p_student_contact text,
  p_student_class text,
  p_student_note text
)
returns public.slot_requests
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  ok boolean;
  updated_request public.slot_requests;
begin
  select public.verify_admin_password(input_password) into ok;
  if not ok then
    raise exception 'invalid_admin_password';
  end if;

  if p_student_contact is null or btrim(p_student_contact) = '' then
    raise exception 'student_contact_required';
  end if;

  update public.slot_requests
  set
    student_name = nullif(btrim(p_student_name), ''),
    student_contact = btrim(p_student_contact),
    student_class = nullif(btrim(p_student_class), ''),
    student_note = nullif(btrim(p_student_note), '')
  where id = p_request_id
  returning * into updated_request;

  if updated_request.id is null then
    raise exception 'request_not_found';
  end if;

  return updated_request;
end;
$$;

-- Revoke default execute for safety, then grant only what client needs.
revoke all on function public.verify_admin_password(text) from public;
revoke all on function public.admin_upsert_slot(text, jsonb) from public;
revoke all on function public.admin_delete_slot(text, text) from public;
revoke all on function public.submit_slot_request(text, text, text, text, text) from public;
revoke all on function public.submit_slot_request(text, text, text, text) from public;
revoke all on function public.admin_get_slot_requests(text) from public;
revoke all on function public.admin_review_slot_request(text, uuid, text, text) from public;
revoke all on function public.admin_update_slot_request(text, uuid, text, text, text, text) from public;

grant execute on function public.verify_admin_password(text) to anon, authenticated;
grant execute on function public.admin_upsert_slot(text, jsonb) to anon, authenticated;
grant execute on function public.admin_delete_slot(text, text) to anon, authenticated;
grant execute on function public.submit_slot_request(text, text, text, text, text) to anon, authenticated;
grant execute on function public.submit_slot_request(text, text, text, text) to anon, authenticated;
grant execute on function public.admin_get_slot_requests(text) to anon, authenticated;
grant execute on function public.admin_review_slot_request(text, uuid, text, text) to anon, authenticated;
grant execute on function public.admin_update_slot_request(text, uuid, text, text, text, text) to anon, authenticated;

-- 6) Seed config row safely
insert into public.schedule_configs (id, title, default_language, timezone, show_full_slots)
values (1, 'Disponibilitate', 'ro', 'Europe/Chisinau', true)
on conflict (id)
do update set
  title = coalesce(public.schedule_configs.title, excluded.title),
  default_language = coalesce(public.schedule_configs.default_language, excluded.default_language),
  timezone = coalesce(public.schedule_configs.timezone, excluded.timezone),
  show_full_slots = coalesce(public.schedule_configs.show_full_slots, excluded.show_full_slots),
  updated_at = now();


-- Temporary recovery reset: set admin password to 2233.
-- Rotate immediately after login using admin_change_password RPC.
update public.admin_settings
set
  password_hash = extensions.crypt('2233', extensions.gen_salt('bf')),
  updated_at = now()
where id = 1;

create or replace function public.admin_change_password(
  input_password text,
  new_password text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  ok boolean;
begin
  select public.verify_admin_password(input_password) into ok;
  if not ok then
    raise exception 'invalid_admin_password';
  end if;

  if new_password is null or length(btrim(new_password)) < 6 then
    raise exception 'new_password_too_short';
  end if;

  update public.admin_settings
  set
    password_hash = extensions.crypt(btrim(new_password), extensions.gen_salt('bf')),
    updated_at = now()
  where id = 1;

  return true;
end;
$$;

revoke all on function public.admin_change_password(text, text) from public;
grant execute on function public.admin_change_password(text, text) to anon, authenticated;


create or replace function public.admin_get_slot_requests(input_password text)
returns table (
  id uuid,
  slot_id text,
  student_name text,
  student_contact text,
  student_class text,
  student_note text,
  status text,
  admin_note text,
  created_at timestamptz,
  reviewed_at timestamptz,
  slot_day_of_week int,
  slot_start_time text,
  slot_end_time text,
  slot_label text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  ok boolean;
begin
  select public.verify_admin_password(input_password) into ok;
  if not ok then
    raise exception 'invalid_admin_password';
  end if;

  return query
  select
    r.id,
    r.slot_id::text,
    r.student_name::text,
    r.student_contact::text,
    r.student_class::text,
    r.student_note::text,
    r.status::text,
    r.admin_note::text,
    r.created_at,
    r.reviewed_at,
    s.day_of_week::int,
    s.start_time::text,
    s.end_time::text,
    s.label::text
  from public.slot_requests r
  left join public.slots s on s.id = r.slot_id
  order by
    case r.status when 'pending' then 0 when 'approved' then 1 else 2 end,
    r.created_at desc;
end;
$$;



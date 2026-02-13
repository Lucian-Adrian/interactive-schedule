-- Schedule Sync full setup generated from migrations.
-- Run with Supabase SQL editor only on a clean or controlled environment.

-- ===== Migration: 20260212142024_remote_schema.sql =====

-- ===== Migration: 20260212142229_clean_schedule_schema.sql =====
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

-- ===== Migration: 20260212151133_reset_admin_password_and_add_rotation_rpc.sql =====
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

-- ===== Migration: 20260212151256_fix_admin_get_slot_requests_casts.sql =====
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

-- ===== Migration: 20260213193000_profiles_calendar_requests.sql =====
create extension if not exists pgcrypto with schema extensions;

-- 1) Profiles / shareable views
create table if not exists public.schedule_profiles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null default 'Disponibilitate',
  description text,
  mode text not null default 'weekly',
  timezone text,
  default_language text,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.schedule_profiles add column if not exists slug text;
alter table public.schedule_profiles add column if not exists title text;
alter table public.schedule_profiles add column if not exists description text;
alter table public.schedule_profiles add column if not exists mode text;
alter table public.schedule_profiles add column if not exists timezone text;
alter table public.schedule_profiles add column if not exists default_language text;
alter table public.schedule_profiles add column if not exists is_public boolean;
alter table public.schedule_profiles add column if not exists created_at timestamptz;
alter table public.schedule_profiles add column if not exists updated_at timestamptz;

update public.schedule_profiles
set
  slug = coalesce(nullif(slug, ''), id::text),
  title = coalesce(nullif(btrim(title), ''), 'Disponibilitate'),
  mode = case when mode in ('weekly', 'calendar') then mode else 'weekly' end,
  is_public = coalesce(is_public, true),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.schedule_profiles alter column slug set not null;
alter table public.schedule_profiles alter column title set not null;
alter table public.schedule_profiles alter column mode set not null;
alter table public.schedule_profiles alter column is_public set not null;
alter table public.schedule_profiles alter column created_at set not null;
alter table public.schedule_profiles alter column updated_at set not null;

alter table public.schedule_profiles alter column title set default 'Disponibilitate';
alter table public.schedule_profiles alter column mode set default 'weekly';
alter table public.schedule_profiles alter column is_public set default true;
alter table public.schedule_profiles alter column created_at set default now();
alter table public.schedule_profiles alter column updated_at set default now();

alter table public.schedule_profiles drop constraint if exists schedule_profiles_mode_check;
alter table public.schedule_profiles
  add constraint schedule_profiles_mode_check
  check (mode in ('weekly', 'calendar'));

create unique index if not exists schedule_profiles_slug_key on public.schedule_profiles (slug);

insert into public.schedule_profiles (slug, title, mode, timezone, default_language, is_public)
select
  'default',
  coalesce(nullif(btrim(c.title), ''), 'Disponibilitate'),
  'weekly',
  coalesce(nullif(c.timezone, ''), 'Europe/Chisinau'),
  coalesce(nullif(c.default_language, ''), 'ro'),
  true
from public.schedule_configs c
where c.id = 1
on conflict (slug) do nothing;

insert into public.schedule_profiles (slug, title, mode, timezone, default_language, is_public)
values ('default', 'Disponibilitate', 'weekly', 'Europe/Chisinau', 'ro', true)
on conflict (slug) do nothing;

-- 2) Attach slots to profiles and support date slots
alter table public.slots add column if not exists profile_id uuid;
alter table public.slots add column if not exists slot_date date;

update public.slots s
set profile_id = p.id
from public.schedule_profiles p
where p.slug = 'default'
  and s.profile_id is null;

alter table public.slots drop constraint if exists slots_profile_id_fkey;
alter table public.slots
  add constraint slots_profile_id_fkey
  foreign key (profile_id) references public.schedule_profiles(id) on delete cascade;

alter table public.slots alter column profile_id set not null;

create index if not exists slots_profile_day_time_idx
  on public.slots (profile_id, day_of_week, start_time);
create index if not exists slots_profile_date_time_idx
  on public.slots (profile_id, slot_date, start_time);

-- 3) Attach requests to profiles for easier management
alter table public.slot_requests add column if not exists profile_id uuid;

update public.slot_requests r
set profile_id = s.profile_id
from public.slots s
where s.id = r.slot_id
  and r.profile_id is null;

update public.slot_requests r
set profile_id = p.id
from public.schedule_profiles p
where p.slug = 'default'
  and r.profile_id is null;

alter table public.slot_requests drop constraint if exists slot_requests_profile_id_fkey;
alter table public.slot_requests
  add constraint slot_requests_profile_id_fkey
  foreign key (profile_id) references public.schedule_profiles(id) on delete cascade;

alter table public.slot_requests alter column profile_id set not null;

create index if not exists slot_requests_profile_status_created_idx
  on public.slot_requests (profile_id, status, created_at desc);

-- 4) RLS updates
alter table public.schedule_profiles enable row level security;

drop policy if exists "public read schedule_profiles" on public.schedule_profiles;
create policy "public read schedule_profiles"
on public.schedule_profiles
for select
to anon, authenticated
using (is_public = true);

drop policy if exists "public read slots" on public.slots;
create policy "public read slots"
on public.slots
for select
to anon, authenticated
using (
  visibility = true
  and exists (
    select 1
    from public.schedule_profiles p
    where p.id = slots.profile_id
      and p.is_public = true
  )
);

grant select on table public.schedule_profiles to anon, authenticated;
revoke insert, update, delete on table public.schedule_profiles from anon, authenticated;

-- 5) RPC: admin profile CRUD + slots/read improvements + requests delete
create or replace function public.admin_get_profiles(input_password text)
returns setof public.schedule_profiles
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
  select p.*
  from public.schedule_profiles p
  order by p.created_at asc;
end;
$$;

create or replace function public.admin_upsert_profile(input_password text, payload jsonb)
returns public.schedule_profiles
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  ok boolean;
  target_id uuid;
  next_slug text;
  next_mode text;
  upserted public.schedule_profiles;
begin
  select public.verify_admin_password(input_password) into ok;
  if not ok then
    raise exception 'invalid_admin_password';
  end if;

  target_id := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  next_slug := lower(regexp_replace(coalesce(payload->>'slug', ''), '[^a-z0-9-]+', '-', 'g'));
  next_slug := trim(both '-' from next_slug);
  if next_slug = '' then
    raise exception 'profile_slug_required';
  end if;

  next_mode := case when payload->>'mode' = 'calendar' then 'calendar' else 'weekly' end;

  insert into public.schedule_profiles (
    id,
    slug,
    title,
    description,
    mode,
    timezone,
    default_language,
    is_public,
    updated_at
  )
  values (
    target_id,
    next_slug,
    coalesce(nullif(payload->>'title', ''), 'Disponibilitate'),
    nullif(payload->>'description', ''),
    next_mode,
    nullif(payload->>'timezone', ''),
    nullif(payload->>'default_language', ''),
    coalesce((payload->>'is_public')::boolean, true),
    now()
  )
  on conflict (id)
  do update set
    slug = excluded.slug,
    title = excluded.title,
    description = excluded.description,
    mode = excluded.mode,
    timezone = excluded.timezone,
    default_language = excluded.default_language,
    is_public = excluded.is_public,
    updated_at = now()
  returning * into upserted;

  return upserted;
end;
$$;

create or replace function public.admin_delete_profile(input_password text, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  ok boolean;
  total_profiles int;
begin
  select public.verify_admin_password(input_password) into ok;
  if not ok then
    raise exception 'invalid_admin_password';
  end if;

  select count(*) into total_profiles from public.schedule_profiles;
  if total_profiles <= 1 then
    raise exception 'cannot_delete_last_profile';
  end if;

  delete from public.schedule_profiles where id = p_profile_id;
  if not found then
    raise exception 'profile_not_found';
  end if;
end;
$$;

create or replace function public.admin_get_slots(input_password text, p_profile_id uuid)
returns setof public.slots
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
  select s.*
  from public.slots s
  where s.profile_id = p_profile_id
  order by
    coalesce(s.slot_date, '3000-01-01'::date) asc,
    s.day_of_week asc,
    s.start_time asc;
end;
$$;

create or replace function public.admin_upsert_slot(input_password text, payload jsonb)
returns public.slots
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  ok boolean;
  upserted public.slots;
  next_profile_id uuid;
  next_slot_date date;
  next_day_of_week int;
begin
  select public.verify_admin_password(input_password) into ok;
  if not ok then
    raise exception 'invalid_admin_password';
  end if;

  if coalesce(payload->>'id', '') = '' then
    raise exception 'slot_id_required';
  end if;

  next_profile_id := nullif(payload->>'profile_id', '')::uuid;
  if next_profile_id is null then
    select id into next_profile_id
    from public.schedule_profiles
    where slug = 'default'
    limit 1;
  end if;
  if next_profile_id is null then
    raise exception 'profile_required';
  end if;

  if not exists (select 1 from public.schedule_profiles p where p.id = next_profile_id) then
    raise exception 'profile_not_found';
  end if;

  next_slot_date := nullif(payload->>'slot_date', '')::date;
  next_day_of_week := coalesce(
    (payload->>'day_of_week')::int,
    case when next_slot_date is null then 1 else extract(dow from next_slot_date)::int end
  );

  if next_day_of_week < 0 or next_day_of_week > 6 then
    raise exception 'invalid_day_of_week';
  end if;

  insert into public.slots (
    id,
    profile_id,
    slot_date,
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
    next_profile_id,
    next_slot_date,
    next_day_of_week,
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
    profile_id = excluded.profile_id,
    slot_date = excluded.slot_date,
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

create or replace function public.submit_slot_request(
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
  request_profile_id uuid;
begin
  if p_slot_id is null or btrim(p_slot_id) = '' then
    raise exception 'slot_id_required';
  end if;

  if p_student_name is null or btrim(p_student_name) = '' then
    raise exception 'student_name_required';
  end if;

  if p_student_contact is null or btrim(p_student_contact) = '' then
    raise exception 'student_contact_required';
  end if;

  select s.profile_id
    into request_profile_id
  from public.slots s
  join public.schedule_profiles p on p.id = s.profile_id
  where s.id = btrim(p_slot_id)
    and s.visibility = true
    and p.is_public = true
  limit 1;

  if request_profile_id is null then
    raise exception 'slot_not_found';
  end if;

  insert into public.slot_requests (
    slot_id,
    profile_id,
    student_name,
    student_contact,
    student_class,
    student_note,
    status,
    created_at
  )
  values (
    btrim(p_slot_id),
    request_profile_id,
    btrim(p_student_name),
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

drop function if exists public.admin_get_slot_requests(text);
create or replace function public.admin_get_slot_requests(input_password text)
returns table (
  id uuid,
  profile_id uuid,
  profile_slug text,
  profile_title text,
  slot_id text,
  student_name text,
  student_contact text,
  student_class text,
  student_note text,
  status text,
  admin_note text,
  created_at timestamptz,
  reviewed_at timestamptz,
  slot_date date,
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
    r.profile_id,
    p.slug::text,
    p.title::text,
    r.slot_id::text,
    r.student_name::text,
    r.student_contact::text,
    r.student_class::text,
    r.student_note::text,
    r.status::text,
    r.admin_note::text,
    r.created_at,
    r.reviewed_at,
    s.slot_date,
    s.day_of_week::int,
    s.start_time::text,
    s.end_time::text,
    s.label::text
  from public.slot_requests r
  left join public.slots s on s.id = r.slot_id
  left join public.schedule_profiles p on p.id = r.profile_id
  order by
    case r.status when 'pending' then 0 when 'approved' then 1 else 2 end,
    r.created_at desc;
end;
$$;

create or replace function public.admin_update_slot_request(
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

  if p_student_name is null or btrim(p_student_name) = '' then
    raise exception 'student_name_required';
  end if;

  if p_student_contact is null or btrim(p_student_contact) = '' then
    raise exception 'student_contact_required';
  end if;

  update public.slot_requests
  set
    student_name = btrim(p_student_name),
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

create or replace function public.admin_delete_slot_request(input_password text, p_request_id uuid)
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

  delete from public.slot_requests where id = p_request_id;
  if not found then
    raise exception 'request_not_found';
  end if;
end;
$$;

-- 6) Permissions for new/updated RPCs
revoke all on function public.admin_get_profiles(text) from public;
revoke all on function public.admin_upsert_profile(text, jsonb) from public;
revoke all on function public.admin_delete_profile(text, uuid) from public;
revoke all on function public.admin_get_slots(text, uuid) from public;
revoke all on function public.admin_delete_slot_request(text, uuid) from public;

grant execute on function public.admin_get_profiles(text) to anon, authenticated;
grant execute on function public.admin_upsert_profile(text, jsonb) to anon, authenticated;
grant execute on function public.admin_delete_profile(text, uuid) to anon, authenticated;
grant execute on function public.admin_get_slots(text, uuid) to anon, authenticated;
grant execute on function public.admin_delete_slot_request(text, uuid) to anon, authenticated;

-- ===== Migration: 20260213202500_only_name_required.sql =====
-- Relax request validation: only student name is required.

alter table public.slot_requests
  alter column student_contact drop not null;

create or replace function public.submit_slot_request(
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
  request_profile_id uuid;
begin
  if p_slot_id is null or btrim(p_slot_id) = '' then
    raise exception 'slot_id_required';
  end if;

  if p_student_name is null or btrim(p_student_name) = '' then
    raise exception 'student_name_required';
  end if;

  select s.profile_id
    into request_profile_id
  from public.slots s
  join public.schedule_profiles p on p.id = s.profile_id
  where s.id = btrim(p_slot_id)
    and s.visibility = true
    and p.is_public = true
  limit 1;

  if request_profile_id is null then
    raise exception 'slot_not_found';
  end if;

  insert into public.slot_requests (
    slot_id,
    profile_id,
    student_name,
    student_contact,
    student_class,
    student_note,
    status,
    created_at
  )
  values (
    btrim(p_slot_id),
    request_profile_id,
    btrim(p_student_name),
    nullif(btrim(coalesce(p_student_contact, '')), ''),
    nullif(btrim(coalesce(p_student_class, '')), ''),
    nullif(btrim(coalesce(p_student_note, '')), ''),
    'pending',
    now()
  )
  returning * into created_request;

  return created_request;
end;
$$;

create or replace function public.admin_update_slot_request(
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

  if p_student_name is null or btrim(p_student_name) = '' then
    raise exception 'student_name_required';
  end if;

  update public.slot_requests
  set
    student_name = btrim(p_student_name),
    student_contact = nullif(btrim(coalesce(p_student_contact, '')), ''),
    student_class = nullif(btrim(coalesce(p_student_class, '')), ''),
    student_note = nullif(btrim(coalesce(p_student_note, '')), '')
  where id = p_request_id
  returning * into updated_request;

  if updated_request.id is null then
    raise exception 'request_not_found';
  end if;

  return updated_request;
end;
$$;


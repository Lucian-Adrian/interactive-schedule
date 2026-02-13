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

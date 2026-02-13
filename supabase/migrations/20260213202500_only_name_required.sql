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

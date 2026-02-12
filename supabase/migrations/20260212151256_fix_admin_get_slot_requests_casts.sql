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

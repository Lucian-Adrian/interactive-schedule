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

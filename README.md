# Interactive Schedule

Public tutoring schedule built with React + Supabase and deployed as a static site.

## Features

- Public users can view slots and submit join requests.
- Admin can log in with password, edit slots, and review requests.
- Admin login is hidden behind a tiny trigger and `Ctrl/Cmd + Shift + A`.
- Data access is enforced via Supabase RLS + RPC functions.

## Supabase setup

1. Link your project:
   - `supabase link --project-ref ysswamnkarliovhfoczj`
2. Push migrations:
   - `supabase db push`
3. Set your real admin password in Supabase SQL Editor:

```sql
update public.admin_settings
set password_hash = extensions.crypt('<your-strong-password>', extensions.gen_salt('bf')),
    updated_at = now()
where id = 1;
```

The migration intentionally does not commit a known default admin password.

## Current admin login

- Temporary recovery password is `2233`.
- Rotate it immediately after login (minimum 6 chars) with SQL:

```sql
select public.admin_change_password('2233', '<your-new-strong-password>');
```

## Local run

1. Create `.env` with:
   - `PUBLIC_SUPABASE_URL=...`
   - `PUBLIC_SUPABASE_ANON_KEY=...`
2. Start app:
   - `npm install`
   - `npm run dev`

## GitHub Pages deploy

Set repository secrets:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`

Push to `main` and the workflow in `.github/workflows/deploy-pages.yml` will deploy to Pages.

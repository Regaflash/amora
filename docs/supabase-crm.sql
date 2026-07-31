-- Amora Studio — read/update access for the studio's own CRM (admin.html).
-- Run once in the Supabase SQL editor, after docs/supabase-leads.sql.
--
-- The public form writes with the anon key, and that key must stay write-only:
-- it ships in the page source, so anything it can read, the whole internet can
-- read. The CRM therefore reads with a real signed-in user (role
-- `authenticated`) — but "authenticated" on its own is NOT a gate. Supabase
-- projects accept sign-ups with the anon key by default, so a policy granted to
-- `authenticated` is effectively a policy granted to anyone who registers.
-- Membership of public.admins below is the real gate.

begin;

-- 1 · who counts as an admin -------------------------------------------------

create table if not exists public.admins (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  email    text,
  added_at timestamptz not null default now()
);

alter table public.admins enable row level security;

-- Deliberately no policies and no grants: with RLS on and nothing granted,
-- neither anon nor authenticated can read or write this table through the API.
-- It is maintained from the SQL editor only.
revoke all on table public.admins from anon, authenticated;

-- 2 · the membership test ----------------------------------------------------

-- SECURITY DEFINER on purpose. A policy on public.leads that queried
-- public.admins directly would have that subquery filtered by admins' own
-- (empty) policy set and would always evaluate to false.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
-- Empty, not 'public, pg_temp': the body below is fully qualified
-- (public.admins, auth.uid()), so nothing needs resolving through a path an
-- attacker could shadow.
set search_path = ''
as $$
  select exists (
    select 1 from public.admins a where a.user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- 3 · policies ---------------------------------------------------------------

drop policy if exists "admins can read leads" on public.leads;
create policy "admins can read leads"
  on public.leads for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admins can update leads" on public.leads;
create policy "admins can update leads"
  on public.leads for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- No DELETE policy anywhere. A lead is the studio's record of a real enquiry;
-- deleting one is a deliberate act for the dashboard, not a mis-tap on a phone.

-- 4 · GRANTs — the half that is easy to forget --------------------------------

-- RLS decides which ROWS a role may touch. Postgres checks the TABLE privilege
-- first, and a policy without a matching grant does nothing at all. This
-- project already lost an afternoon to exactly that on the INSERT side.
grant usage on schema public to authenticated;
grant select on table public.leads to authenticated;

-- UPDATE is column-scoped: the CRM only ever flips `handled`. Even a stolen
-- owner session cannot rewrite a customer's phone number or message.
-- If you later add an editable field (say `notes`), grant it here too or the
-- PATCH comes back 403.
grant update (handled) on table public.leads to authenticated;

-- 5 · confirm the public key stayed write-only -------------------------------

revoke select, update, delete on table public.leads from anon;
grant insert on table public.leads to anon;   -- unchanged: what the site needs

-- TRUNCATE is exempt from row-level security, so an RLS policy would not stop
-- it. These three are Supabase default-privilege leftovers and were confirmed
-- present on this project before this file was run.
revoke truncate, references, trigger on table public.leads from anon, authenticated;

commit;

-- 6 · owner steps, after running this ----------------------------------------
--
-- a. Authentication → Users → "Add user": the studio's e-mail and a long,
--    unique password (a password manager entry, not a phone number).
--
-- b. Promote that user:
--       insert into public.admins (user_id, email)
--       select id, email from auth.users where email = 'owner@example.com'
--       on conflict (user_id) do nothing;
--
-- c. Authentication → Sign In / Providers → Email: turn OFF "Allow new users
--    to sign up". Nothing above depends on that switch — a stranger who signs
--    up still reads nothing — but there is no reason to let anyone open an
--    account against this project.
--
-- d. Optional but recommended: Authentication → Multi-Factor, enrol the owner.
--    The password is the only thing standing between the internet and every
--    customer's phone number.
--
-- 7 · verify (paste into the SQL editor) -------------------------------------
--
--    select grantee, privilege_type, column_name
--      from information_schema.column_privileges
--     where table_name = 'leads' and grantee in ('anon','authenticated')
--     union all
--    select grantee, privilege_type, null
--      from information_schema.table_privileges
--     where table_name = 'leads' and grantee in ('anon','authenticated')
--     order by 1, 2;
--
-- Expected: anon → INSERT only. authenticated → SELECT, plus UPDATE on the
-- single column `handled`. Anything else is a leak.
--
-- And from a terminal, with the anon key — this must return an empty array or
-- a permission error, never a lead:
--    curl "$SUPABASE_URL/rest/v1/leads?select=name" -H "apikey: $ANON_KEY"

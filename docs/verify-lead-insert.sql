-- Can a visitor actually submit the form?
--
-- Paste into the Supabase SQL editor and run. It writes nothing: the INSERT is
-- rolled back. Run it after ANY change to public.leads, to the grants, or to
-- the fields the form posts.
--
-- ── why this file exists ─────────────────────────────────────────────────────
-- On 2026-08-03 the live form began rejecting every submission, and
-- public.leads stayed empty for a day. anon's INSERT is column-scoped, three
-- new columns were added to the table and to the site, and the grant was never
-- widened. A column-scoped grant is all-or-nothing per statement: naming one
-- ungranted column fails the whole INSERT with "permission denied for column".
--
-- Every check that existed at the time passed:
--   * the RLS policy was correct and looked it — a policy filters rows, it does
--     not confer privileges, so nothing in pg_policy could have shown this;
--   * information_schema.role_table_grants does not list column-scoped grants
--     at all, so the table-level view showed anon holding nothing;
--   * the pipeline was smoke-tested with a privileged INSERT, and postgres
--     ignores column grants — it exercised the one path a visitor never takes.
--
-- So this file does the only thing that settles it: becomes anon, and inserts
-- exactly what the browser sends.
--
-- Keep the column list identical to the payload in assets/js/main.js.
-- tools/check.sh compares the two on every build and fails when they drift.

begin;

-- 1 ── the real thing, as the role the browser actually uses ─────────────────
-- Not postgres. Not service_role. This is the whole point of the file.
set local role anon;

insert into public.leads
  (name, phone, email, event_date, date_tbd, event_type, area, coverage, message, source)
values
  ('בדיקת הרשאות — לא ליד אמיתי', '0500000000', 'probe@example.invalid',
   null, true, 'other', 'מרכז', 'both', 'rolled back by verify-lead-insert.sql', 'grant-probe');

-- Reaching here means a visitor can submit. If it raised
-- "permission denied for column X", X is missing from the grant:
--
--   grant insert (X) on table public.leads to anon;
--
-- Do NOT fix it with a table-level grant. anon must not be able to write
-- `handled` (a stranger could mark their own lead dealt with and bury it) or
-- `id` / `created_at`. Column-scoping is deliberate; widening it correctly
-- means naming the new column.

reset role;

-- 2 ── nothing was kept ──────────────────────────────────────────────────────
rollback;

-- 3 ── what anon may insert right now, for the record ────────────────────────
-- Read this list, not role_table_grants, which omits column-scoped grants.
select string_agg(column_name, ', ' order by column_name) as anon_may_insert,
       count(*) as columns
  from information_schema.role_column_grants
 where table_schema = 'public'
   and table_name   = 'leads'
   and grantee      = 'anon'
   and privilege_type = 'INSERT';

-- 4 ── anything anon can write that it should not ────────────────────────────
-- Expected: zero rows. A row here means the form's identity could tamper with
-- bookkeeping columns.
select column_name as anon_should_not_have
  from information_schema.role_column_grants
 where table_schema = 'public'
   and table_name   = 'leads'
   and grantee      = 'anon'
   and privilege_type = 'INSERT'
   and column_name in ('id', 'created_at', 'handled');

-- 5 ── and that anon still cannot read leads back ────────────────────────────
-- Expected: false. The public key is write-only by design; admin.html reads as
-- an authenticated admin through is_admin().
select has_table_privilege('anon', 'public.leads', 'SELECT') as anon_can_read_leads;

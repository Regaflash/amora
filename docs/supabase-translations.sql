-- Amora Studio — translation cache.
-- Applied to dkejuaildigikufrdiru on 2026-08-05. Kept here so the schema is
-- reproducible, per the repo rule that deploy state must have a counterpart
-- in the repo.
--
-- Public marketing copy, translated once and reused. Keyed by the normalised
-- source STRING rather than by page, so navigation and footer text warms up on
-- the first page view and serves every page after it.

create table if not exists public.translations (
  hash       text not null,                 -- sha256 of the normalised source
  lang       text not null check (lang in ('en','ru','ar')),
  source     text not null check (char_length(source) <= 4000),
  target     text not null check (char_length(target) <= 8000),
  model      text,                          -- which model produced it, for audit
  created_at timestamptz not null default now(),
  primary key (hash, lang)
);

alter table public.translations enable row level security;

-- anon and authenticated get nothing at all. Every read and write goes through
-- the `translate` Edge Function with the service role. Not because the text is
-- secret -- it is public website copy -- but to keep one writer and a small
-- surface.
revoke all on table public.translations from anon, authenticated;

-- THE GRANT THAT WAS MISSED, AND WHY IT MATTERS
--
-- RLS decides which ROWS a role may touch. Postgres checks the TABLE privilege
-- first, and a policy without a matching grant is inert. CLAUDE.md records
-- that this project already lost a day to exactly this on the lead form's
-- INSERT.
--
-- It happened again here, with a quieter symptom: service_role was left with
-- only REFERENCES, TRIGGER and TRUNCATE, so the function returned correct
-- translations while silently writing none of them. Every visitor would have
-- paid a fresh model call forever and the feature would have looked like it
-- worked. Caught by checking that rows actually landed, not by reading code.
grant select, insert on table public.translations to service_role;

revoke truncate, references, trigger on table public.translations
  from anon, authenticated, service_role;

comment on table public.translations is
  'Cache of machine translations of public site copy. hash = sha256 of the whitespace-normalised Hebrew source. Service role only; see docs/translation-flow.md.';

-- VERIFY (paste into the SQL editor)
--
--   select grantee, string_agg(distinct privilege_type, ', ' order by privilege_type)
--     from information_schema.table_privileges
--    where table_schema='public' and table_name='translations'
--    group by grantee order by grantee;
--
-- Expected: service_role -> INSERT, SELECT. Nothing at all for anon or
-- authenticated. Anything else is a leak or a silent no-op.
--
-- And the cache itself, which is the real test:
--   select lang, count(*), max(created_at) from public.translations group by lang;
--
-- A bad translation is fixed by deleting it; the next visitor regenerates it:
--   delete from public.translations where hash = '…' and lang = 'ar';

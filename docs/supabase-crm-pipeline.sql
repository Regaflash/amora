-- Amora Studio — CRM pipeline: statuses, notes, ad-lead intake, contracts.
-- Run once in the Supabase SQL editor, after docs/supabase-crm.sql.
--
-- What this adds on top of the read/update CRM:
--   · a sales pipeline on public.leads (status, notes, campaign, external_id)
--   · public.contracts — one row per contract the studio issues, with a
--     capability-URL token for the couple's signing page
--   · public.lead_events — the timeline the CRM shows per lead
--   · private.settings — service-role-only key/value store, holding the key
--     Google Ads must echo back on every lead webhook call
--
-- The permission philosophy is unchanged from docs/supabase-crm.sql: the anon
-- key stays write-only and column-scoped; `authenticated` is only a gate when
-- combined with public.is_admin(); every UPDATE grant is column-scoped.

begin;

create extension if not exists pgcrypto with schema extensions;

-- 1 · leads: pipeline columns -------------------------------------------------

alter table public.leads
  add column if not exists status text not null default 'new'
    constraint leads_status_check
    check (status in ('new','contacted','proposal','contract_sent','signed','lost')),
  add column if not exists notes text
    constraint leads_notes_check check (notes is null or char_length(notes) <= 4000),
  add column if not exists external_id text
    constraint leads_external_id_check check (external_id is null or char_length(external_id) <= 120),
  add column if not exists campaign text
    constraint leads_campaign_check check (campaign is null or char_length(campaign) <= 300);

-- Ad-platform rows arrive via pollers/webhooks that may fire twice; the id
-- from the platform makes the insert idempotent.
--
-- FULL unique index, NOT partial. It was `... where external_id is not null`
-- once, which broke the whole point: PostgREST's on_conflict=external_id cannot
-- infer a PARTIAL index, so lead-intake-google's insert failed 42P10 ("no
-- unique or exclusion constraint matching the ON CONFLICT specification") and
-- every Google Ads lead was dropped. A full unique index still allows any
-- number of NULL external_ids — website and WhatsApp leads — because Postgres
-- treats NULLs as distinct in a unique index, so the partial predicate bought
-- nothing and cost the idempotency it was meant to provide. Fixed 2026-08-17.
create unique index if not exists leads_external_id_key
  on public.leads (external_id);

-- Existing rows: anything already marked handled has at least been contacted.
update public.leads set status = 'contacted' where handled and status = 'new';

-- The CRM may now edit exactly these three columns, nothing else. A stolen
-- owner session still cannot rewrite a customer's phone number.
revoke update on table public.leads from authenticated;
grant update (handled, status, notes) on table public.leads to authenticated;

-- The public site key stays write-only AND becomes column-scoped: a stranger
-- with the anon key must not be able to set status/notes/external_id/campaign.
-- These ten columns are exactly what assets/js/main.js sends.
revoke insert on table public.leads from anon;
grant insert (name, phone, email, event_date, date_tbd, event_type, area, coverage, message, source) on table public.leads to anon;

-- 2 · contracts ---------------------------------------------------------------

create table if not exists public.contracts (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid references public.leads (id) on delete set null,
  created_at    timestamptz not null default now(),
  status        text not null default 'draft'
                check (status in ('draft','sent','signed','cancelled')),
  -- Capability URL for the couple's signing page: 24 random bytes, hex.
  -- Whoever holds the link holds the contract, so the token must be long
  -- enough that nobody ever guesses one.
  token         text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  couple_name   text not null check (char_length(trim(couple_name)) between 2 and 160),
  phone         text,
  email         text,
  event_date    date,
  event_type    text,
  venue         text,
  package       text,
  hours         text,
  -- Prices live HERE, never on the site: the no-prices brief covers the public
  -- pages, not the studio's own paperwork.
  price_total   numeric(10,2) check (price_total is null or price_total >= 0),
  deposit       numeric(10,2) check (deposit is null or deposit >= 0),
  notes         text check (notes is null or char_length(notes) <= 4000),
  terms_version text not null default 'v1',
  sent_at       timestamptz,
  viewed_at     timestamptz,
  signed_at     timestamptz,
  signed_name   text,
  signature     text check (signature is null or char_length(signature) <= 300000),
  signer_ip     text,
  signer_ua     text
);

alter table public.contracts enable row level security;

-- Admins manage contracts from the CRM with their own JWT. The couple's
-- signing page never touches PostgREST — it goes through the `contract`
-- Edge Function, which uses the service role and checks the token itself.
drop policy if exists "admins read contracts" on public.contracts;
create policy "admins read contracts" on public.contracts
  for select to authenticated using (public.is_admin());

drop policy if exists "admins create contracts" on public.contracts;
create policy "admins create contracts" on public.contracts
  for insert to authenticated with check (public.is_admin());

drop policy if exists "admins update contracts" on public.contracts;
create policy "admins update contracts" on public.contracts
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on table public.contracts from anon, authenticated;
grant select, insert on table public.contracts to authenticated;
-- Update is column-scoped: the CRM sends/cancels and fixes details; the
-- signature columns are written only by the Edge Function's service role.
grant update (status, sent_at, couple_name, phone, email, event_date, event_type, venue, package, hours, price_total, deposit, notes) on table public.contracts to authenticated;
revoke truncate, references, trigger, delete on table public.contracts from anon, authenticated;

-- 3 · lead_events: the timeline ----------------------------------------------

create table if not exists public.lead_events (
  id          bigint generated always as identity primary key,
  lead_id     uuid references public.leads (id) on delete cascade,
  contract_id uuid references public.contracts (id) on delete set null,
  type        text not null check (char_length(type) <= 40),
  detail      text check (detail is null or char_length(detail) <= 1000),
  created_at  timestamptz not null default now()
);

alter table public.lead_events enable row level security;

drop policy if exists "admins read events" on public.lead_events;
create policy "admins read events" on public.lead_events
  for select to authenticated using (public.is_admin());

drop policy if exists "admins add events" on public.lead_events;
create policy "admins add events" on public.lead_events
  for insert to authenticated with check (public.is_admin());

revoke all on table public.lead_events from anon, authenticated;
grant select, insert on table public.lead_events to authenticated;
revoke update, delete, truncate, references, trigger on table public.lead_events from anon, authenticated;

-- 4 · private settings: shared secrets the functions read ---------------------
-- Edge Function env secrets can only be set by hand in the dashboard; this
-- table gives the same result reproducibly. Service role only — RLS on, zero
-- policies, zero grants, exactly like public.admins.

create schema if not exists private;

create table if not exists private.settings (
  key   text primary key,
  value text not null
);

alter table private.settings enable row level security;
revoke all on schema private from anon, authenticated;
revoke all on table private.settings from anon, authenticated;

-- The key Google Ads must echo back in every lead webhook call. Read it later
-- with:  select value from private.settings where key = 'google_lead_webhook_key';
insert into private.settings (key, value)
values ('google_lead_webhook_key', encode(extensions.gen_random_bytes(18), 'hex'))
on conflict (key) do nothing;

-- PostgREST serves only the `public` schema, so the Edge Function cannot read
-- private.settings directly even with the service role. This RPC is the one
-- keyhole: SECURITY DEFINER, service_role only. anon calling it gets a 42501,
-- which the verify block below checks.
create or replace function public.google_lead_webhook_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select value from private.settings where key = 'google_lead_webhook_key';
$$;

revoke all on function public.google_lead_webhook_key() from public, anon, authenticated;
grant execute on function public.google_lead_webhook_key() to service_role;

commit;

-- 5 · verify (paste into the SQL editor) --------------------------------------
--
--    select grantee, privilege_type, column_name
--      from information_schema.column_privileges
--     where table_schema = 'public' and table_name in ('leads','contracts')
--       and grantee in ('anon','authenticated')
--     order by table_name, grantee, privilege_type, column_name;
--
-- Expected:
--   leads     · anon          → INSERT on the ten form columns only
--   leads     · authenticated → UPDATE on handled, status, notes only
--   contracts · authenticated → UPDATE on the business columns, never on
--                                token / signature / signed_at / signer_*
--
-- And with the anon key, both must fail or return nothing — never a row:
--    curl "$SUPABASE_URL/rest/v1/contracts?select=id" -H "apikey: $ANON_KEY"
--    curl "$SUPABASE_URL/rest/v1/lead_events?select=id" -H "apikey: $ANON_KEY"

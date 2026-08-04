-- Amora Studio — lead capture table.
-- Run once in the Supabase SQL editor.
--
-- The site posts straight to Supabase's REST API from the browser using the
-- anon key. That key is public by design; RLS is what makes it safe. The
-- policy below allows INSERT and nothing else, so a visitor can leave a lead
-- but cannot read anyone else's.

create table if not exists public.leads (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null,
  phone       text not null,
  email       text,
  event_date  date,
  date_tbd    boolean not null default false,
  event_type  text,
  area        text,
  coverage    text,
  message     text,
  source      text default 'website',
  handled     boolean not null default false
);

-- Added after the table was already live, so these run as no-ops on a fresh
-- create and as the migration on an existing one.
--
-- email      — optional. The studio's working channel is the phone and
--              WhatsApp, so requiring an address would cost submissions for a
--              field most couples will fill in anyway. But without it there is
--              no way to send a quote, a sample gallery or a contract, and
--              until now the site collected no address anywhere.
-- date_tbd   — the form has always had a "עוד לא קבענו תאריך" checkbox and has
--              always thrown the answer away, sending event_date: null. A blank
--              date and a couple who has not booked a venue yet then look
--              identical, and they are not: the second one is earlier in the
--              funnel and more winnable.
alter table public.leads add column if not exists email    text;
alter table public.leads add column if not exists date_tbd boolean not null default false;

alter table public.leads enable row level security;

-- Anyone may submit. Nobody may read without a service role key.
drop policy if exists "anon can insert leads" on public.leads;
create policy "anon can insert leads"
  on public.leads for insert
  to anon
  with check (true);

-- The policy alone is not enough. RLS decides which ROWS a role may touch, but
-- Postgres still checks the table privilege first, and anon does not get one by
-- default. Without this grant every submission from the browser fails with
-- "permission denied for table leads" — the policy above is never consulted.
-- INSERT only, so the same key still cannot read a single lead back.
grant usage on schema public to anon;
-- Superseded by the column-scoped grant in docs/supabase-crm.sql, which is what
-- production runs and what should be run. Left here because this file is the
-- original bootstrap and this is the line that makes the difference between a
-- working form and a silent one — but a table-level grant would also let the
-- form's identity write `handled`, `id` and `created_at`. Use the crm.sql
-- version, and see docs/verify-lead-insert.sql for the probe that proves the
-- live grant covers every column the form posts.
grant insert on table public.leads to anon;

-- Basic abuse guard: reject obviously empty submissions at the database level,
-- so a bot that skips the client-side validation still gets nothing in.
alter table public.leads
  drop constraint if exists leads_name_len,
  add constraint leads_name_len check (char_length(trim(name)) between 2 and 120);
alter table public.leads
  drop constraint if exists leads_phone_len,
  add constraint leads_phone_len check (char_length(trim(phone)) between 9 and 20);

-- Optional, so null passes. When it is filled it has to look like an address:
-- a typo'd one is worse than none, because the studio then believes it has a
-- way to reach the couple and it silently does not.
alter table public.leads
  drop constraint if exists leads_email_shape,
  add constraint leads_email_shape check (
    email is null or (char_length(email) between 6 and 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  );

-- source is written by the browser, so it is attacker-controlled like every
-- other field. Cap it; it is a channel label, not a free-text field.
alter table public.leads
  drop constraint if exists leads_source_len,
  add constraint leads_source_len check (source is null or char_length(source) <= 200);

create index if not exists leads_created_at_idx on public.leads (created_at desc);

-- Read your leads in the private CRM at /admin.html, or in the Supabase
-- dashboard (Table Editor → leads).
--
-- An INSERT here also fires the lead-alert webhook, which emails the studio
-- immediately — see docs/lead-alerts.md. That is not decoration: the site
-- promises "נחזור אליכם היום" in six places, and without the webhook nothing
-- tells anyone a lead has arrived.
--
-- The webhook is a trigger on this table, created by
-- docs/supabase-lead-alert-webhook.sql. Writing the Edge Function is not the
-- same as deploying it: this project ran for weeks with the function committed
-- to the repo, no trigger on this table, and every enquiry landing unannounced.
-- Verify, do not assume — the query that proves it is at the bottom of that file.

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
  event_date  date,
  event_type  text,
  area        text,
  coverage    text,
  message     text,
  source      text default 'website',
  handled     boolean not null default false
);

alter table public.leads enable row level security;

-- Anyone may submit. Nobody may read without a service role key.
drop policy if exists "anon can insert leads" on public.leads;
create policy "anon can insert leads"
  on public.leads for insert
  to anon
  with check (true);

-- Basic abuse guard: reject obviously empty submissions at the database level,
-- so a bot that skips the client-side validation still gets nothing in.
alter table public.leads
  drop constraint if exists leads_name_len,
  add constraint leads_name_len check (char_length(trim(name)) between 2 and 120);
alter table public.leads
  drop constraint if exists leads_phone_len,
  add constraint leads_phone_len check (char_length(trim(phone)) between 9 and 20);

create index if not exists leads_created_at_idx on public.leads (created_at desc);

-- Read your leads in the Supabase dashboard (Table Editor → leads), or wire an
-- email notification with a Database Webhook on INSERT.

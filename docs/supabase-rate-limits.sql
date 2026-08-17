-- Rate-limit meters for the two anonymous-facing edge paths.
--
-- Both `translate` and `lead-alert` are reachable by anyone (verify_jwt off) and
-- both spend real money downstream — a paid model call, and a Resend email. A
-- single GLOBAL per-minute counter caps that spend no matter how an attacker
-- spoofs IPs or drives the endpoint from many browsers. The edge functions call
-- these RPCs with the SERVICE ROLE and treat any failure as "allowed"
-- (fail-open): the meter is a cost brake, never a gate that can take the site
-- down. Each *_take(n) adds n to the current UTC minute's bucket and returns
-- whether the running total is still within the cap.
--
-- Both meter tables have RLS on with no policy and no grant to anon/authenticated
-- — the intended deny-all posture (they show up as rls_enabled_no_policy INFO in
-- the advisor, same as private.settings and public.admins). Only service_role,
-- which bypasses RLS, ever touches them, and only through the two functions.

-- ---- translate: cap fresh model items per minute -------------------------
create table if not exists public.translate_meter (
  window_start timestamptz primary key,
  items        integer not null default 0
);
alter table public.translate_meter enable row level security;
revoke all on table public.translate_meter from anon, authenticated;

create or replace function public.translate_take(n integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  w   timestamptz := date_trunc('minute', now());
  cur integer;
begin
  insert into public.translate_meter (window_start, items)
       values (w, greatest(n, 0))
  on conflict (window_start)
       do update set items = public.translate_meter.items + greatest(n, 0)
    returning items into cur;
  -- Opportunistic cleanup so the table never grows without bound.
  delete from public.translate_meter where window_start < now() - interval '1 hour';
  return cur <= 600;   -- ceiling: 600 fresh items / minute, globally
end;
$$;
revoke all on function public.translate_take(integer) from public, anon, authenticated;
grant execute on function public.translate_take(integer) to service_role;

-- ---- lead-alert: cap alert emails per minute -----------------------------
create table if not exists public.lead_alert_meter (
  window_start timestamptz primary key,
  items        integer not null default 0
);
alter table public.lead_alert_meter enable row level security;
revoke all on table public.lead_alert_meter from anon, authenticated;

create or replace function public.lead_alert_take(n integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  w   timestamptz := date_trunc('minute', now());
  cur integer;
begin
  insert into public.lead_alert_meter (window_start, items)
       values (w, greatest(n, 0))
  on conflict (window_start)
       do update set items = public.lead_alert_meter.items + greatest(n, 0)
    returning items into cur;
  delete from public.lead_alert_meter where window_start < now() - interval '1 hour';
  return cur <= 20;    -- ceiling: 20 alert emails / minute, globally
end;
$$;
revoke all on function public.lead_alert_take(integer) from public, anon, authenticated;
grant execute on function public.lead_alert_take(integer) to service_role;

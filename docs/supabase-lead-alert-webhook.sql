-- Amora Studio — tell the studio a lead has arrived.
--
-- This is the piece that was missing. The lead-alert Edge Function was written,
-- reviewed and committed months before anything called it: public.leads had no
-- trigger at all, so every enquiry landed in the table and nobody was told,
-- while the submit button on the site promised "נחזור אליכם היום".
--
-- Writing a function is not deploying it. The query at the bottom of this file
-- is how you check, and it is worth running after any change to this project.
--
-- Prerequisite: deploy the function first, with JWT verification OFF —
--
--     supabase functions deploy lead-alert --no-verify-jwt \
--       --project-ref dkejuaildigikufrdiru
--
-- It authenticates itself with the shared secret below instead, which is why
-- the secret is not optional here: without JWT verification the function URL is
-- the only thing standing between a stranger and the studio's inbox.

-- Supabase's dashboard enables this the first time you create a webhook there.
-- Doing it in SQL, the extension has to be asked for by name.
create extension if not exists pg_net;

-- Not in public: everything in public is reachable through PostgREST, and this
-- schema holds a shared secret.
create schema if not exists private;
revoke all on schema private from anon, authenticated;

create or replace function private.notify_lead_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform net.http_post(
    url := 'https://dkejuaildigikufrdiru.supabase.co/functions/v1/lead-alert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- Replace with the value you set as the LEAD_ALERT_SECRET Edge Function
      -- secret. The two must match exactly or the function answers 403 and no
      -- alert is ever sent.
      'x-lead-alert-secret', 'REPLACE_WITH_LEAD_ALERT_SECRET'
    ),
    -- Shaped like the Database Webhook payload the function already parses, so
    -- the function needs no branch for where it was called from.
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'leads',
      'schema', 'public',
      'record', to_jsonb(new),
      'old_record', null
    ),
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;

revoke all on function private.notify_lead_alert() from public, anon, authenticated;

drop trigger if exists on_lead_insert_alert on public.leads;

-- AFTER, so a failed dispatch can never roll back the lead itself. The row is
-- the thing that must survive; the alert is best-effort on top of it. pg_net
-- sends asynchronously, so the visitor's request is not waiting on Resend
-- either.
create trigger on_lead_insert_alert
  after insert on public.leads
  for each row
  execute function private.notify_lead_alert();


-- ---------------------------------------------------------------------------
-- Proving it works, and what "working" does not include
-- ---------------------------------------------------------------------------
--
-- Submit the real form on the live site with your own phone number, then:
--
--   select id, status_code, left(content, 200) as body, created
--   from net._http_response order by created desc limit 5;
--
-- 200 means the alert was sent. 500 "alert not configured" means the function
-- is reachable and the secret matched, but RESEND_API_KEY or LEAD_ALERT_TO is
-- not set on the function — see docs/lead-alerts.md. 403 means the secret above
-- and the LEAD_ALERT_SECRET on the function disagree.
--
-- And to prove the trigger is attached at all — the check that would have
-- caught the original bug, and which returned nothing for months:
--
--   select tgname, pg_get_triggerdef(t.oid)
--   from pg_trigger t join pg_class c on c.oid = t.tgrelid
--   where c.relname = 'leads' and not t.tgisinternal;
--
-- **There is no retry.** pg_net fires once. A provider outage at the wrong
-- moment means that one alert is lost — the lead itself is not, it is in the
-- table and in admin.html, but nobody is pinged about it. Closing that gap
-- needs an `alerted_at` column plus a pg_cron job that re-fires anything
-- unacknowledged; it is not built, and this comment exists so nobody assumes
-- otherwise from reading the function's own hopeful wording.

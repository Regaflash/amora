-- Meta CAPI — the shared secret the endpoint authenticates with.
--
-- Applied to dkejuaildigikufrdiru on 2026-08-05 as migration
-- `meta_capi_hook_secret`. Kept here because docs/ is the readable record of
-- what the database looks like; the database itself is the authority.
--
-- Two credentials, two homes, on purpose:
--   META_CAPI_TOKEN   a Meta platform credential with real reach -> Supabase
--                     Secrets. Never in Postgres, never in a Make blueprint.
--   this hook secret  a low-privilege shared value that Make must also hold.
--                     It can cause a lead-status event to be posted for one
--                     dataset and nothing else -- it reads nothing and spends
--                     nothing. Living in the database means it is generated
--                     here, never passes through a chat window, and rotates
--                     with one UPDATE instead of a dashboard visit and a
--                     redeploy.
--
-- private is not an exposed schema, so an edge function cannot read the table
-- over REST. A SECURITY DEFINER function in public is the supported way
-- through, and EXECUTE goes to service_role alone. This mirrors
-- public.google_lead_webhook_key() rather than inventing a second pattern.

insert into private.settings (key, value)
values (
  'meta_capi_hook_secret',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
on conflict (key) do nothing;

create or replace function public.meta_capi_hook_secret()
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select value from private.settings where key = 'meta_capi_hook_secret';
$$;

revoke all on function public.meta_capi_hook_secret() from public, anon, authenticated;
grant execute on function public.meta_capi_hook_secret() to service_role;


-- Rotation. Take the new value to the Make HTTP module in the same sitting --
-- the endpoint caches per instance, so the old value keeps working for a few
-- minutes and then stops.
--
--   update private.settings
--      set value = replace(gen_random_uuid()::text, '-', '')
--                  || replace(gen_random_uuid()::text, '-', '')
--    where key = 'meta_capi_hook_secret';


-- Verification. Run as a non-privileged role to prove the secret is not
-- reachable from the client keys:
--
--   set local role anon;
--   select public.meta_capi_hook_secret();   -- must raise permission denied
--   reset role;
--
-- A check run as postgres proves nothing here. That mistake shipped a broken
-- column grant in this project once already -- see the note at the bottom of
-- docs/supabase-crm.sql.


-- ---------------------------------------------------------------------------
-- Lead alert destination. Applied 2026-08-05 as `lead_alert_to_in_settings`.
--
-- Same pattern, different reason. This is not a secret at all -- it is an
-- email address -- but it lives here because a Supabase Secret can only be
-- changed from the dashboard, and the lead-alert pipeline spent a day silently
-- failing on exactly one wrong value that nobody could fix from code.
--
--   insert into private.settings (key, value)
--   values ('lead_alert_to', 'support@amora-studios.com')
--   on conflict (key) do update set value = excluded.value;
--
--   create or replace function public.lead_alert_to()
--   returns text language sql stable security definer set search_path to ''
--   as $$ select value from private.settings where key = 'lead_alert_to'; $$;
--
--   revoke all on function public.lead_alert_to() from public, anon, authenticated;
--   grant execute on function public.lead_alert_to() to service_role;
--
-- To redirect lead alerts, one statement -- no dashboard, no redeploy:
--
--   update private.settings set value = 'someone@example.com'
--    where key = 'lead_alert_to';
--
-- The function reports which source it used as `to_source` on every response,
-- so the env fallback can never quietly win.


-- ---------------------------------------------------------------------------
-- Lead alert sender. Applied 2026-08-05 as `lead_alert_from_in_settings`,
-- after amora-studios.com was verified in Resend at 18:14.
--
-- Until verification the sender was Resend's shared onboarding@resend.dev,
-- which may deliver ONLY to the Resend account owner -- the restriction that
-- broke alerts earlier the same day. A verified domain lifts it.
--
--   insert into private.settings (key, value)
--   values ('lead_alert_from', 'Amora Studio <leads@amora-studios.com>')
--   on conflict (key) do update set value = excluded.value;
--
--   create or replace function public.lead_alert_from()
--   returns text language sql stable security definer set search_path to ''
--   as $$ select value from private.settings where key = 'lead_alert_from'; $$;
--
--   revoke all on function public.lead_alert_from() from public, anon, authenticated;
--   grant execute on function public.lead_alert_from() to service_role;
--
-- The address needs no mailbox behind it: lead-alert sets reply_to to the
-- first destination, so replies land somewhere real.
--
-- Lead alert SHARED SECRET. Applied 2026-08-17 as `lead_alert_secret_in_settings`.
-- The trigger (docs/supabase-lead-alert-webhook.sql) sends it as the
-- x-lead-alert-secret header; the function now FAILS CLOSED if no secret is
-- configured, so a missing value can no longer silently open an email relay.
-- It was previously only a dashboard env (LEAD_ALERT_SECRET). Moving it into
-- private.settings — beside the destination and sender — means the function can
-- read the expected value itself (no human dashboard step) and it rotates with
-- one UPDATE. The env var stays a fallback. The VALUE is intentionally not in
-- this repo; it was inserted directly with the trigger's existing secret so the
-- change never broke a live alert:
--
--   insert into private.settings (key, value)
--   values ('lead_alert_secret', '<the trigger secret>')
--   on conflict (key) do update set value = excluded.value;
--
--   create or replace function public.lead_alert_secret()
--   returns text language sql stable security definer set search_path to ''
--   as $$ select value from private.settings where key = 'lead_alert_secret'; $$;
--
--   revoke all on function public.lead_alert_secret() from public, anon, authenticated;
--   grant execute on function public.lead_alert_secret() to service_role;
--
-- To rotate: UPDATE this row AND the trigger's header to the same new value.
--
-- lead_alert_to is split on commas, so a second recipient is one statement:
--
--   update private.settings
--      set value = 'support@amora-studios.com, support@regaflash.com'
--    where key = 'lead_alert_to';
--
-- Applied 2026-08-05: both inboxes now receive. Verified with a real row --
-- recipients: 2. The regaflash address is not the Resend account owner, so
-- that send was impossible before the domain was verified; it is the first
-- thing to actually exercise the lifted restriction.

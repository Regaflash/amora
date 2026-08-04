# Lead alerts — being told when a couple enquires

## Status — read this first

| Piece | State |
| --- | --- |
| `lead-alert` Edge Function | **deployed** to `dkejuaildigikufrdiru`, `verify_jwt` off |
| `on_lead_insert_alert` trigger on `public.leads` | **created** |
| `LEAD_ALERT_SECRET` on the function | **set** — 2026-08-04 |
| `RESEND_API_KEY` on the function | **set** — 2026-08-04 |
| `LEAD_ALERT_TO` on the function | **set** — 2026-08-04 |

**Sending, and proved by a real submission rather than by this table.** On
2026-08-04 at 17:20:49 a lead entered `public.leads` from the live form and
53 ms later `net._http_response` recorded `200 {"sent":true}`. The studio
received the email. The full chain — browser → INSERT → trigger → function →
Resend → inbox — is exercised, not inferred.

Do not take the row above as evidence of anything. It is a claim in a markdown
file, and this file has already been wrong twice in exactly that way. The
evidence is the query in step 5.

Prior states worth keeping, because both were invisible from here:

* Until 2026-08-04 the three secrets were unset and the function answered
  `500 alert not configured` — deliberate, because an alert that returns 200
  without sending is worse than none.
* Until 2026-08-04 the form could not insert at all. `anon`'s INSERT is
  column-scoped and three columns the site posts were missing from the grant,
  so every submission failed and `public.leads` was empty. The alert pipeline
  was fine throughout; nothing ever reached it. See `docs/supabase-crm.sql`.

This table exists because the earlier version of this file described the setup
as though it had been done. It had not: the function was in the repo and
nowhere else, `public.leads` had no trigger, and the site spent months promising
same-day replies to enquiries nobody was told about. Writing is not deploying.
Verify with the two queries at the bottom of
`docs/supabase-lead-alert-webhook.sql`.

## The problem this solves

The site promises **"נחזור אליכם היום"** in six places: on the homepage, and
three times in the assistant. Without this, nothing tells anyone a lead has
arrived. The only way to find out is to open `admin.html` and look.

A couple fills in the form at 22:00 on a Saturday. Nobody opens the CRM until
Tuesday. The promise on the page has been broken, and in this market they booked
whoever answered first.

Everything else in this repo is about being found. This is about not losing the
people who already found you.

## What it does

A trigger fires on every `INSERT` into `public.leads` and calls the `lead-alert`
Edge Function, which emails the studio the lead's name, phone, email if given,
date, event type, area, message and the channel they arrived from — with a
one-tap WhatsApp reply button, a `mailto:` button when there is an address, and
a `tel:` link in E.164 so it dials from any SIM.

Nothing here runs in the browser. `supabase/` is in `.vercelignore`, so it never
reaches the CDN, and none of it touches the site's zero-dependency rule.

## Setup — what is left is steps 1 and 3

Steps 2 and 4 are **already done** and are kept here so the wiring is
reproducible, not because anyone needs to run them again.

### 1. An email provider — OWNER, NOT DONE

[Resend](https://resend.com) has a free tier and the simplest setup. Sign up,
create an API key.

You can send from `onboarding@resend.dev` immediately for testing. To send from
your own domain, add the DNS records Resend gives you — in the **Vercel**
dashboard, since Vercel holds `amora-studios.com`.

> This is also the moment to create the business email the site still lacks.
> There is no `mailto:` anywhere in the eight pages, and `privacy.html` and
> `accessibility.html` both carry `[להשלים]` where an address belongs.
> `LEAD_ALERT_TO` should be an address somebody reads on their phone, with
> push notifications on. The promise being kept is *same day*.

### 2. Deploy the function — DONE

    supabase functions deploy lead-alert --no-verify-jwt \
      --project-ref dkejuaildigikufrdiru

`--no-verify-jwt` is required: the function authenticates itself with the shared
secret instead, so the trigger does not have to carry a JWT. Deployed and
`ACTIVE`; confirm with `supabase functions list`.

### 3. Set the secrets — OWNER, NOT DONE

Dashboard → **Edge Functions → lead-alert → Secrets**:

| name | value |
| --- | --- |
| `RESEND_API_KEY` | the key from step 1 |
| `LEAD_ALERT_TO` | where alerts should land |
| `LEAD_ALERT_FROM` | optional — defaults to `onboarding@resend.dev` |
| `LEAD_ALERT_SECRET` | **required**, and must equal the value in the trigger |

`LEAD_ALERT_SECRET` is not optional here. The function runs with JWT
verification off, so the shared secret is the only thing between a stranger who
guesses the URL and the studio's inbox. It has to match the value in
`private.notify_lead_alert()` byte for byte — a mismatch means a silent 403 and
no alert, forever. To read what the trigger is currently sending:

    select prosrc from pg_proc where proname = 'notify_lead_alert';

### 4. The trigger — DONE

Not a dashboard webhook: created in SQL, so it is reviewable and reproducible.
See `docs/supabase-lead-alert-webhook.sql` for the definition, the reasoning,
and the two queries that verify it is attached.

### 5. Prove it works

Submit the real form on the live site with your own phone number. You should
have the email within seconds.

Then check **Edge Functions → lead-alert → Logs**. A successful send logs
`lead-alert: sent`. If the secrets are missing the function returns 500 and logs
which one — deliberately, because an alert that silently returns 200 without
sending is worse than no alert, since nobody ever finds out it is broken.

The database side records every attempt, which is the faster check:

    select id, status_code, left(content, 200) as body, created
    from net._http_response order by created desc limit 5;

As of this change that query returns exactly one row —
`500 alert not configured` — from a test insert. That is the whole chain
working: trigger fired, secret accepted, function reached, and it correctly
refused to pretend it had sent anything. Setting the secrets in step 3 turns
that into a 200.

## Design notes, if you or someone else changes this later

**Failures return non-2xx on purpose**, so the failure is visible in
`net._http_response` and in the function logs rather than swallowed. Be clear
about what that does *not* buy: **there is no retry.** pg_net fires once. A
provider outage at the wrong moment loses that one alert — never the lead
itself, which is already committed and visible in `admin.html`. Closing the gap
needs an `alerted_at` column and a pg_cron job that re-fires anything
unacknowledged. Not built.

**Lead fields are escaped.** Every value in that email was typed by a stranger —
anyone on the internet can submit the form. It is an email rather than a web
page, so the risk is HTML injection into your inbox rather than XSS, but the
answer is the same. Bidi-override characters are stripped too: they can make a
phone number display as something other than what is stored.

**The phone is normalised to E.164.** `0501234567` becomes `+972501234567`, so
the `tel:` link works abroad and the WhatsApp link resolves. The site's own
`tel:` links were fixed the same way for the same reason.

## Wanting WhatsApp instead of email

Same function, different provider: swap the `fetch` to your WhatsApp Business
API (Twilio, 360dialog, or Meta's Cloud API directly) and keep everything else.
The escaping, the E.164 normalisation and the retry behaviour all still apply.

Worth knowing before you do: WhatsApp Business API requires an approved message
template for business-initiated messages, which is a days-long approval rather
than a fifteen-minute setup. Email first is the pragmatic order.

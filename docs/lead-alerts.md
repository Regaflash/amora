# Lead alerts — being told when a couple enquires

## Status — read this first

| Piece | State |
| --- | --- |
| `lead-alert` Edge Function | **deployed** (v10), `verify_jwt` off |
| `on_lead_insert_alert` trigger on `public.leads` | **created and firing** ✓ |
| `LEAD_ALERT_SECRET` | **set** (04.08) ✓ |
| `RESEND_API_KEY` | **set** (05.08) ✓ |
| `LEAD_ALERT_TO` | **set** (04.08) — but see below |
| **an email actually arriving** | ❌ **no — one field disagrees with another** |

### Tested end to end on 5.8.2026, and it failed

Every box above was ticked, so the honest thing was to insert a real row and
watch. The trigger fired, the function ran, Resend refused:

> `403 validation_error` — *"You can only send testing emails to your own email
> address (**support@amora-studios.com**). To send emails to other recipients,
> please verify a domain at resend.com/domains, and change the `from` address
> to an email using this domain."*

Three facts that are each fine alone and broken together:

- the Resend account belongs to **support@amora-studios.com**
- `LEAD_ALERT_TO` is **support@regaflash.com**
- no domain is verified on the account (`/domains` returns `[]`), so
  `LEAD_ALERT_FROM` falls back to Resend's shared `onboarding@resend.dev`,
  which may only deliver to the account owner

**This is the whole reason the status table now has a last row.** Five green
ticks described the configuration accurately and told us nothing about whether
a single email would arrive. The only check worth anything was sending one.

### Two ways to fix it

**A — one field, works immediately.** Set `LEAD_ALERT_TO` to
`support@amora-studios.com`. It is the Resend account owner, so the shared
sender is allowed to deliver to it, and it is arguably the better destination
anyway: the studio's own address rather than the agency's.

**B — the durable one.** Verify `amora-studios.com` at resend.com/domains, then
set `LEAD_ALERT_FROM` to an address on that domain. After that alerts can go to
any recipient, and they arrive from the studio rather than from a Resend test
sender. **Care with DNS:** `@` already carries Google MX and two
`google-site-verification` TXT records. Resend's records are additive — add,
never edit or replace, or the studio loses its mail.

A is not a workaround to be embarrassed about; it is the correct destination
plus a sender restriction that stops mattering once B is done.

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

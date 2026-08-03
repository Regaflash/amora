# Lead alerts — being told when a couple enquires

## The problem this solves

The site promises **"נחזור אליכם היום"** in six places: on the homepage, and
three times in the assistant. Until this was wired, nothing told anyone a lead
had arrived. The only way to find out was to open `admin.html` and look.

A couple fills in the form at 22:00 on a Saturday. Nobody opens the CRM until
Tuesday. The promise on the page has been broken, and in this market they booked
whoever answered first.

Everything else in this repo is about being found. This is about not losing the
people who already found you.

## What it does

A Supabase **Database Webhook** fires on every `INSERT` into `public.leads` and
calls the `lead-alert` Edge Function, which emails the studio the lead's name,
phone, date, event type, area and message — with a one-tap WhatsApp reply button
and a `tel:` link in E.164, so it dials from any SIM.

Nothing here runs in the browser. `supabase/` is in `.vercelignore`, so it never
reaches the CDN, and none of it touches the site's zero-dependency rule.

## Setup — about fifteen minutes, once

### 1. An email provider

[Resend](https://resend.com) has a free tier and the simplest setup. Sign up,
create an API key.

You can send from `onboarding@resend.dev` immediately for testing. To send from
your own domain, add the DNS records Resend gives you — in the **Vercel**
dashboard, since Vercel holds `amora-studios.com`.

> This is also the moment to create the business email the site still lacks.
> There is no `mailto:` anywhere in the seven pages, and `privacy.html` and
> `accessibility.html` both carry `[להשלים]` where an address belongs.

### 2. Deploy the function

    supabase functions deploy lead-alert --project-ref dkejuaildigikufrdiru

Or paste the contents of `supabase/functions/lead-alert/index.ts` into
**Edge Functions → New function** in the dashboard.

### 3. Set the secrets

Dashboard → **Edge Functions → lead-alert → Secrets**:

| name | value |
| --- | --- |
| `RESEND_API_KEY` | the key from step 1 |
| `LEAD_ALERT_TO` | where alerts should land |
| `LEAD_ALERT_FROM` | optional — defaults to `onboarding@resend.dev` |
| `LEAD_ALERT_SECRET` | optional but recommended — any long random string |

`LEAD_ALERT_SECRET` matters: the function URL is guessable, and without a shared
secret anyone who finds it could make it send you mail. Set it, and add the same
value as a header in step 4.

### 4. The webhook

Dashboard → **Database → Webhooks → Create a new hook**:

- **Table**: `public.leads`
- **Events**: `Insert` only
- **Type**: Supabase Edge Functions → `lead-alert`
- **HTTP Headers**: if you set `LEAD_ALERT_SECRET`, add
  `x-lead-alert-secret` with the same value

### 5. Prove it works

Submit the real form on the live site with your own phone number. You should
have the email within seconds.

Then check **Edge Functions → lead-alert → Logs**. A successful send logs
`lead-alert: sent`. If the secrets are missing the function returns 500 and logs
which one — deliberately, because an alert that silently returns 200 without
sending is worse than no alert, since nobody ever finds out it is broken.

## Design notes, if you or someone else changes this later

**Failures return non-2xx on purpose.** Supabase retries a webhook that fails,
so a transient provider outage delays an alert rather than losing it. Returning
200 on failure would drop the lead silently.

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

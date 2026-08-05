# Lead alerts — being told when a couple enquires

## Status — read this first

| Piece | State |
| --- | --- |
| `lead-alert` Edge Function | **deployed** (v11), `verify_jwt` off |
| `on_lead_insert_alert` trigger on `public.leads` | **firing** ✓ |
| `LEAD_ALERT_SECRET` | **set** — 2026-08-04 |
| `RESEND_API_KEY` | **set** — 2026-08-04, **rotated 2026-08-05** |
| destination (`private.settings.lead_alert_to`) | `support@amora-studios.com` |
| sender (`private.settings.lead_alert_from`) | `Amora Studio <leads@amora-studios.com>` ✓ |
| `amora-studios.com` verified in Resend | **yes — 2026-08-05 18:14** ✓ |
| **an email actually arriving** | **yes — re-verified 5.8.2026** ✓ |

**Sending, and proved by real submissions rather than by this table.** On
2026-08-04 at 17:20:49 a lead entered `public.leads` from the live form and
53 ms later `net._http_response` recorded `200 {"sent":true}`. On 2026-08-05,
after the break described below, a second inserted row recorded
`200 {"sent":true,"to_source":"private.settings"}` and was deleted.

Do not take the rows above as evidence of anything. They are claims in a
markdown file, and this file has already been wrong in exactly that way. The
evidence is the query in step 5.

### The 5.8 break — rotating one key moved a goalpost nobody touched

The owner replaced `RESEND_API_KEY` with a key from the **amora** Resend
account. Every alert immediately began failing:

> `403 validation_error` — *"You can only send testing emails to your own email
> address (**support@amora-studios.com**). To send emails to other recipients,
> please verify a domain at resend.com/domains."*

Nothing was misconfigured. With no verified domain the sender falls back to
Resend's shared `onboarding@resend.dev`, which may only deliver to the **account
owner** — and the new account's owner is `support@amora-studios.com`, while
`LEAD_ALERT_TO` still said `support@regaflash.com`. The old key belonged to an
account whose owner *was* regaflash, so the same settings had worked the day
before.

**A working pipeline broke because of a change made somewhere else entirely,
and every status field still read "set".**

**Consequence worth stating plainly: lead alerts now arrive at
`support@amora-studios.com`, not `support@regaflash.com`.** That is a change of
who gets told a couple enquired.

### Why the destination moved into the database

The fix was one value — and a Supabase Secret can only be changed from the
dashboard, which means a person has to do it, which is exactly how one wrong
value sat there while five status fields said "configured".

A destination address is configuration, not a credential. It now lives in
`private.settings`, read through `public.lead_alert_to()` (`SECURITY DEFINER`,
EXECUTE to `service_role` only), mirroring `meta_capi_hook_secret`.

```sql
-- redirect lead alerts: no dashboard, no redeploy
update private.settings set value = 'someone@example.com' where key = 'lead_alert_to';
```

Precedence is explicit and **the function reports which source it used**
(`to_source`) on every response. The bug was two settings disagreeing with
nothing to say which won; the fix must not reproduce that shape. The row wins;
`LEAD_ALERT_TO` remains a fallback.

### Verifying the domain in Resend — the account trap and the MX trap

Two things went wrong or nearly went wrong on 2026-08-05, both worth keeping.

**The account trap.** Resend's free plan allows **one** domain. The regaflash
account already has `regaflash.com` verified, so `Add domain` there returns
*"Upgrade to add new domains — Pro $20/mo"*. That is not a reason to upgrade:
`amora-studios.com` belongs in the **amora** account, which has no domain and
therefore no plan limit. If a paywall appears, the account is wrong, not the
plan.

**The MX trap — it is real, and it is one toggle away.** A domain in Resend has
an *Enable Receiving* switch. Turning it on demands an `MX` record **on `@`**
(`inbound-smtp.eu-west-1.amazonaws.com`). The apex already carries Google
Workspace `MX`. Adding a second apex MX at equal or better priority silently
diverts the studio's mail; replacing it loses mail outright.

**Receiving is not needed for verification or for sending. Leave it off.**
The `MX` that *is* required sits on the `send` subdomain, not the apex.

The three records that matter, all additive, none touching `@`:

| # | Type | Name | Purpose |
| --- | --- | --- | --- |
| 1 | TXT | `resend._domainkey` | DKIM public key |
| 2 | MX | `send` (priority 10) | bounce/complaint feedback |
| 3 | TXT | `send` | SPF for the sending subdomain |

Because 2 and 3 live on `send`, the apex SPF and the Google `MX` are untouched.

**Copy the DKIM value with the Copy button — never retype or reconstruct it.**
One wrong character fails verification without saying why.

**Check each record after saving.** Some panels append the domain to whatever
you type, turning `resend._domainkey` into
`resend._domainkey.amora-studios.com.amora-studios.com`. Read it back.

### DMARC — deliberately not added

Resend also offers an optional `_dmarc` TXT record (`v=DMARC1; p=none;`). It
was declined on 2026-08-05, for reasons that outlive this setup:

- **`_dmarc` must be a single record.** A domain with two is treated as having
  *no* policy — strictly worse than not adding one. Whether `_dmarc` already
  exists here has never been established: the DNS inventory captured record
  types and names only, and this environment cannot query TXT records.
- **DMARC governs the whole domain's mail**, including the studio's Google
  Workspace inbox. That is a decision about the business's email reputation,
  not a step in configuring a sending provider.
- **`p=none` with no `rua=mailto:` produces no reports and enforces nothing.**
  It is a placeholder, and there is no hurry to place it.

If it is wanted later, the first step is to *read* `_dmarc` and confirm nothing
is there — not to add one.

### ✓ Domain verified — 2026-08-05 18:14

`amora-studios.com` is verified in the **amora** Resend account, region Ireland
(eu-west-1). Three records were added at Hostinger, all as new rows, none
touching the apex:

| Type | Name | Purpose |
| --- | --- | --- |
| TXT | `resend._domainkey` | DKIM |
| MX | `send` (priority 10) | bounce/complaint feedback |
| TXT | `send` | SPF for the sending subdomain |

The five pre-existing records were confirmed untouched afterwards: the `www`
CNAME to vercel-dns, both `google-site-verification` TXT records, the Google
`MX` on `@` at priority 1, and the `A` record. The name-doubling failure the
command warned about did not occur, and it was checked by reading the saved
table rather than by trusting what was typed.

**Two limits lifted at once.** Alerts can now go to any recipient, not only the
Resend account owner, and they are sent from the studio rather than from a
shared test address.

`lead_alert_from` therefore joins `lead_alert_to` in `private.settings`, behind
`public.lead_alert_from()` on the same grant. Re-verified end to end with a
real row: `200 {"sent":true,"to_source":"private.settings",
"from_source":"private.settings","recipients":1}`. Test row deleted.

**The destination now accepts a list.** `lead_alert_to` is split on commas, so
adding a second inbox is an UPDATE rather than a code change — for example
putting alerts back in front of regaflash as well as amora:

```sql
update private.settings
   set value = 'support@amora-studios.com, support@regaflash.com'
 where key = 'lead_alert_to';
```

That capability did not exist before today: with the shared sender, a second
recipient was *impossible*, not merely unconfigured.

### Delivery baseline — read out of Resend and the inbox, 2026-08-05 evening

Confirmed from the receiving end, which is the only place that settles it. A
`200` from Resend means *"I accepted the message"*, not *"it reached a human"*.

| Local time | Sender | Result |
| --- | --- | --- |
| 18:35 | `leads@amora-studios.com` (verified domain) | Delivered → **Inbox** |
| 17:30 | `onboarding@resend.dev` (shared) | Delivered → Inbox, opened |
| 16:53 | Resend's own "Hello World" | Delivered, opened |

**Three delivered, zero bounced, zero complaints, and the spam folder is
entirely empty** — not just free of these messages, empty of everything.

Resend's request log shows `POST /emails` → four `403`s clustered about two
hours earlier, then `200`s. That cluster is the fingerprint of the bug and its
fix: the 403s are the attempts made while `lead_alert_to` still pointed at
regaflash, and they stop at the moment the destination moved.

**A prediction of mine was wrong here, and the correction matters.** I expected
the pre-verification sends to have failed. They did not. Once the destination
became `support@amora-studios.com`, that address *was* the Resend account
owner, so the shared `onboarding@resend.dev` sender was permitted to reach it.
Verifying the domain did not rescue a broken send — it removed a constraint
that had already been worked around by pointing at the owner's own inbox. What
verification actually buys is **any recipient**, not this one.

### Still unverified: the authentication headers

Whether Gmail recorded `SPF=PASS`, `DKIM=PASS` and a DMARC result was **not**
established. Reading it needs Gmail's "show original" view, which was not
reachable during the check, and no one guessed at what it said.

"Landed in the inbox" is weaker evidence than a PASS line, and it is the
evidence we have. Given the domain has no apex SPF record at all, this is worth
closing properly the next time someone is in that mailbox: open any alert →
**Show original** → read the `SPF`, `DKIM` and `DMARC` lines at the top.

### Noticed while verifying, deliberately not acted on

The domain has **no SPF record on the apex at all** — no `v=spf1` on `@` —
even though its `MX` points at Google. The SPF added today lives on `send` and
does not touch this.

It is recorded rather than fixed for the same reason `_dmarc` was declined:
apex SPF governs **all** mail for the domain, including the studio's Google
Workspace inbox, and a wrong or incomplete record there causes legitimate mail
to be marked as spam. That is a decision about the business's email, not a step
in configuring a sending provider. If it is taken up, the first move is to read
what Google Workspace expects, not to write a record.

### ~~Still worth doing — verify the domain in Resend~~ — done, see above

Today alerts can only reach the Resend account owner. Verifying
`amora-studios.com` and setting `LEAD_ALERT_FROM` lifts that: any recipient,
sent from the studio. **DNS caution:** `@` already carries Google Workspace MX
and two `google-site-verification` TXT records. Resend's records are
**additive** — add, never edit or replace, or the studio loses its mail.

Prior states worth keeping, because both were invisible from here:

* Until 2026-08-04 the three secrets were unset and the function answered
  `500 alert not configured` — deliberate, because an alert that returns 200
  without sending is worse than none.
* Until 2026-08-04 the form could not insert at all. `anon`'s INSERT is
  column-scoped and three columns the site posts were missing from the grant,
  so every submission failed and `public.leads` was empty. The alert pipeline
  was fine throughout; nothing ever reached it. See `docs/supabase-crm.sql`.

### It failed first, and the failure is the useful part

With every secret set, the first end-to-end test returned **403** from Resend:

> *"You can only send testing emails to your own email address
> (**support@amora-studios.com**). To send emails to other recipients, please
> verify a domain at resend.com/domains, and change the `from` address to an
> email using this domain."*

Three settings, each correct alone, that disagreed with each other: the Resend
account belongs to amora, `LEAD_ALERT_TO` held `support@regaflash.com`, and no
domain is verified — so the sender falls back to the shared
`onboarding@resend.dev`, which may only deliver to the account owner.

**Five green ticks described the configuration accurately and told us nothing
about whether one email would arrive.** The only check worth anything was
sending one.

### Why the destination moved into the database

Fixing it meant changing one value — and a Supabase Secret can only be changed
in the dashboard, which means a person has to do it, which is exactly how the
wrong value sat there unnoticed for a day.

A destination address is configuration, not a credential. It now lives in
`private.settings`, read through `public.lead_alert_to()`
(`SECURITY DEFINER`, EXECUTE to `service_role` only), mirroring
`meta_capi_hook_secret` rather than inventing a second pattern.

```sql
-- change where lead alerts go
update private.settings set value = 'someone@example.com' where key = 'lead_alert_to';
```

Precedence is explicit and **the function reports which source it used** in
every response (`to_source`). The bug being fixed was two settings disagreeing
with nothing to say which one won; the fix should not reproduce that shape.
The database row wins; `LEAD_ALERT_TO` remains as a fallback if the row is
deleted.

### Still worth doing — verify the domain in Resend

Today alerts can only reach `support@amora-studios.com`, because that is the
Resend account owner and the sender is Resend's shared test address. Verifying
`amora-studios.com` at resend.com/domains and setting `LEAD_ALERT_FROM` to an
address on it lifts both limits: alerts to any recipient, sent from the studio.

**Care with DNS:** `@` already carries Google MX and two
`google-site-verification` TXT records. Resend's records are **additive** —
add, never edit or replace, or the studio loses its mail.

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

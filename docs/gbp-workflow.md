# Google Business Profile — the workflow

`docs/seo-workflow.md` names this as Phase 1 and as the single biggest lever
available to the studio. This is that phase, broken into steps.

Nothing here is a code change. No file in this repo produces a Business
Profile, which is exactly why it has stayed outstanding while everything
around it was finished.

## Status — read this first

| Piece | State |
| --- | --- |
| Google Business Profile | **absent** |
| Google Search Console | verified 2026-08-04, so the effect will be measurable |
| `areaServed` — Country + six districts | already in the Organization block |
| Declared off-site footprint | one Instagram link, and nothing else |

## Why this outranks every on-site change

For a query like `צלם חתונות בחיפה`, Google renders the **local pack** — a
map with three businesses — above the organic results. A studio with no
profile is not eligible for that block at any rank. It competes for what is
left underneath.

No amount of markup changes this. `areaServed` tells Google the studio works
nationally; it does not make the studio a candidate for the map.

There is a second reason, and it is arguably larger. The site currently
carries three testimonials that **cannot be attributed** without written
permission, which is why the portraits were removed. A Google review is
attributed by the reviewer, publicly, with their own name and photograph.
The profile does not just win the map — it is the only route the studio has
to social proof it is allowed to display.

## Before you start — two traps

**Use an account the business will still control in five years.** The domain
has Google Workspace behind it (`MX` points at `SMTP.GOOGLE.COM`), so a
Workspace account is the right owner. A profile created on a personal Gmail
belonging to whoever happened to set it up is a standing liability — recovery
requires a Google support process. Add a second owner immediately after
creation.

**Check for an existing listing first.** Search `Amora Studio` on Google Maps
before creating anything. Businesses are often listed by third parties or by
customer submissions without the owner knowing. If a listing exists, **claim
it — do not create a second one**. Duplicates split reviews and rankings, and
merging them afterwards is a support case.

## Phase 1 — create it as a Service Area Business

At https://business.google.com.

The studio travels to clients and has no premises a client visits. That is a
**Service Area Business**, and Google supports it directly:

- When asked whether you want to add a location customers can visit —
  **answer no**.
- Do not enter a home address as a visitable location. It publishes
  publicly and it is the wrong claim.

This is the same reasoning that keeps `LocalBusiness` out of the site's
JSON-LD. The site and the profile should assert the same thing.

## Phase 2 — the primary category

The single highest-leverage field in the entire profile, and the easiest to
get wrong. The primary category does more for local-pack ranking than any
other setting.

Choose **Wedding photographer** (`צלם חתונות`), not the broader
**Photographer**. The broad category competes against every photographer in
the country for queries the studio does not want; the specific one matches
the queries it does.

Add secondary categories only for services actually offered — videography if
video is genuinely a service, which it is. Do not add categories
speculatively; each one is a claim.

## Phase 3 — service areas

Mirror what `areaServed` already claims, so the profile and the structured
data agree:

```
מחוז תל אביב · מחוז המרכז · מחוז ירושלים
מחוז חיפה · מחוז הצפון · מחוז הדרום
```

Google caps service areas at 20. Six districts is well within it and is
better than twenty individual towns — districts read as honest national
coverage, while a long town list reads as an attempt to game the radius and
does not help ranking.

## Phase 4 — verification

Usually video verification for a service area business. It is a live
recording, not an upload, and it typically asks for three things: evidence of
the equipment and workspace, evidence that you are at the business, and
evidence that you manage it.

Have ready before starting: camera equipment visible, business documentation,
and something tying you to the business name. A failed attempt can be
retried, but each round costs days.

## Phase 5 — fill it, matching the site exactly

Name, phone and site must be byte-identical to what the site already
publishes. Inconsistent NAP data across the web is a known local-ranking
drag.

| Field | Value — copy exactly |
| --- | --- |
| Name | `Amora Studio` |
| Phone | `+972 50-366-2699` |
| Website | see Phase 6 — tag it |
| Language | Hebrew |

Photos matter more here than anywhere else on the profile, and the studio has
a real library on disk. Use genuine work, not stock. The logo is 150×150 and
will look poor as a profile image — this is the same gap already recorded in
`CLAUDE.md` under outstanding owner items, and it now blocks something
visible.

Do not enter prices. The no-prices brief applies to the profile as much as to
the site; cost questions route to `cost.html`.

## Phase 6 — make the profile measurable

The lead form already records a `source` field capturing the referrer host,
any `utm_*` parameters and the submitting page. That means GBP-driven leads
can be identified — but only if the profile's website link is tagged.

Use, as the profile's website URL:

```
https://www.amora-studios.com/?utm_source=google&utm_medium=organic&utm_campaign=gbp
```

Then every lead arriving from the profile carries that tag into
`public.leads.source`, and the CRM at `admin.html` can separate profile leads
from direct ones. Without the tag they are indistinguishable from any other
Google referral.

This changes nothing about what is collected, so **`privacy.html` does not
need editing** — `source` already enumerates `utm_*` there. Adding a
parameter to a link is not a new data category.

## Phase 7 — reviews, which is the part that never finishes

Everything above is setup, done once. This is the ongoing engine, and it is
the strongest ranking signal the studio can influence.

Ask every couple, once, shortly after delivery — when the album has just
landed and the feeling is fresh. Send the short review link the profile
provides; a link that opens the review box directly converts far better than
"find us on Google".

Reply to every review, including the ordinary ones. Replies are public and
visible to the next couple reading them.

Never buy reviews, never incentivise them, and never post one yourself.
Beyond the policy risk, it contradicts the standard this repo has already
applied twice — the testimonial portraits were removed and an unsupported
couples count was replaced, both because the site should not claim what it
cannot back.

## What to expect, and when

The profile does not rank the day it verifies. Expect movement over weeks,
and let Search Console show it: the geo-modified queries in
**Performance → Queries** are the ones that should change. That comparison is
only possible because Search Console started collecting on 2026-08-04, before
the profile existed — there is a genuine before to compare against.

Do not judge the profile in its first fortnight, and do not start editing
categories weekly because nothing moved in ten days.

## Never

- **Two listings for one studio.** Claim, never duplicate.
- **A visitable address.** It is publicly published and it is not true.
- **A personal Gmail as sole owner.** Use Workspace, and add a second owner.
- **Prices on the profile.** Same brief as the site.
- **Stock photography.** The library on disk is real work.
- **Purchased or incentivised reviews.**

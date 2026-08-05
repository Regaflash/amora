# National SEO — the workflow

The studio works across Israel. This is how that fact turns into traffic,
in the order that actually moves things, with the traps that are specific to
this site written down so they are not rediscovered.

## Status — read this first

| Piece | State |
| --- | --- |
| `areaServed` — Country + all six districts | **done**, in the Organization block on `index.html` |
| "בכל הארץ" in visible copy | **done**, 13 occurrences across the indexable pages |
| `sitemap.xml`, `robots.txt`, `llms.txt` | **done**, generated and guarded by `tools/check.sh` |
| Google Search Console | **verified 2026-08-04**, Domain property, sitemap submitted |
| Google Business Profile | **absent** — this is the gate on every geo query |
| Venue names, dated weddings, attributed testimonials | **absent** — this is the gate on case-study pages |

The declaration of national coverage is finished. Nothing is gained by
declaring it harder. What is missing is evidence and material.

## Where the queries actually live

Three classes, and this site's honest position in each.

**Head terms** — `צלם חתונות`, `צלם וידאו לחתונה`. Dominated by directories
and studios with years of domain history. Not winnable early and not worth
building for. Do not write a page whose purpose is to rank for these.

**Geo-modified** — `צלם חתונות בחיפה`, `צלם חתונות ירושלים`. This is where
national coverage cashes out, and it is won **primarily by the local pack**,
which renders above the organic results and is produced by a Google Business
Profile, not by markup. A site with no GBP competing on geo queries is
competing for the leftovers below the fold.

**Long-tail intent** — `כמה עולה צלם חתונות`, delivery timelines, one
photographer vs two. Winnable now, from facts already published, with no new
owner material. `cost.html` is the proof: it answers a real query with the
variables rather than a number, and every fact on it already appears on the
homepage.

## The rule that governs every new page

Two tests. A page ships only if it passes both.

**The doorway test.** Delete the city name from the page. Is it still worth
publishing? If no, it is a doorway page — the exact pattern Google names in
its spam policies — and it will cost more than it earns. `/weddings/tel-aviv`
and twenty siblings built from one template with the place swapped fail this
test by construction.

**The derivation test.** Every claim on the page must already be published
somewhere on this site, or be supplied by the owner in writing. No invented
counts, no invented venues, no attributed quotes without permission. This is
the same objection that removed the testimonial portraits and replaced
`+500 זוגות מאושרים`; it is not a style preference.

## Phase 1 — Google Business Profile

Owner action, no code, and it outranks everything else on this page.

For a business with no premises a client visits, GBP supports exactly this
case: hide the address and declare **service areas**. Those service areas
should mirror what `areaServed` already claims — the six districts — rather
than a longer list of individual towns, so the site and the profile say the
same thing.

Until this exists, treat every geo-modified query as unavailable. Building
pages for them first is spending effort below the fold.

## Phase 2 — harvest the evidence before building anything

Search Console has been collecting since 2026-08-04. It needs weeks, not
days, before the Queries report means anything.

When there is data, read **Performance → Queries**, filtered to Israel:

- Which geo-modified queries already produce impressions? Those are places
  where the site is being considered and losing — the cheapest wins.
- Which long-tail intents appear that no page answers? Each is a candidate.
- Which pages get impressions with a low click-through? Usually a title or
  meta description problem, which is a one-line fix, not a new page.

This is the step that converts the workflow from guessing to evidence. Before
GSC existed there was no way to do it, which is why the earlier advice was to
build service-area pages on intuition. Do not go back to that.

## Phase 3 — build only what the evidence supports

Candidates come from Phase 2, not from a keyword tool and not from a list of
cities. Each candidate must pass both tests above.

The realistic near-term set is **long-tail informational pages in the
`cost.html` mould** — a real question, answered from already-published facts,
in the landing-page shell rather than the legal-drafts shell so the visitor
can enquire from it. Derive candidates from what is already on the site: the
eight FAQ answers and the `hasOfferCatalog` entries in the Organization
block. Anything that needs a fact not already published belongs to Phase 4.

## Phase 4 — venue and case-study pages

This is the only legitimate route to geography, and it is blocked on owner
material: venue names, dated real weddings, and written confirmation that
testimonials may be attributed.

The unit is a **real wedding at a named place**, not a city. A page about an
actual wedding at an actual venue, with photographs from that wedding, is
genuinely distinct content — it passes the doorway test because deleting the
place name would gut it. It earns the geography as a side effect instead of
asserting it.

One such page backed by real material is worth more than twenty templated
city pages, and unlike them it cannot be penalised.

## Per-page build checklist

The repeatable part. Every trap here has already cost this repo once.

1. **Reuse the homepage markup.** Header, footer, floating WhatsApp button
   and the lead form, copied from `index.html`, so `main.js` needs no
   page-specific branch.
2. **`data-header-solid`** on the body if the page has no hero. Without it
   the header spends its first 80px as ivory text on the sand background.
3. **Nav links are `index.html#…`**, never bare fragments. `check.sh` fails
   any in-page fragment that resolves to nothing.
4. **Root-absolute asset paths.** Relative paths break on `404.html`, which
   Vercel serves *at* the address that was not found.
5. **No tags inside `.faq__a`.** The eight FAQ answers are byte-locked to the
   FAQPage JSON-LD and `check.sh` compares them one-for-one. Links go after
   the `<details>` list, as `.faq__more`.
6. **Add the page to `llms.txt`.**
7. **Rerun `tools/gen-sitemap.py`.** Never hand-edit `sitemap.xml`.
8. **Update `assets/js/assistant.js`** if the page covers something a visitor
   might ask about — including the phrasing they would actually type, not
   only the phrasing the site uses.
9. **If the page adds a lead-form field**: add the column to the `anon` INSERT
   grant *and* to the enumerated list in `privacy.html`. A column-scoped grant
   is all-or-nothing per statement; forgetting it kills every submission
   silently. See the GRANT entry in `CLAUDE.md`.
10. **`tools/check.sh` exits 0 and `node tools/verify.mjs` exits 0**, then
    deploy, then fetch the live URL and look at it.
11. **Submit the new URL in Search Console** — URL Inspection → Request
    Indexing. The sitemap will find it eventually; this is faster.

## Never

- **City pages from one template with the place swapped.** Doorway pattern.
- **Prices.** No number goes on the site, by the owner's brief. Cost queries
  route to `cost.html`, which answers with the variables.
- **`LocalBusiness` or `priceRange`.** `LocalBusiness` is a `Place` subtype
  and asserts premises a client can visit; with no street address it earns a
  Search Console warning instead of a rich result. `priceRange` contradicts
  the brief and has no value to put in it.
- **`acquireLicensePage` on the images.** With `license` it earns the
  "Licensable" badge, which tells a searcher these photographs can be
  licensed. They are other people's weddings.
- **Opening the training crawlers** to chase AI visibility. `terms.html`
  undertakes that this content is not used for model training, and the
  reason given is the people in the photographs. Retrieval crawlers are
  already allowed, and they are the ones that surface the studio in an answer
  today. Changing `robots.txt` here means amending that clause in the same
  change.
- **A performance project.** Measured, not assumed: LCP 148ms mobile with the
  `<h1>` as the LCP element, CLS 0.001. There is nothing to win.

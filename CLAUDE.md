# Amora Studio — project memory

## ⚑ Fresh session? Read this first

The site is **live at https://www.amora-studios.com**, on Vercel, on the
owner's domain. SITE_URL has been replaced everywhere it appears (canonical,
og:url, JSON-LD, sitemap.xml). The lead form is wired to Supabase and the
private CRM at `admin.html` reads it back.

```
Before any change goes out:
1. tools/check.sh          # must exit 0 — 21 checks + a phone-format count
   node tools/verify.mjs   # must exit 0 — 43 runtime checks in a real browser
   # verify.mjs needs playwright-core and pngjs, which this repo deliberately
   # does not vendor and has no package.json for:
   #   npm install --no-save playwright-core pngjs
   # Install both in ONE command — with no package.json, a second --no-save
   # install removes the first package.
2. Deploy this directory to Vercel. vercel.json and .vercelignore are already
   correct — do not add a build step, this is a static site with no
   dependencies.
3. Fetch the live URL and look at it: images load, the hero plays, the gallery
   filters, the form validates, the accessibility menu opens.
```

Do not re-audit or re-verify the build. That work is done and documented below.


## Infrastructure (standing context — do not re-ask)

The owner's accounts are already wired together:

- **GitHub** — `Regaflash/amora` (private). The studio's photo library sits on
  disk at the repo root (86 files, Instagram-style filenames) and `tools/`
  reads it from there — `tools/manifest.json` maps every slot to a filename.
  It is **not tracked**: `.gitignore` holds the patterns, `.vercelignore`
  repeats them, and `tools/check.sh` fails if any of it returns to HEAD.
- **Vercel** — connected to that GitHub account. This is where the site is
  hosted. Deploys should target Vercel. It does **not** hold the domain: this
  entry used to say it did, and it was wrong. Vercel lists
  `amora-studios.com` as "registered with a third party" and exposes no DNS
  tab for it.
- **Hostinger** — the registrar, and where DNS actually lives. Every DNS
  record for `amora-studios.com` is edited there, not in the Vercel
  dashboard: the `A` record pointing at Vercel, the `www` CNAME, the Google
  Workspace `MX`, and both `google-site-verification` TXT records. Anything
  that says "add a DNS record in Vercel" is an instruction that cannot be
  followed.
- **Supabase** — connected to the same GitHub account. Available as the
  backend for the lead form (see `docs/supabase-leads.sql`).

- **Google Search Console** — verified 2026-08-04. The property is a
  **Domain** property (`sc-domain:amora-studios.com`), verified by DNS TXT at
  Hostinger, so it covers apex, `www`, every subdomain and both protocols in
  one record. `sitemap.xml` is submitted and the three indexable URLs have
  been through Request Indexing.

  Two consequences worth knowing before touching it again:

  - **A Domain property has no URL prefix, so the Sitemaps field needs the
    full URL.** Entering `sitemap.xml` — correct for a URL-prefix property —
    is rejected with "Invalid sitemap address". Submit
    `https://www.amora-studios.com/sitemap.xml`.
  - **There are two `google-site-verification` TXT records and only one is
    ours.** `oz_ZtTvod…` is this property. `kyZHK2Va…` predates it and is not
    ours to remove — the domain's `MX` points at `SMTP.GOOGLE.COM`, so it is
    most likely the Google Workspace domain verification, and deleting it
    risks mail. TXT is multi-value: add alongside, never replace.

  `/` reported "Indexed, though blocked by robots.txt" once. It was stale
  crawl data, not a bug — Test Live URL returned `Crawl allowed: Yes`, and
  `urllib.robotparser` confirms Googlebot may fetch `/`, `/cost.html` and
  `/camera-3d.html`. Note that `Google-Extended` is disallowed by design and
  is **not** Googlebot; it governs model training only and has no effect on
  crawling or indexing. Do not "fix" it.

Because the host is Vercel, header rules live in **`vercel.json`**, not in
`_headers` — Vercel does not read Netlify/Cloudflare's `_headers` format. The
`_headers` file is kept only so the site stays portable to those hosts.

### Known access limits from this environment

- The repo **is** reachable from this environment and can be pushed to and
  opened PRs against. This entry used to say the opposite; it was true once and
  is not now, and it was contradicted by a whole session of pushes.
- Outbound network is allowlisted: `github.com` and `registry.npmjs.org` work;
  `youtube.com`, `drive.google.com`, `fonts.googleapis.com`, `unpkg.com` are
  all 403. Anything the site needs must be vendored, not fetched at runtime.
- Chat file attachments **do** land on disk at full resolution — that is a
  working transport for images when a repo is unreachable.

## Product decisions already made

- Zero build step, zero runtime dependencies. Fonts and three.js are vendored.
  Do not introduce a framework or a CDN.
- RTL Hebrew throughout. Physical CSS properties are a recurring bug source.
- No prices anywhere on the site — by the owner's brief. Cost questions route
  to the contact form.
- **Regaflash is the owner's second business, and its product ships with every
  Amora booking.** `regaflash.com` produces photo magnets carrying an AR
  scanner: point a phone at the magnet and the photograph plays as video.
  Owner-confirmed 2026-08-05 as included in *every* deal, not an upsell.

  It appears in five places and they must stay consistent: the trust bar, the
  package FAQ answer (**both copies** — the visible one and the FAQPage
  JSON-LD, which `check.sh` compares byte-for-byte), the `cost.html`
  inclusions list, and `assistant.js` (a `magnets` entry plus the `package`
  answer). The link to `regaflash.com` lives in `.faq__more`, **not** in the
  FAQ answer — a tag inside `.faq__a` breaks the byte-lock, which is the same
  trap that put the `cost.html` link there.

  `regaflash.com` is a different legal entity, so it does **not** belong in
  the Organization block's `sameAs` — that property is for other profiles of
  the *same* entity. It is a plain outbound link, opening in a new tab so the
  visitor keeps the conversion page.

- Testimonial portraits were deliberately removed: they showed real people who
  had not said the quoted words. Do not re-add without written permission.
- The hero streams the studio's real footage from YouTube — `2DHdORDXVmo`
  (showreel, landscape) and `3O13FGO_f08` (vertical Short), chosen by viewport
  orientation. There is no local hero video and no `assets/video/`. This is the
  only third-party request the site makes on load; it was the owner's call,
  `privacy.html` states it, and `frame-src` in `vercel.json` names the two
  origins. The film section further down still asks before it loads.
- There are eight pages, not two: `index.html`, `cost.html`, `camera-3d.html`,
  `accessibility.html`, `privacy.html`, `terms.html`, `404.html` and
  `admin.html` (the private lead CRM — noindex, no-store, its own enforcing
  CSP, absent from both sitemap.xml and robots.txt on purpose). The
  accessibility widget loads on every public page. The site assistant does
  **not** — this entry claimed it did, and it was wrong: `assistant.js` was on
  `index.html` and `cost.html` only. It is now also on `camera-3d.html`, which
  is `index, follow` and one of three entries in `sitemap.xml`. The four
  remaining pages (`accessibility`, `privacy`, `terms`, `404`) are noindex or
  not in the sitemap, and deliberately keep the lighter shell.
  `404.html` is served by Vercel AT the address that was not found, so every
  asset it references must stay root-absolute — a relative href resolves
  against the dead path. That is a real bug that has already happened once.
- **Every public page carries the same shell obligations**, and five of them
  did not until 2026-08-05. `.skip-link` was styled globally in `styles.css`
  from the start but only `index.html` and `cost.html` emitted the markup —
  `accessibility.html` shipped without a skip link, which is the one page
  where the omission is also an argument against itself. All seven now carry
  a skip link, `<main id="main">`, `<link rel="manifest">` and `theme-color`.

  `site.webmanifest` is referenced **root-absolute** for the same reason every
  other `404.html` reference is: Vercel serves that page AT the address that
  was not found, so a relative href resolves against the dead path. Note the
  manifest ships **without a 512px icon** — the source logo is 150×150, so one
  would be upscaled garbage. Chrome's install prompt wants 192 *and* 512, so
  the profile is valid and useful but not installable until a real logo master
  arrives. That is the same outstanding owner item, now blocking something
  visible.

- **The assistant launcher and the accessibility trigger live in the mobile
  header bar**, beside the burger and the availability CTA, and share its
  exact geometry and both of its states — circle over the hero, square once
  `.site-header` gains `.is-scrolled`. `assistant.js` and `a11y-widget.js`
  each move only their BUTTON into `.nav-mobile`; the panels stay on `body`,
  because a fixed modal nested in the header would inherit its stacking
  context. The four legal pages have no `.nav-mobile` and keep the
  free-floating originals, so that fallback is live code, not a leftover.

  **Moving an element out of an ancestor drops the rules scoped to it and the
  custom properties declared on it.** That bit three times in one change:
  the border vanished (`border-width` without `border-style` computes to
  `0px none`), the shape stopped tracking the header, and — the one that
  mattered — `.a11y-fab:focus-visible` kept matching but painted
  `var(--a11y-on-accent)`, a property declared on `.a11y-ui`, so it resolved
  to nothing and **no focus ring was drawn on the accessibility control at
  all**. `verify.mjs` caught that; a screenshot would not have.

  `.brand` carries `flex: 0 0 auto` because of this change: with two more
  44px controls in the bar the logo was measured crushed to 30px at 360px and
  to zero at 320px. Below 360px a media query tightens the row to 40px
  controls — measured, because at 320px the launcher had been sitting at
  `[-38..6]`, entirely off-screen.

- Three files are GENERATED. Do not hand-edit them; rerun the tool and let
  `check.sh` confirm: `sitemap.xml` (`tools/gen-sitemap.py`), the ImageGallery
  JSON-LD block in `index.html` (`tools/gen-image-schema.py`), and the icon set
  (`tools/make-icons.mjs`).

## Standing decisions — asked and answered, do not re-open

- **No framework.** Next.js/React was proposed and declined by the owner. There
  is no `package.json`, no build step and no `node_modules`, deliberately. The
  Next.js-specific advice that circulates for this kind of site — the Metadata
  API, `sitemap.ts`, `robots.ts`, `next/image` with `priority`/`blurDataURL` —
  has nothing to attach to here, and the equivalents already exist: generated
  sitemap and robots, hand-written head tags, `loading="lazy"`,
  `decoding="async"`.
- **Do not start a performance project.** Measured, not assumed: LCP 148ms
  mobile / 160ms desktop with the `<h1>` as the LCP element, CLS 0.001, 570 DOM
  nodes, one `<h1>`, zero skipped heading levels, and 602 words plus all eight
  FAQ answers rendered with JavaScript off. The YouTube hero is not the LCP
  element and is not hurting anything.
- **AI crawler policy: citation yes, training no.** `robots.txt` allows
  OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User and PerplexityBot,
  and declines GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, CCBot,
  Bytespider and meta-externalagent. This is not a preference — `terms.html`
  undertakes that this content is not used for model training, "קודם כול להגן
  על האנשים שבתמונות". Opening the training crawlers means amending that
  clause in the same change; the site must not promise one thing publicly while
  robots.txt does another. `check.sh` asserts 21 agent/path cases. Note that a
  crawler matching a named group ignores the `*` group entirely, which is why
  each allowed group repeats the Disallow lines.
- **No `priceRange`, no `LocalBusiness`.** `priceRange` contradicts the
  no-prices brief and there is no value to put in it. `LocalBusiness` is a
  subtype of `Place` and asserts premises a client can visit; with no street
  address it earns a Search Console warning instead of a rich result.
  `Organization` is deliberate and the comment above the block says why.
- **No `acquireLicensePage` on the images.** With `license` it earns Google's
  "Licensable" badge, which tells a searcher the photograph can be licensed.
  These are other people's weddings and the studio does not sell them.
- **Service-area pages are deferred, not forgotten.** `/weddings/tel-aviv` and
  siblings built from the same facts with the city swapped are the doorway
  pattern Google names in its spam policies. They need genuinely distinct
  material first — see the owner list below.

- **`cost.html` states no price and must not start.** It exists because
  "כמה עולה צלם חתונות" is a real query, and it answers with the variables —
  hours, photographers, locations — not a number. Every fact on it is already
  published on the homepage. Its own `check.sh` guard is indirect: `llms.txt`
  must list it and `sitemap.xml` must be regenerated, and both fail the build
  when they drift.

  It is a **landing page, not an article**: site header, footer, floating
  WhatsApp button and its own copy of the lead form, all reusing the homepage's
  markup so `main.js` needs no page-specific branch. It used to render in the
  legal-drafts shell with one text link out — the highest-intent page on the
  site with no way to enquire from it. Its nav links are `index.html#…`, not
  bare fragments: `check.sh` fails any in-page fragment that resolves to
  nothing. It carries `data-header-solid` because it has no hero, and without
  it the header spends its first 80px as ivory text on the sand background.

- **Adding a form field needs a GRANT, and forgetting it kills the form
  silently.** `anon`'s INSERT on `public.leads` is **column-scoped** in
  production — narrowed by `scope_anon_insert_to_form_columns` (2026-08-02), a
  migration that exists only in the database and has no counterpart in
  `docs/`, which still shows a table-level grant. A column-scoped grant is
  all-or-nothing per statement: naming one ungranted column fails the whole
  INSERT. `email`, `date_tbd` and `source` were added to the table and to the
  site but not to the grant, and **every submission from the live form failed
  for a day** while `public.leads` stayed empty and the RLS policy looked
  perfect. Two traps worth naming: `role_table_grants` does not list
  column-scoped grants, so the table-level view shows `anon` with nothing; and
  a smoke test run as `postgres` ignores column grants entirely, which is how
  this shipped. Test with `set local role anon`, or submit the real form. The
  reconciliation query is at the bottom of `docs/supabase-crm.sql`.
- **The lead form's fields are enumerated in `privacy.html`.** Adding or
  removing one means editing that list in the same change — the page states in
  as many words what is collected and what is not. `email` (optional) and
  `date_tbd` are stored, and `source` records the referrer host, any `utm_*`
  tags and the submitting page. `source` is not analytics and must not become
  it: it is read once, at submit, only for someone already handing over their
  name and phone. Nothing measures a visitor who does not submit, and
  `privacy.html` promises exactly that.
- **The FAQ answers on the homepage are byte-identical to the FAQPage JSON-LD**
  and `tools/check.sh` checks it one-for-one — eight answers, plus a separate
  assertion that no `.faq__a` contains a tag. Do not put a link, or anything
  else, inside a `.faq__a`. That broke the invariant once; the link out to
  `cost.html` lives after the `<details>` list as `.faq__more` for that reason.

  This entry claimed the script existed long before one did. `check.sh` ran 20
  checks and none of them was this; the eight answers were mirrored into
  structured data by hand and guarded by this sentence. They had not drifted
  when the check was finally written, which was luck rather than a mechanism —
  the visible copy and the copy Google is served could have parted in either
  direction and every check would still have passed. Same lesson as the lead
  alerts below: **a guarantee written here is not a guarantee that runs.**
- **Lead alerts: sending — but the destination changed on 5.8, and that is the
  whole lesson.** A trigger on INSERT into `public.leads`
  (`docs/supabase-lead-alert-webhook.sql`) calls the `lead-alert` Edge
  Function, which emails the studio.

  **04.08:** proved by a real submission — a lead entered from the live form
  at 17:20:49 and `net._http_response` recorded `200 {"sent":true}` 53 ms
  later, delivered to `support@regaflash.com`.

  **05.08:** the owner rotated `RESEND_API_KEY` to a key from the **amora**
  Resend account, and every alert began failing `403`. Nothing was
  misconfigured: with no verified domain the sender is Resend's shared
  `onboarding@resend.dev`, which may only deliver to the **account owner** —
  and the new account's owner is `support@amora-studios.com`, not
  `support@regaflash.com`. **Rotating that one key silently moved the goalposts
  for a setting nobody touched.**

  Fixed and re-verified the same way: `200 {"sent":true,"to_source":
  "private.settings"}`. **Alerts now arrive at `support@amora-studios.com`.**
  If they should go somewhere else, it is one statement — the destination moved
  out of Supabase Secrets into `private.settings.lead_alert_to`, read through
  `public.lead_alert_to()` (EXECUTE to `service_role` only), because a Secret
  can only be changed from the dashboard and that is exactly how a single wrong
  value went unnoticed:

  ```sql
  update private.settings set value = '…' where key = 'lead_alert_to';
  ```

  `LEAD_ALERT_TO` survives as a fallback and every response reports
  `to_source`, so the live value is never a guess.

  **`amora-studios.com` was verified in Resend at 18:14 the same day**, which
  lifted both limits: alerts can reach any recipient, and they are sent from
  the studio rather than a shared test address. The sender lives beside the
  destination as `private.settings.lead_alert_from`
  (`Amora Studio <leads@amora-studios.com>`), and **`lead_alert_to` is split on
  commas**, so adding a second inbox — regaflash alongside amora, say — is an
  UPDATE and not a code change. Re-verified with a real row:
  `200 {"sent":true,...,"recipients":1}`.

  Recorded but deliberately untouched: the domain has **no apex SPF record at
  all**, although its MX points at Google. Apex SPF governs every piece of mail
  the domain sends, so a wrong one marks the studio's own Gmail as spam. Same
  reasoning as declining `_dmarc` — read first, and treat it as a decision
  about the business's mail rather than a provider setting.

  Getting there on 04.08 turned up the thing that actually mattered. **The form
  had never inserted a single lead** — `anon`'s column-scoped INSERT grant was
  missing three columns the site posts, so every submission failed while the
  alert pipeline sat downstream of a call it never received. See the GRANT
  entry above.

  This entry has been wrong in both directions before. **Its status is not
  knowable by reading anything; insert a row and look at `net._http_response`.**

  The destination now lives in **`private.settings.lead_alert_to`**
  (`support@amora-studios.com`), not in Supabase Secrets — read via
  `public.lead_alert_to()`, EXECUTE to `service_role` only. Changing it is one
  `update`, no dashboard and no redeploy. `LEAD_ALERT_TO` survives as a
  fallback, and every response reports `to_source` so the live value is never
  a guess.

  It failed first, and that is the part worth remembering: every secret was
  set and Resend still returned 403, because the account belongs to amora
  while `LEAD_ALERT_TO` pointed at regaflash and no domain is verified.
  **Still open:** verify `amora-studios.com` in Resend and set
  `LEAD_ALERT_FROM`, which is what allows alerts to reach any address rather
  than only the account owner. DNS caution and the full account in
  `docs/lead-alerts.md`.

  This entry has been wrong in both directions before — claiming the pipeline
  was live when no trigger existed, then claiming secrets were unset when they
  were set. **Its status is not knowable by reading anything; insert a row and
  look at `net._http_response`.**
- A photo of the team at work — the `about` slot is a stand-in, and the section
  text talks about "the two of us" with no name or face anywhere on the site.
- Legal review of `accessibility.html`, `privacy.html` and `terms.html` (all
  three are drafts with `[להשלים]` markers and a visible banner).
- A logo master of 512px or more. `assets/img/logo.jpg` is 150×150, so the
  180 and 192 icons `tools/make-icons.mjs` produces are upscaled from it.
- **A Google Business Profile.** The single biggest local lever and the one
  thing no code in this repo can produce: the local pack renders above the
  organic results. The site's entire declared off-site footprint is one
  Instagram link.
- ~~Google Search Console~~ — **done, 2026-08-04.** See the Search Console
  entry under Infrastructure above. It is already earning: the image-schema
  finding below arrived as a Search Console email.
- **A business email on the site.** No longer blocking `LEAD_ALERT_TO` — alerts
  arrive, and since 5.8 they arrive at `support@amora-studios.com`, a live
  Google account on the domain. Still absent from the pages themselves: there
  is no `mailto:` anywhere in the eight HTML files, and `privacy.html` and
  `accessibility.html` both carry `[להשלים]` where an address belongs. Those
  two are legal statements that name a contact route by law, so the gap is
  theirs to close, not the homepage's. **Confirm the mailbox is actually read**
  — an alert delivered to an unopened inbox is the same failure as no alert,
  wearing a green tick.
- Venue names, dated real weddings, and written confirmation that the three
  testimonials may be attributed. This is what unblocks service-area and
  case-study pages, and nothing else does.

### The three contradictions — resolved, and one needs the owner's word

All three were aligned to what the site already said elsewhere, rather than to
a new promise. Each carries an HTML/JS comment at the site of the change saying
what it used to say and why it moved.

- **The album.** Process step 04 and `assistant.js` both put the printed album
  inside 30 days, while the FAQ, the FAQPage JSON-LD and `cost.html` put it two
  weeks after the selection is approved. The two outliers were changed, not the
  FAQ: the FAQ answers are byte-locked to the JSON-LD by `check.sh`, and the
  JSON-LD is what Google surfaces.
- **The film length.** The film section was titled "חתונה אחת, שלוש דקות" while
  four other places say 3–5 דקות. Retitled "חתונה אחת, סרט אחד". `assistant.js`
  names the section in its answer and changed with it; "שלוש דקות" stays in its
  keyword list, because that is still what a visitor might type.
- **`+500 זוגות מאושרים`** → **`שני צלמים בחתונה מלאה`**, in the trust bar.
  Nothing in the repo supported the count, and `assistant.js` carries a
  no-counts policy that contradicted it — the same objection that removed the
  testimonial portraits. The replacement is backed by the FAQ and `cost.html`
  and is a sharper differentiator anyway, since most studios sell the second
  shooter as an upgrade. **If the studio can stand behind the number, putting
  it back is one line** — the old text is in the comment above it.

## Before any deploy

```bash
tools/set-site-url.sh https://the-real-domain
tools/check.sh          # must exit 0
```

`check.sh` fails on purpose while `SITE_URL` is still a placeholder.

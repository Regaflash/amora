# Amora Studio — project memory

## ⚑ Fresh session? Read this first

The site is **live at https://www.amora-studios.com**, on Vercel, on the
owner's domain. SITE_URL has been replaced everywhere it appears (canonical,
og:url, JSON-LD, sitemap.xml). The lead form is wired to Supabase and the
private CRM at `admin.html` reads it back.

```
Before any change goes out:
1. tools/check.sh          # must exit 0 — 21 checks + a phone-format count
   node tools/verify.mjs   # must exit 0 — 247 runtime checks in a real browser
   # That second number said 43 while the suite ran 174. Both counts were
   # suspect on 2026-08-09 and both were re-counted against real output: the
   # check.sh number was right and untouched, the verify.mjs one had been
   # wrong since the suite tripled. The count is not decoration — a session
   # that reads 43, watches 174 scroll past and concludes it is running the
   # wrong tool goes looking for a second verifier that does not exist. When
   # you add an ok(), change this line in the same commit.
   # verify.mjs needs playwright-core and pngjs, which this repo deliberately
   # does not vendor and has no package.json for:
   #   npm install --no-save playwright-core pngjs
   # Install both in ONE command — with no package.json, a second --no-save
   # install removes the first package.
   # And playwright-core ships NO browser. verify.mjs launches
   # /opt/pw-browsers/chromium, overridable with CHROMIUM_PATH, and fails at
   # launch if nothing is there. That failure is a missing binary, not a
   # failing assertion: nothing about the site is broken and there is nothing
   # in the repo to fix.
2. Deploy this directory to Vercel. vercel.json and .vercelignore are already
   correct — do not add a build step, this is a static site with no
   dependencies.
3. Fetch the live URL and look at it: images load, the hero plays, the gallery
   filters, a photograph opens full-screen and steps with the arrows, the
   language buttons switch the page, the form validates, the accessibility
   menu opens.
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
- **Chat file attachments do NOT land on disk.** This entry used to claim the
  opposite — "they do land at full resolution, a working transport for images"
  — and on 2026-08-05 that cost a wasted round trip: the owner attached the
  logo master, it was visible in the conversation, and a search of the entire
  filesystem for any recent file turned up nothing. An image can be *seen* and
  still not be *processable*; there is no tool that writes a conversation
  image to a file.
- **To get a binary file into this environment, put it in the repo.** The
  reliable route with no local git is GitHub's web UI: `Add file` →
  `Upload files` → drop it → commit to a branch. `github.com` is allowlisted,
  so it can be pulled from here immediately. Direct download from a CDN does
  not work — `d8j0ntlcm91z4.cloudfront.net` returns 403 through the proxy,
  retested the same day.

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
  orientation. Orientation is only the first choice: a refused autoplay is
  asked again, muted and bounded to three tries, and if the vertical cut never
  plays the hero falls back once to the wide one. Both exist because an iPhone
  in Low Power Mode refuses autoplay and leaves YouTube's poster sitting
  there — a hero that quietly does not move is a design, a hero wearing
  someone else's chrome is a bug. There is no local hero video and no
  `assets/video/`. It was the owner's call, `privacy.html` states it, and
  `frame-src` in `vercel.json` names the two origins. The film section further
  down still asks before it loads.

  This entry used to say "this is the only third-party request the site makes
  on load". That was true when it was written and stopped being true when the
  translator shipped: a returning visitor whose stored language is not Hebrew
  reaches the Supabase `translate` function during mount, before anything is
  clicked. YouTube is still the only load-time request to a party that is not
  ours — which is the sentence that was meant, and is not the sentence that
  was written.

- **The site speaks four languages, and this file said nothing about it for
  days.** `assets/js/i18n.js` injects a language group (עברית · العربية ·
  English · Русский) into `.nav` before `.nav__cta` and into `#mobile-menu`,
  and translates the page the visitor is standing on. A fresh session that
  meets this by surprise, mid-change, is exactly the accident this file exists
  to prevent — so:

  - **Hebrew is the source of truth and is never fetched.** Every target keeps
    its Hebrew string, so switching back is instant and works offline. Every
    failure mode — no network, dead endpoint, a model that refuses — leaves
    the page in Hebrew, silently and on purpose. There is no loading state
    that can strand a visitor.
  - **The client sends sha256 hashes of normalised strings**, not the page, to
    `…supabase.co/functions/v1/translate`
    (`supabase/functions/translate/index.ts`). Hits come from
    `public.translations`, keyed by STRING and not by page
    (`docs/supabase-translations.sql`), so nav and footer copy warms the whole
    site on the first view; only misses reach a model. `connect-src` in
    `vercel.json` already names that origin.
  - **It ships on the three indexable pages only.** `index.html`, `cost.html`
    and `camera-3d.html` — the same three that carry `assistant.js`. The legal
    pages are excluded twice over: no `<script>`, and `NO_TRANSLATE_PAGE` in
    `i18n.js` refuses `privacy|terms|accessibility` even if one is added.
    They are drafts awaiting a lawyer, and a machine rendering of them is a
    document the studio never wrote.
  - **The DOM does not hold still, and the collector is incremental for that
    reason.** The assistant builds its whole panel after load, live regions
    announce filter counts, the lightbox writes captions. A `MutationObserver`
    with a 120ms lull re-collects only what is new and re-runs it; repeats
    come from an in-memory dict with no network. The earlier `if (targets)
    return targets` left every one of those speaking Hebrew into a translated
    page forever. `[data-no-translate]` opts a subtree out; the switcher
    wears it.
  - **EN and RU were held back on an untested belief.** The stylesheet was
    counted for physical properties and judged unsafe to mirror; nobody had
    rendered it. Rendered in LTR at 1280 and 390 it was correct — the grids
    and flex rows already do the work. Three rules genuinely depended on
    direction and are now logical; the floating controls stay physical on
    purpose, so the right-hand side stays clear for the a11y toolbars.

  **Open, and it is the same rule as the lead form's field list:
  `privacy.html` does not mention this feature.** It enumerates the a11y
  `localStorage` key and states that preference is sent nowhere; it names
  neither `amora.lang` nor the page's own text reaching our Edge Function.
  Verified absent 2026-08-09. The lead-form rule in this file exists because a
  page that enumerates what it stores is wrong the moment it under-counts.
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
  was not found, so a relative href resolves against the dead path. The
  512px-icon story is CLOSED: this entry used to say the manifest ships
  without one because the logo was 150×150 — a real 4096px master arrived,
  `assets/img/logo.jpg` is now 512×512, `icon-512.png` exists and the
  manifest lists it. Do not re-open the "not installable" problem.

- **One scroll lock, three holders — and it is position:fixed, not
  overflow:hidden.** iOS Safari scrolls a body that merely wears
  `overflow:hidden`, so `main.js` owns `window.AMORA_LOCK`: the mobile menu,
  the lightbox and the assistant's phone sheet hold it **by name**, the body
  is pinned with `top: -scrollY`, and the last release restores the exact
  position with scroll-behavior forced to auto (html scrolls smooth — an
  animated restore paints as a glide from the top). Two consequences that
  are not obvious from either file: the `#photo-<n>` load path scrolls the
  gallery into view *instantly, before* opening, because a fixed body cannot
  be scrolled after the lock lands and a lock taken mid-smooth-glide pins
  the page wherever the animation happened to be; and `measure()` re-runs on
  release because the ResizeObserver cached the viewport-sized scrollHeight
  of the pinned body.

- **The assistant's matcher has a stem pass, and the assistant's tier 2 has
  a seam.** Every KB key ending in ה also matches its ־ת/־ות forms through a
  stem scored one under the full key — with a build-time conflict guard
  (a stem living inside another entry's key is dropped: 'מצלמ' would have
  sent every "אתם מצלמים…" to the gear answer) and one named veto: 'אמור',
  from אמורה, is the everyday "supposed to". Tier 2 activates only when a
  page sets `window.AMORA_ASSISTANT_REMOTE = true` before assistant.js runs —
  a flag, not a CONFIG edit, so `verify.mjs` drives the whole remote path
  against a stubbed endpoint; no page ships the flag today.

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

- **The gallery is an address, not a wall — and the addresses have already
  been sent to people.** Eighteen photographs, five chips
  (`all`, `weddings`, `std`, `prep`, `events`). Four things depend on those
  literal strings and none of them is next to the other: `#gallery-<cat>`
  entry links, `cost.html`'s `.glimpse` frames
  (`index.html#gallery-weddings` and siblings), `assistant.js`'s
  `gallery:<cat>` actions, and the chips themselves. **Renaming a
  `data-filter` value breaks links that are already in strangers' WhatsApp
  threads**, and nothing fails loudly when it happens.

  The URL contract, precisely: a chip press `replaceState`s
  `#gallery-<cat>` (or clears it for `all`); opening a photograph writes
  `#photo-<n>`, where **n numbers the FULL set, never the filtered one**;
  closing restores the filter's hash. Both hashes are honoured on load —
  the page lands filtered, scrolled, and with the floating WhatsApp control
  already earned, because a visitor who was SENT here has been vouched for,
  and measured at 390×844 they land fifteen pixels under the scroll
  threshold that would reveal it.

  **Two rules about campaign tags, and they point opposite ways on purpose.**
  `carryCampaign()` rewrites same-origin cross-page links so `utm_*` survives
  the hop — measured: `/cost.html?utm_source=instagram` → glimpse → submit
  used to record `source: "/"`. But the lightbox's share button **strips the
  query before the URL leaves the phone**, because a shared photograph goes to
  a different person and the sender's tags must not become that person's
  `source`: a word-of-mouth lead filed as an ad conversion is worse than an
  unattributed one. Neither rule stores anything, and a visitor who does not
  submit is still unmeasured — `privacy.html` still says exactly that.

  Everything additive degrades to the markup. Below 560px the wall is a CSS
  scroll-snap strip that works with `main.js` deleted; the hint, the strip
  counter, the per-chip counts and the share button are all built in JS and
  simply are not there when they cannot work, which is the same rule that
  keeps a dead control off the page. Where the engine has View Transitions
  the filter FLIPs the wall; where it does not, it swaps.

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
  nodes, one `<h1>`, zero skipped heading levels, and 602 words plus every
  FAQ answer (ten since 2026-08-09) rendered with JavaScript off. The YouTube hero is not the LCP
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

  **Re-verified end to end 11.8.2026, and the method is the point.** The grant
  currently covers exactly ten columns — `name`, `phone`, `email`,
  `event_date`, `date_tbd`, `event_type`, `area`, `coverage`, `message`,
  `source` — which is exactly what `main.js` posts, so the two are in sync.
  Reading the ACL is not the test, though. The test was to run the real
  payload inside `begin; set local role anon; … rollback;`, **and then run a
  deliberate control that had to fail**: an INSERT naming `external_id`, a
  column `anon` does not hold. It returned `42501 permission denied`, which is
  what proves the role was actually in effect — without that control, a green
  first result is indistinguishable from the `postgres` false pass that let
  this bug ship in the first place.

  Then a committed row proved the rest of the chain live:
  `200 {"sent":true,"to_source":"private.settings","recipients":2}` in
  `net._http_response`, trigger `on_lead_insert_alert` enabled, both inboxes
  reached. The test row was deleted afterwards.

  **`public.leads` holds zero rows and always has.** The path is mechanically
  proven; it has never carried a real website lead. Every lead the studio has
  had came through Facebook and Make. Do not read an empty table as a broken
  form — but do not read this verification as production evidence either.
- **The lead form's fields are enumerated in `privacy.html`.** Adding or
  removing one means editing that list in the same change — the page states in
  as many words what is collected and what is not. `email` (optional) and
  `date_tbd` are stored, and `source` records the referrer host, any `utm_*`
  tags and the submitting page. `source` is not analytics and must not become
  it: it is read once, at submit, only for someone already handing over their
  name and phone. Nothing measures a visitor who does not submit, and
  `privacy.html` promises exactly that.
- **The FAQ answers on the homepage are byte-identical to the FAQPage JSON-LD**
  and `tools/check.sh` checks it one-for-one — ten answers since 2026-08-09
  (the historical eight plus "מה קורה אחרי" and the video question), plus a separate
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
- **Facebook lead intake: five of eight pipelines were silently destroying any
  lead that errored. Found and partly fixed 11.8.2026.** Make team `466598`
  carries eight ACTIVE `facebook-lead-ads` intake scenarios. The audit that
  matters is not "is it active" — all eight were — but two settings that no
  dashboard surfaces:

  - **`blueprint.metadata.scenario.dlq`** ("allow storing of incomplete
    executions"). With it **false**, a scenario that errors does not queue the
    lead, does not create an incomplete execution, and leaves `dlqCount` at
    **0**. The lead is gone, and the scenario looks perfectly healthy. It was
    `false` on `3838948`, `3707841`, `3838911`, `3838921` and `4294792`.
  - **an `onerror` guard on `phonenumber:TransformerParseNumber`.** A Facebook
    lead whose phone field does not parse throws, and in the older pipeline
    shape the Origami search *and* create both consume `{{4.phone}}`, so the
    throw takes the whole lead with it. `3707841` carries `builtin:Ignore`
    there, which is worse than nothing: the bundle is dropped with no error at
    all.

  **The lead stuck since 25.7 on `4784873` survived only by accident** — that
  one scenario happened to have `dlq: true`, so its failure was preserved
  instead of erased. Same bug, opposite outcome, and the difference was a
  checkbox nobody had looked at.

  **Fixed this session:** `6821619` (Amora) — its phone module's `Ignore`
  became a `Resume` that normalises the number by hand, so a malformed phone
  no longer costs the WhatsApp auto-reply. Amora's lead was never at risk:
  its router runs Origami and HubSpot on branches that do their own inline
  `replace()` and never touch the phone module. `3838948` (Regaflash, the live
  08.26 campaign) — `dlq` turned on **and** the `Resume` guard added.

  **All eight are now done.** `3707841`, `3838911`, `3838921` and `4294792`
  were finished in the same session: `dlq` on and the `Resume` guard added to
  each. Verified afterwards against a fresh `scenarios_list` — all eight
  active `facebook-lead-ads` scenarios report `isinvalid: false` with a
  `Resume` module present — and by re-reading the blueprints of the ones that
  were edited, which show `dlq: true` and the guard on module 4.

  `scenarios_update` replaces the blueprint wholesale, so each fix meant
  resending the whole thing. Two things made that affordable and are the
  reason to write them down. **Strip `metadata.expect` and
  `metadata.designer.samples` first** — both are UI scaffolding Make
  regenerates, and they are ~73% of the payload; 86k characters becomes 23k.
  **Then diff against a blueprint already sent successfully.** These five
  scenarios are near-clones: `4294792` differed from `3838921` in only the
  hook id, four TASKEY comment strings and the name, and `3707841` differed
  by those plus four module ids, two designer coordinates and a missing
  `email` key. Rebuilding from a verified sibling plus a diff is both cheaper
  and safer than transcribing a fresh blueprint.

  **`3838911` carried two further faults and both are now fixed.** Its Origami
  search looked for `0{{4.phone}}` while its create wrote `fld_1509` as
  `{{4.phone}}`, without the leading zero — so its own dedupe lookup could
  never match a record it had created, and every repeat lead from that form
  opened a second contact. It was the only pipeline storing numbers without
  the zero, so it was aligned to the majority rather than the other way round.
  **Old rows were deliberately NOT migrated:** a contact written before the
  fix is created once more in the correct format and from then on dedupes
  normally, which is a bounded, self-healing cost — cheaper and safer than a
  bulk rewrite of live CRM rows.

  It also carried `builtin:Ignore` on both `origami:search` and
  `origami:updateFieldsId`, the last silent-deletion path left in any lead
  pipeline. Both were removed. That reasoning only became correct once `dlq`
  was on: with the safety net off, `Ignore` and a hard error both lost the
  lead, so removing it bought nothing. With the net on, the error is preserved
  and retryable instead. **Order mattered — the same edit made a day earlier
  would have been pointless.** `3838911` now reports the same two `Ignore`
  modules as its siblings, both on ManyChat, where a failure costs the
  WhatsApp greeting and not the lead.

  Two traps for whoever picks this up. **`scenarios_get` on these returns
  ~86k characters**, nearly all of it the country enum under
  `metadata.expect` plus `metadata.designer.samples`; both are UI scaffolding
  Make regenerates, and stripping them cuts the payload by ~73% without
  touching behaviour. And **`usedModules` in `scenarios_list` is the cheap
  audit**: a lead scenario listing `TransformerParseNumber` with no
  `builtin:Resume` beside it is unguarded, and that check costs one call for
  the whole team instead of eight blueprint fetches.

  **Make's own alerting is not in the API.** `organizations_update` accepts
  name, country and timezone only — verified against the tool schema, and
  there is no `users_update` tool at all. `keys_list` is empty, so there is no
  stored API token to give an in-Make watchdog either. A registry-wide search
  for a DLQ/replay/retry tool returns only read tools (`executions_get`,
  `executions_list`, `executions_get-detail`) — **an incomplete execution
  cannot be replayed from the API.**

  **But the notification settings were ALREADY ON, and this file spent a whole
  session telling the owner to switch them on.** Checked in the UI 11.8.2026:
  they live under Profile → **Email preferences** (with an org-level copy under
  Organization → Notification options), there is no option called "Incomplete
  executions", and the four that exist — *Errors in scenario run*, *Warning in
  scenario run*, *Scenario deactivation*, *Credit limit reached* — were all
  enabled already. Nothing needed changing.

  **So the alerting gap is not configuration and not delivery — it is
  attention, and that is the hardest of the three to fix.** `3772899` was
  auto-deactivated on 9.8.2026 12:11:23; Make's mail
  (`noreply@eu1.make.com`, subject "🔴 The scenario … has been stopped")
  **arrived in the inbox the same minute** and was still sitting there
  unopened two days later, among 1,828 unread. The setting was on, the mail
  was delivered, and six customer call-reminders still went nowhere. **More
  email is therefore not the fix.** What would work is a rule that lifts these
  out of the pile — a Gmail filter on `from:noreply@eu1.make.com` that stars
  and labels, or routing them to a channel that is not the inbox. Note there
  is no Gmail *filter*-creation tool in this environment (labels can be
  created and applied, rules cannot), so that one is the owner's to make.

- **`3772899` — diagnosed and repaired 11.8.2026, deliberately left OFF.**
  Module 7 (`manychat:PerformAction`) died on
  `Missing value of required parameter 'value'`. Not a missing mapping: all
  four actions map a `value`, but the first is
  `formatDate(parseDate(1.'תאריך ושעת שיחה'; …))`, which returns **empty**
  when the webhook payload carries no call time or carries it in another
  format — and ManyChat rejects an empty required value. Three of those in a
  row tripped `maxErrors: 3` and Make switched the scenario off.

  Fixed three ways: a `Resume` guard on the phone module, `builtin:Ignore` on
  both `PerformAction` modules and on `CreateSubscriber` so one malformed
  payload can no longer kill the run, an `exist` filter on the formatted date
  so an empty one never reaches ManyChat, and `dlq: true`.

  **The repair is written but NOT working, and it is off. Do not read the
  paragraph above as "fixed".** Activating it on 11.8 produced six immediate
  `BlueprintValidationError — Scenario validation failed, 5 problem(s) found`
  runs at **0 operations each**, Make auto-deactivated it again, and the
  webhook queue stayed at **6, untouched**. Nothing was sent, nothing was
  consumed, no customer was contacted — but the stored blueprint now fails at
  init rather than at module 7, which is a different kind of broken, not a
  fixed one.

  **Two repair attempts failed, both with the identical error, and the second
  disproved the first diagnosis.** Attempt 1 restored nothing; attempt 2
  restored `metadata.parameters` to modules 1, 3, 5, 6, 7 on the theory that
  five stripped blocks explained "5 problems" — and the count stayed at five.
  The remaining candidate is **`metadata.expect`**, which in this blueprint
  sits on exactly five modules too: **2, 3, 5, 6, 7**. That is almost
  certainly it, and it is why `expect` cannot be stripped here even though
  stripping it is safe on the eight lead pipelines. The difference worth
  noting: those scenarios report `islinked: true`, this one `islinked: false`.
  **Do not strip `expect` from an unlinked scenario.**

  It was not attempted a third time on purpose. Module 2's `expect` carries the
  ~250-entry country enum that made this blueprint 86k in the first place, and
  modules 6 and 7 carry the full nested `actions` option spec; reconstructing
  all of that by hand, against a live customer-facing scenario, is a worse bet
  than the alternative below.

  **The way out is the UI, and it is one action: open `3772899` in the Make
  editor and press Save.** The editor regenerates `metadata.expect` from the
  app definitions on save, which is exactly what is missing, and it preserves
  the behavioural fixes already stored in the blueprint — the `Resume` guard,
  the three `Ignore` handlers, the future-only filter and `dlq: true`. Then
  activate and confirm `isinvalid` goes false.

  **Net position after all of it: unchanged for the owner and safe.** Before:
  off, queue 6, failing at module 7. After: off, queue 6, failing at init.
  Every activation attempt produced 0-operation runs — nothing sent, nothing
  consumed, no customer contacted, and the six queued items are still intact.

  The queue could not be flushed from here either: `hooks_*` has
  create/delete/update/get/list/ping/learn and nothing that clears a queue.
  That is why the future-only filter was added — it lets the six stale items
  drain harmlessly on the next successful activation instead of messaging six
  people about a call that already happened, and it is the correct rule
  permanently, not just for this cleanup.

  Worth knowing while judging that risk: this scenario **has no `SendFlow`
  module**. It only writes ManyChat custom fields. Whether a field write
  triggers an outbound WhatsApp message depends on ManyChat automations and on
  the sibling scenario `3778980` ("חלק 2"), neither of which is visible from
  here — so the blast radius is smaller than a send, but not provably zero.

  This scenario also carries the **first deployment of the digits-only phone
  normalisation** — `replace(…; /[^0-9]/g; "")` in place of the five nested
  `replace()` calls. It strips invisible control characters, which the older
  chain does not. **It has not been exercised yet**, because the scenario has
  not been allowed to run; treat it as written-but-unproven until it has, and
  only then roll the same expression into the eight lead pipelines.

- **The 25.7 lead was recovered without the UI, and the root cause is an
  invisible character.** Make will not hand back a failed execution's payload,
  but **Facebook still has the lead** — `facebook-lead-ads:listLeads` reads a
  form's history directly. The recipe, which took one throwaway scenario and
  about ten minutes:

  1. `data-structures_create` a flat text spec, then `data-stores_create`
     against it — the data store is the only sink in Make whose contents an
     API caller can read back.
  2. `scenarios_create` with `facebook-lead-ads:listLeads` →
     `datastore:AddRecord`, scheduling `{"type":"on-demand"}`, then
     `scenarios_activate` + `scenarios_run`.
  3. `data-store-records_list` to read it.

  Two traps cost a round trip each. **`AddRecord`'s record fields are nested
  under `data`** — a flat mapper is silently dropped and writes empty records,
  which is what a first attempt will look like. And **the lead output field is
  `leadgenId`, not `id`** (`rpc_execute` on `LeadInterface` gives the real
  shape; `rpc_execute` on the datastore's `expect` gives the real mapper).
  `data-store-records_list` caps at 100 with no offset, so clear the store
  between runs or the first page hides everything new.

  The lead itself: **אליאב כמיסה, +972 54-351-9996, 25.7.2026 09:53:39Z** —
  four seconds before the execution that failed. Its phone carries a
  **bidirectional control character between `+972` and the digits**, invisible
  in every UI, which is exactly why `TransformerParseNumber` rejected it.

  **This matters for the `Resume` guards added the same day.** They strip
  `+`, `-`, space and parentheses — not invisible control characters. A lead
  like this one is therefore no longer *lost* (it reaches Origami, which was
  the point), but its stored number would carry the junk character and the
  ManyChat branch keyed on it would likely still fail. The guards should be
  upgraded to strip everything that is not a digit — Make's `replace()` takes
  a regex, so `replace(...; /[^0-9]/g; "")` collapses the whole chain into one
  robust expression. **Not yet done: it is one more wholesale blueprint
  resend per scenario, across all eight.**

  **Retrying the queued item from the UI does NOT pick up the guard.** Tried
  11.8.2026 on `4784873`, whose module 4 demonstrably carries the `Resume`
  handler: the retry failed with the identical
  `The string supplied did not seem to be a phone number`, the item returned
  to Unresolved and its attempt counter went 0 → 1. The most likely reading is
  that a replay re-runs the stored bundle against the blueprint as it was when
  the run failed, so a handler added afterwards is invisible to it — **this is
  inferred from one observation, not proven.** The practical consequence is
  firm either way: **do not keep pressing Retry on a pre-fix item.** Recover
  the lead from Facebook with the recipe above, act on it by hand, and clear
  the queue entry.

  One reconciliation worth keeping, because the two dates look like two
  incidents and are one: the queued item is stamped **26.7 12:44:56**, not
  25.7. The lead reached Facebook on 25.7 at 09:53:39Z and sat in the webhook
  queue; on 26.7 at 09:44:53Z the scenario was started by hand, the queue
  drained, and the failure was recorded then. Same lead, one incident.

- **A browser session can silently stop a live scenario, and the API is how
  you find out.** On 11.8.2026 `3838911` — a Facebook lead intake on form
  `772620469095975` — was found inactive. Its blueprint was intact and there
  were **zero failed executions**, so nothing had auto-deactivated it;
  `executions_list` showed a bare `{"type":"stop"}` by the account at
  02:26:02Z, six minutes after a UI-driven retry elsewhere, and the session
  that did it reported touching nothing else. It was reactivated the same
  hour and its webhook queue was still 0, so no lead was lost in the ~75
  minutes it was down. **`type: "stop"` / `type: "start"` entries in
  `executions_list` are the audit trail for this**, and a guard sweep that
  filters on `isActive` will silently drop a stopped scenario from its own
  results rather than flagging it — count the rows, not just their contents.

- **Meta CAPI: connected and accepted, 5.8.2026.** Origami status changes flow
  through Make `3756300` → `supabase/functions/meta-capi` → Graph API. Four
  events were sent against Meta's own CRM verification lead
  (`1513375167229002`, issued by the Test Events tab) and **all four came back
  `events_received: 1` with `messages: []`** — `LeadContacted`,
  `LeadConverted`, `LeadQualified`, `LeadDisqualified`. That exercises every
  branch of the mapping table.

  **The dataset question is closed.** `2851332215058775` was taken on trust
  from a pasted URL; it is confirmed twice over — Meta's own CRM wizard opens
  at `data_source_id=2851332215058775` for this business, and the dataset
  accepted the events. Its name says "Regaflash" because the Amora campaign
  runs inside the Regaflash ad account (`600899502539771`, business
  `501463492690274`).

  **Do not complete Meta's CRM partner wizard.** It offers to wire Make as an
  official partner; Origami is not in its supported list, and finishing it
  would create a second Make scenario feeding the same dataset — double
  counting against a path that already works.

  **That warning is about the PARTNER step, and it must not be read as
  covering the funnel step.** Events Manager shows the CRM setup card as two
  lines, and on 11.8.2026 the first one — "חיבור ה-CRM" — was already green,
  badged "האירועים מופעלים כראוי". That is Meta's own UI confirming the
  Origami → Make → `meta-capi` → Graph API path is received and healthy,
  which is stronger evidence than the API replies this file previously rested
  on. The second line, **"הגדרת משפך המכירות" / Configure your sales funnel,
  is a mapping made on Meta's side only — it creates no second data path**,
  and it is precisely what the empty "Used by" column is waiting for: it turns
  stored events into events a campaign can optimise against. The four stages
  `meta-capi` already sends — `LeadContacted`, `LeadQualified`,
  `LeadConverted`, `LeadDisqualified` — are the standard funnel stages, so the
  mapping is one-to-one.

  The line to hold while clicking through it: **a screen that asks you to map
  lead stages is the right one; a screen that asks you to pick a CRM partner
  or connect Zapier/Make is the one to back out of.** The card carries Zapier
  branding even though our connection is direct, so the branding is not the
  signal — what the screen asks for is. Doing the mapping changes nothing
  until an ad set is set to optimise for Conversion Leads, and the campaign is
  off, so there is no urgency either way.

  `developers.facebook.com` is blocked by this environment's egress proxy, so
  the integration guide itself cannot be read from here — the distinction
  above comes from the Events Manager screen, not from the doc.

  **Meta's `channel=website` recommendations belong to regaflash.com and must
  never be applied to this site.** Events Manager raises them against dataset
  `2851332215058775` because the Amora campaign runs inside the Regaflash ad
  account, so both businesses share it. Two seen on 11.8.2026: a missing
  `custom_data.value`, and a **high-priority** nudge to install the
  parameter-builder SDK to raise `fbc` coverage. Neither can be about this
  site — it carries no Meta pixel and no measurement script of any kind
  (`fbq`, `connect.facebook.net`: zero matches), and `vercel.json` sets
  `script-src 'self'`, so a third-party tag could not execute even if someone
  pasted one in. **The "high priority" badge is Meta's judgement about an ad
  account, not about this repo**, and acting on it here would break
  `privacy.html`'s promise that nothing measures a visitor who does not
  submit.

  Both are also irrelevant to the lead path on their own terms. `value` serves
  ROAS-optimised campaigns; these are lead-gen campaigns, and inventing a
  number to clear the warning would only pollute the data. `fbc` is a click id
  derived from `fbclid` when someone lands on a website from an ad — and the
  lead path has no landing at all: the form is filled inside Facebook, and
  Meta matches these events on `lead_id`, which `meta-capi` already sends from
  `fld_1519`. That is a stronger key than `fbc`, not a weaker one. The blank
  Event Match Quality on the four test events is a volume problem — the score
  is built from 24–48 hours of traffic — not an `fbc` problem.

  **Confirmed in the UI the same evening:** all four appear in the dataset,
  active, source "Conversions API", one each, with an activity point at 19:00
  on 5.8 and **zero errors or warnings**. The chain is verified end to end,
  receive side included.

  **And the finding that matters most came with it: the "Used by" column is
  empty on all four.** The events arrive and are stored, and **no campaign
  optimises against them.** That is the difference between Meta knowing what
  happened to a lead and Meta buying on it — the whole point of the work. It
  needs the ad set set to optimise for **Conversion Leads**, which is a
  campaign setting and a media-budget decision, not code. The campaign is off,
  so it waits regardless.

  Event Match Quality is blank for all four, and that is expected rather than
  broken: the score is built from events in the last 24-48 hours and needs
  volume. Four events produce no score.

  **Two things are NOT proven and must not be written up as if they were.**
  The `event_id` de-duplication guard: Meta dedupes silently and returns
  `events_received: 1` either way, so the API cannot distinguish a counted
  event from a discarded duplicate. And the trigger itself: these four went
  straight to the endpoint, bypassing Make. What is verified is the endpoint,
  not that a real status change fires it.

  **The campaign is off**, and the last `6821619` run was 4.8 18:27 while
  `fld_1519` was only mapped 5.8 12:45 — so no lead in Origami carries a Meta
  id at all. Until a new lead arrives, a status change returns
  `skipped: no usable meta lead id`, correctly.

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

  **Both inboxes receive, from 5.8:** `lead_alert_to` holds
  `support@amora-studios.com, support@regaflash.com`, verified with a real row
  (`recipients: 2`). That send is also the first real proof of what verifying
  the domain bought — regaflash is *not* the Resend account owner, so it would
  have been refused `403` that morning.

  `LEAD_ALERT_TO` in Supabase Secrets still says `support@regaflash.com` and is
  **not** in use. Its risk dropped today: before verification, falling back to
  it meant every alert failing silently; now it would only lose the amora
  address. Worth aligning in the dashboard, no longer urgent, and impossible
  from code — Secrets have no API.

  **Delivery confirmed from the receiving end, 5.8 evening:** three sends, all
  Delivered, none bounced, none complained, landing in the **Inbox** with the
  spam folder entirely empty. Resend's log shows four `403`s clustered before
  the fix and `200`s after — the fingerprint of the bug and its repair.

  One prediction of mine was wrong and the correction is worth keeping: the
  sends made *before* the domain was verified did **not** fail. Once the
  destination became `support@amora-studios.com`, that address was the Resend
  account owner, so the shared sender was allowed to reach it. Verifying the
  domain did not rescue a broken send; it removed a constraint already worked
  around by pointing at the owner's own inbox. **What verification buys is any
  recipient, not this one.**

  **Still unverified:** whether Gmail recorded `SPF=PASS` / `DKIM=PASS` and a
  DMARC result. That needs "show original" in the mailbox, and nobody guessed
  at it. "Reached the inbox" is weaker evidence than a PASS line, and it is the
  evidence there is.

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
- ~~A logo master of 512px or more~~ — **done.** A 4096px master arrived;
  `assets/img/logo.jpg` is 512×512 and the icon set is generated from it.
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

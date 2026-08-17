# Amora Studio — project memory

## ⚑ Fresh session? Read this first

The site is **live at https://www.amora-studios.com**, on Vercel, on the
owner's domain. SITE_URL has been replaced everywhere it appears (canonical,
og:url, JSON-LD, sitemap.xml). The lead form is wired to Supabase and the
private CRM at `admin.html` reads it back.

```
Before any change goes out:
1. tools/check.sh          # must exit 0 — 32 checks + a phone-format count
   node tools/verify.mjs   # must exit 0 — 270 runtime checks in a real browser
   # That second number said 43 while the suite ran 174. Both counts were
   # suspect on 2026-08-09 and both were re-counted against real output: the
   # check.sh number was right and untouched, the verify.mjs one had been
   # wrong since the suite tripled. The count is not decoration — a session
   # that reads 43, watches 174 scroll past and concludes it is running the
   # wrong tool goes looking for a second verifier that does not exist. When
   # you add an ok(), change this line in the same commit.
   # verify.mjs needs playwright-core and pngjs, and build-assets.mjs needs
   # sharp. None is vendored and there is no package.json:
   #   npm install --no-save playwright-core pngjs sharp
   # ALL THREE in ONE command — with no package.json, a second --no-save
   # install removes what the first one put there. This is not theoretical:
   # on 2026-08-13 installing sharp alone to build the AVIF derivatives
   # deleted playwright-core, and verify.mjs then died with
   # ERR_MODULE_NOT_FOUND, which reads like a broken suite and is a broken
   # install.
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
- **The Vercel MCP connector is authorised but points at an EMPTY scope, and
  that is the whole story — do not re-derive it.** Measured 2026-08-14:
  `list_teams` returns exactly one team (`amora`, slug `amora5`,
  `team_AFHaG9WExAgNuDXRSuLhhxi4`); `list_projects` on it returns **zero
  projects**; `get_project` on the slugs `amora` and `amora-studios` returns
  404; and the repo has no `.vercel/project.json` to read an id from. The
  project that serves `amora-studios.com` lives under a different account or
  team than the one the connector was authorised against. Until that is
  corrected, deploy status, runtime logs and Analytics data are all
  unreachable from here regardless of how the connector is described.

  **And even with the right scope, Analytics cannot be switched on from here.**
  The MCP surface has `get_web_analytics` — a *query* tool — and no enable
  tool. Vercel's own documented route is the CLI:
  `npx vercel link && npx vercel project web-analytics --format json`.
  There is no `vercel` binary and no `VERCEL_*` token in this environment, and
  the MCP keeps its credentials internally, so that command is the owner's to
  run. Asking for "full Vercel access" does not change either fact.

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
- **The Google Drive connector reads text and CANNOT deliver photographs, and
  the second half of that sentence is the one that costs a session.** Measured
  2026-08-11 against the studio's own library. Text works and is genuinely
  useful: `read_file_content` returned the full landing-page brief and the
  Regaflash quote, and that is where the `#process` magnets explainer came
  from. Images do not, in **both** directions at once:

  - `read_file_content` on a JPEG returns `{"fileContent":""}` — empty, twice,
    on two different photographs. There is no description and no pixels, so a
    session cannot even *look* at a Drive photo to judge it. Any instruction
    to "pick the good ones from Drive" is unexecutable from here.
  - `download_file_content` DOES return the bytes — as base64 **inline in the
    tool result**, which lands in the context window. The studio's photographs
    are 1–9 MB, so one 5 MB frame is ~6.7 MB of base64, on the order of a
    million-plus tokens. The smallest file in the library is 950 KB. This is
    not a slow path to be endured; it is not a path.
  - Every host that could serve the bytes to `curl` is refused by the egress
    policy at CONNECT: `drive.google.com`, `drive.usercontent.google.com`,
    `docs.google.com`, `lh3.googleusercontent.com` all fail 403.
    `www.googleapis.com` IS reachable and answers `403 missing a valid API
    key` — the Drive REST API is open to us but the credentials live inside
    the MCP server, not in this environment, so it cannot be called. Do not
    burn a session trying to bridge that gap; `/root/.ccr/README.md` says to
    report a policy denial rather than route around it.

  So the route for photographs is the same one the entry above describes for
  any binary: the owner uploads them to the repo through GitHub's web UI, and
  a session builds derivatives from there. Sending them through chat does not
  work either — see the attachment entry above.

### The drop zone — how photographs actually get in

Used successfully 2026-08-11 for 24 frames. The shape matters more than the
run, because every part of it exists to work around something that failed:

- **The owner drives a browser agent, because it can see what this session
  cannot.** Claude for Chrome runs in the owner's logged-in browser: it opened
  Drive, *looked* at 270 photographs, judged them, and moved the chosen ones
  straight into GitHub's upload form. Nothing touched a local disk. The
  curation — "no phone snaps, no crew in frame, no near-duplicates" — has to
  happen there, since a session here cannot open a Drive JPEG at all.
- **Files are named by SLOT ID, not by their camera name.** `g08.jpg` *is* the
  g08 slot. That single convention is what lets a session wire up photographs
  it has no way to look at first, and it is why the instructions must ship the
  slot table (id, aspect ratio, subject) rather than a vague "send good ones".
- **They land in `incoming/` on a throwaway branch that never merges.** Not the
  repo root: `check.sh`'s raw-image guard is `git ls-files ':(top,glob)*.jpg'`
  and sees the root ONLY — verified by experiment, not by reading it — so a
  subfolder passes the build while still being 100MB of unpublished work. The
  originals are read, built from, and left behind; `.gitignore` and
  `.vercelignore` now name `incoming/` so a stray `git add -A` cannot drag them
  into the branch that does merge.
- **`build-assets.mjs` prefers `incoming/<id>.jpg` and KEEPS a slot it cannot
  rebuild.** This is the load-bearing part. The numbered Instagram-era library
  is untracked, so on a fresh clone it is absent entirely — a builder that
  rebuilt "everything" would have deleted every slot the drop did not cover.
  Named-but-absent and never-named both fall through to carrying the previous
  manifest entry verbatim.
- **`focusX` / `focusY` override sharp's `attention` crop, and exist because it
  failed loudly once.** `svc-event` is a landscape frame of the bride lifted on
  a chair, dead centre, with a guest's face at the right edge; attention
  cropped to the guest and cut the bride in half. The fractions are measured
  off the source, not guessed. Every other slot still uses `attention`, which
  is right nearly always.

Afterwards: `gen-image-schema.py`, `gen-sitemap.py`, then both suites. Two
follow-ons that only surface at that point — a slot whose new source is finally
big enough gains a candidate width the markup does not reference yet (`g17`
went 600-only → 600+1100, `cta` → 2000), and a hard-coded count in
`verify.mjs` moves if a photograph changes category (`prep` 3 → 4).

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

  It appears in six places and they must stay consistent: the trust bar, the
  package FAQ answer (**both copies** — the visible one and the FAQPage
  JSON-LD, which `check.sh` compares byte-for-byte), the `cost.html`
  inclusions list, `assistant.js` (a `magnets` entry plus the `package`
  answer), and — since 2026-08-11 — the **"מגנטים וידאו" explainer at the foot
  of `#process`**, which is the only place on the site that says what the
  product actually *is*. Until then it had one line in the deliverables ledger
  and one inside a collapsed FAQ answer: the studio's sharpest differentiator,
  described nowhere. Its copy is the owner's own, from the landing-page brief
  in Google Drive (`אמורה | באנר + דף נחיתה`, מקטע 3). The link to
  `regaflash.com` lives in `.faq__more`, **not** in the FAQ answer — a tag
  inside `.faq__a` breaks the byte-lock, which is the same trap that put the
  `cost.html` link there. The explainer deliberately adds no second outbound
  link, so that stays one link in one place.

  **The scan needs an APP, and two of the owner's own documents disagreed
  about it.** `רגעפלאש-שיכתוב קופי` spells out "מורידים את האפליקציה →
  סורקים את המגנט"; the February video scripts say only "תסרקי", with no app.
  The site had followed the second reading and told visitors they simply point
  a phone — including `magnets.html`, written on 2026-08-13, and `#process`
  step 03. **Owner-confirmed the same day: an app is required**, and both were
  corrected. This is the second time a contractor's marketing copy contradicted
  itself about a load-bearing fact (the first was the photographer count), and
  the resolution was the same: ask the owner, do not pick the reading that
  reads better.

  Two further facts confirmed at the same time and now published: the magnets
  are **unlimited in number**, and guests **collect them from a station** at
  the event. Both were in the ad copy and in neither the site nor this file.

  It sits INSIDE `#process` for the same reason the deliverables ledger above
  it does: the eyebrows are a hand-numbered 01→09 sequence, and a new
  top-level section renumbers four of them and both nav copies. It reuses
  `.process__grid` and `.step`, so it needed no new CSS — and note that
  `verify.mjs` reads the **first** `.process__grid` and counts
  `.deliver__item`, so a block appended here must add neither a ledger row nor
  a grid ahead of the original.

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

- **Every photograph ships in three formats, and the ORDER in `<picture>` is
  the mechanism.** JPEG is the floor, WebP must beat the JPEG, AVIF must beat
  the WebP — `build-assets.mjs` steps quality down a ladder until each format
  wins and **writes no file at all** if it never does. A browser takes the
  first `<source>` it understands, so a heavier newer format would hand the
  newest browsers the biggest file; `check.sh` asserts both size rules on
  disk, and `verify.mjs` asserts the ordering in a real browser.

  Added 2026-08-13: 48 AVIF files, 24 of the 26 slots, **2.57 MB → 1.83 MB
  against the WebP set (28.6%)**. Measured, not estimated.

  **Three sources deliberately have no AVIF, and they are not an oversight.**
  `g08` and `g10` have no file in `incoming/` — they are the two slots the
  drop could not fill, and on a fresh clone the numbered Instagram-era library
  is absent entirely, so there is nothing to encode from. `hero-wide-poster`
  is built by a different (obsolete) tool. Re-encoding an AVIF out of an
  already-compressed JPEG is lossy-on-lossy for a marginal gain, so
  `<picture>` simply falls through to WebP for those three. The coverage
  assertion in `verify.mjs` checks against **what is on disk**, so it stays
  green for them and turns red the moment a slot gains an AVIF the markup
  does not offer.

  That last point is not decoration. The markup edit was generated by a regex
  over the HTML, and it silently skipped a `<source>` whose attributes ran
  `media` before `srcset` — 28 WebP sources, 24 rewritten, 3 reported, and one
  never seen at all. It needed no AVIF, so nothing broke. **Assert coverage
  against the filesystem, never against the pattern that wrote the markup.**

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
- **`main.js` is 59% inert on the content pages, and splitting it is declined
  on evidence rather than on the rule above.** Measured 2026-08-13: the file is
  105,189 B raw / **35,614 B gzip**. The eight homepage-only sections — hero,
  gallery + lightbox, phone strip, showreel, testimonial slider, cost-page
  glimpse, services carousel, scroll reveal — are 61,985 B raw / **20,770 B
  gzip**, and none of the six content pages carries a single DOM hook for any
  of them. A split would leave those pages 15,778 B gzip instead of 35,614.

  It is still not worth doing yet, for three measured reasons:

  - **The dead sections do no runtime work.** Instrumented in Chromium:
    `delivery.html` attaches **3 observers, 74 listeners and 0 intervals**
    against the homepage's **31, 138 and 1**. Every one of them bails on a
    null query. There is no leaked observer and no stray timer to fix.
  - **`main.js` is deferred**, so those 20 KB land after the page is usable.
    They are not on the critical path.
  - **Nobody knows whether these pages get traffic**, because Analytics is
    shipped and not switched on. Refactoring 2,054 lines that 270 assertions
    depend on — with `AMORA_LOCK`, `measure()`, `waLink` and `carryCampaign`
    crossing the boundary — before knowing whether anyone visits, is the wrong
    order of operations.

  Revisit when Analytics shows real traffic on the content pages. The numbers
  above are the starting point; do not re-measure them.

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

- **The lead form is TWO STEPS, and the split point is the database's, not a
  designer's.** Step 1 is name + phone; step 2 is date, type, email, area,
  coverage, message. Asked in that order because `public.leads` has **`name`
  and `phone` NOT NULL** (with length CHECKs on both) while `event_date` and
  `event_type` are nullable — so those two are the only pair that can stand
  alone as a row. A "date first" step reads better as marketing and is
  unbuildable: the partial row violates `name NOT NULL`. Verified against the
  live database on 2026-08-13, not against `docs/`.

  **One INSERT, in both paths.** Finish step 2 → the full payload on submit.
  Press the step-1 button and then leave → the same payload, minus what was
  never typed, on `pagehide`/`visibilitychange` with `keepalive`, its `source`
  **prefixed** `חלקי · ` (prefixed and not appended, because `leadSource()`
  already returns a 200-char slice and an overflow fails the whole row).
  `anon` has **no UPDATE grant at all**, so insert-then-enrich does not exist
  as an option. `buildPayload()` is the only place a Supabase row is built, so
  the column list cannot fork — and `LEADS_PATH` sits **above** it on purpose:
  `check.sh` finds the payload by searching for `/rest/v1/leads` followed by
  the first `payload = {`, and moving either one silently prints
  `לא נמצא ה-payload` instead of checking the grant.

  **`armed` is the consent gate and is the load-bearing part.** The exit write
  fires only for someone who actually pressed a button that says we will get
  back to them. Someone who typed and closed the tab is never written.
  `privacy.html` states all three cases in as many words.

  **The accepted defect, deliberately not fixed:** background the page after
  step 1, return, and finish → two rows and two alert emails, same phone,
  minutes apart, the second complete. Latching the partial as final instead
  would discard the name, type and message they went on to type. Do **not**
  "fix" it by listening to `pagehide` alone — Chrome on Android discards
  backgrounded tabs without firing it.

  Sixteen assertions in `verify.mjs` hold this up, and two of them were
  mutation-tested rather than trusted: deleting the `armed` gate and deleting
  the `partialSent` latch each turn one red. That is the standing lesson of
  the FAQ byte-lock below — **a guarantee written in this file is not a
  guarantee that runs.**

  The submit button carries **three label spans** (`next` / `send` /
  `sending`) instead of a rewritten `textContent`. The old code wrote the
  literal `'שולחים…'` over whatever the button said, which injected Hebrew
  into an EN/AR/RU page and then tripped `i18n.js`'s MutationObserver — a live
  defect on every translated page, removed by this change.

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

  ~~**The campaign is off**, and the last `6821619` run was 4.8 18:27~~ —
  **both halves were wrong by 2026-08-13, and the correction matters more than
  the original claim did.** Make's execution log shows scenario `6821619`
  running **every day** since — 6.8, 7.8, 8.8, 9.8, 10.8, 11.8 (four times),
  12.8, and 13.8 at 00:17 — all status 1. Meta leads are arriving daily. The
  scenario was also renamed on 10.8 to **"אמורה — לידים פייסבוק ← HubSpot +
  אוריגמי + WhatsApp"**: HubSpot is now a second destination alongside Origami,
  which no document in this repo describes and which sits awkwardly beside the
  standing "do not duplicate Origami" rule. Ask before building against either.

  `fld_1519` was mapped 5.8 12:45, so leads from 6.8 onward should carry a Meta
  id — the old blocker ("no lead in Origami carries one") has most likely
  cleared itself. **Re-check before planning CAPI work on the assumption that
  it hasn't.**

  Three executions failed on 10.8 with `The string supplied did not seem to be
  a phone number` (one surfacing as Origami's `fld_1509/טלפון - פורמט מספר
  טלפון לא חוקי`). They cluster around the owner's own edits that day and
  everything since 10.8 19:34 succeeds, but a phone-parse failure is a lead
  that fell through the floor, and it is not recorded whether those three were
  recovered.

  This entry is the third in this file to have been confidently wrong about
  production. The lesson is the one already written above it: **status is not
  knowable by reading anything.** Ask the live system.

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

  ~~**Still unverified:** whether Gmail recorded `SPF=PASS` / `DKIM=PASS`~~ —
  **it was verified, and this entry did not know.** `docs/chrome-agent-tasks.md`
  records the result in its own status table: **SPF PASS, DKIM PASS, and no
  DMARC record at all.** A browser agent read it out of "show original" in the
  mailbox. The DMARC gap is the part that is still open, and it is a decision
  about the business's mail rather than a provider setting — same reasoning as
  the missing apex SPF below.

  Worth naming the pattern rather than just the fact: this is the fifth claim in
  this file to have been stale about production, and the answer was sitting in
  another file in the same repo. **Before writing "unverified" here, grep
  `docs/` for it.**

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
- ~~**The photographs themselves.**~~ — **done, 2026-08-11, and the route is
  the reusable part.** Twenty-two of the twenty-four image slots now serve the
  studio's own 2400px frames. See "The drop zone" below for how they got here
  and how to do it again.
- **Two slots the drop could not fill, and the reason is the studio's diary,
  not an oversight.** `g08` (חופה בשקיעה, 21:9) — both weddings in the library
  had night ceremonies, and the only wide frames from the טקס carry an MC with
  a microphone and a crew member in shot. `g10` (עיצוב שיער) — the prep
  coverage has makeup, jewellery and mirrors but no hair stylist working.
  Both still serve their Instagram-era derivatives, which is why
  `build-assets.mjs` had to learn to keep a slot rather than drop it. Fixing
  them needs a sunset ceremony and a hair frame from a future wedding, not
  another pass over what exists.

### The four contradictions — all resolved

The first three were aligned to what the site already said elsewhere, rather
than to a new promise. The fourth — the photographer count, below — is the one
exception and the more dangerous shape: it could not be settled from inside the
repo, because the repo was self-consistent and *wrong*. It took the owner's
word. Each carries an HTML/JS comment at the site of the change saying what it
used to say and why it moved.

- **The album.** Process step 04 and `assistant.js` both put the printed album
  inside 30 days, while the FAQ, the FAQPage JSON-LD and `cost.html` put it two
  weeks after the selection is approved. The two outliers were changed, not the
  FAQ: the FAQ answers are byte-locked to the JSON-LD by `check.sh`, and the
  JSON-LD is what Google surfaces.
- **The film length.** The film section was titled "חתונה אחת, שלוש דקות" while
  four other places say 3–5 דקות. Retitled "חתונה אחת, סרט אחד". `assistant.js`
  names the section in its answer and changed with it; "שלוש דקות" stays in its
  keyword list, because that is still what a visitor might type.
- **`+500 זוגות מאושרים`** → **`שלושה צלמים בחתונה מלאה`**, in the trust bar.
  Nothing in the repo supported the count, and `assistant.js` carries a
  no-counts policy that contradicted it — the same objection that removed the
  testimonial portraits. The replacement is backed by the FAQ and `cost.html`
  and is a sharper differentiator anyway, since most studios sell the second
  shooter as an upgrade. **If the studio can stand behind the number, putting
  it back is one line** — the old text is in the comment above it.

### The crew is three, and it took a fourth contradiction to settle it

**Owner-confirmed 2026-08-11: three photographers at a full wedding — two on
stills, one on video.** The site had said **two** (one stills, one video)
everywhere since launch. Two owner documents in Google Drive disagreed with
that and with each other: the landing-page brief (`אמורה | באנר + דף נחיתה`,
Nov 2025, a marketing contractor's) lists "3 צלמים מקצועיים - וידאו וסטילס",
while the newer quote (`הצעת מחיר Amora+Regaflash חתונה מעודכן V2`, Jun 2026,
the studio's own) specifies "צוות של 2 צלמי סטילס מקצועיים". Both are true at
once — two stills plus one video is three bodies — and that reconciliation is
what the owner confirmed.

**This was NOT a one-line change, and the reason is worth keeping.** The count
was never only a number: the site told a *two-person* story in the grammar
itself. `שנינו מצלמים ביחד` — the dual — ran in the about section, the
`about` assistant answer and the video FAQ; `אחד על הסטילס ואחד על הווידאו`
and `שניהם על הזוג משתי זוויות` ran in four more. Changing `2`→`3` and
stopping would have left the page contradicting itself in the same screen.
Nine places moved together, and they are the places to move again if it ever
changes: the trust bar, the meta description, the services card, the about
paragraph, **both** copies of **two** different FAQ answers (the visible
`.faq__a` and its byte-locked FAQPage twin — `check.sh` compares them), the
`cost.html` prose and its inclusions list, `llms.txt` (Hebrew **and** the
English summary, which said "A two-person … studio"), `assistant.js`
(`photographers` and `about`), and `admin.js`'s default contract line.

Two follow-ons that are easy to miss. `tools/verify.mjs` pinned the string
`אחד על הסטילס` in two assistant rows — the only runtime assertion that the
assistant quotes the same headcount as the page — and now pins
`שניים על הסטילס`; it was re-pinned rather than loosened, on purpose. And
`assistant.js` **keeps `שני צלמים` as a matcher key** alongside the new
`שלושה צלמים`: the answer changed, the question a visitor types did not, and
someone who read the old copy still asks for a "צלם שני".

`sitemap.xml` needed regenerating afterwards (`tools/gen-sitemap.py`) —
`check.sh` catches this, and it is the reminder that the file is generated.

## The security wave — 2026-08-17

A hardening pass. Three audit agents mapped the whole surface; a live
`get_advisors` run settled the one thing the repo cannot prove. The headline
finding is reassuring and worth keeping: **`public.leads` has RLS ON and anon is
INSERT-only** on the live project, so the CRM's confidentiality does not hinge on
an unverifiable belief — it was checked. The client side was already clean (every
lead field rendered through `textContent`+strip-bidi, no `innerHTML` sink is
attacker-reachable, the translate/assistant responses land as text, every
`target=_blank` carries `noopener`). The real gaps were in the two
anonymous-by-design edge paths and in the HTTP headers. What shipped:

- **HTTP headers (`vercel.json`, global block):** added
  `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy:
  same-origin`, `X-Permitted-Cross-Domain-Policies: none`. **COEP was NOT added —
  it breaks the YouTube hero** (a cross-origin frame under `require-corp` must
  opt in, and youtube-nocookie does not). **`frame-ancestors` stays `'self'`, not
  `'none'`** — the homepage embeds `camera-3d.html?embed=1` same-origin, and
  `'none'` would blank that hero. HSTS `preload` is still a standing owner
  decision, deliberately not added.
- **`_headers` was resynced** to mirror the full set (it was a minimal subset, so
  a Netlify/CF migration would have silently stripped CSP+HSTS). It is dead on
  Vercel; `check.sh` now asserts it still carries CSP and HSTS so it cannot rot.
- **`.well-known/security.txt`** (RFC 9116) with a `/security.txt` redirect.
  `check.sh` fails the build once `Expires` lapses — a live reminder, so **bump
  the date when it nears** (currently 2027-11-30).
- **`translate` function — deployed (v8), live-verified.** The cache key is now
  **derived from the source ON THE SERVER** (`sha256Hex(norm(s))`); the caller's
  `h` is ignored. This kills two unauth attacks at once — PostgREST filter
  injection through `h` into the service-role query, and cache poisoning by
  seeding a real string's key. `norm` is idempotent and matches the client, so
  the 821 warm rows still hit (proved live: a probe with a malicious `h` returned
  200 and the correctly-derived cache hit). CORS is **origin-locked** to the
  amora domains (was `*`, the vector that defeats per-IP limiting), provider
  error bodies are **no longer reflected** to anonymous callers, and a **global
  per-minute model-spend ceiling** (`public.translate_take`, 600 items/min) caps
  cost during a burst — fail-open, so a meter hiccup never breaks the page.
- **`lead-alert` function — deployed (v13), live-verified end to end.** It now
  **fails closed** if no shared secret is configured (was: silently skipped the
  check — an open email relay), and a **global send-rate ceiling**
  (`public.lead_alert_take`, 20/min) stops a flood of anon inserts becoming a
  flood of email; the leads still land in the CRM. **The secret moved into
  `private.settings.lead_alert_secret`**, read via a service_role-only RPC — the
  same pattern as `lead_alert_to/from`. That is what made fail-closed safe with
  ZERO dashboard step and zero broken window: the value stored is the one the
  trigger already sends, so the function's expected secret matches by
  construction. Verified: correct secret → 200, no secret → 403, and a real test
  insert delivered `sent:true, recipients:2` before the row was deleted.
- **Two new meter tables** (`translate_meter`, `lead_alert_meter`) — RLS on, no
  policy, no anon/authenticated grant (deny-all, service_role only). They show as
  `rls_enabled_no_policy` INFO in the advisor **on purpose**, exactly like
  `private.settings` and `public.admins`. Not a finding. SQL in
  `docs/supabase-rate-limits.sql`; the secret RPC in `docs/supabase-meta-capi.sql`
  (value never committed — it lives only in the live `private.settings`).

**Wave 2 (same day) closed the last edge gap and proved the two "owner" items
are not mine to do:**

- **`lead-intake-google` — deployed, live-verified.** It cached NOTHING: every
  request, including an unauthenticated flood, ran one `google_lead_webhook_key`
  RPC before the key was even checked. It now caches the key per-instance (the
  meta-capi/lead-alert pattern), rejects a body over 64 KB before parsing, and
  caps `user_column_data` at 60 columns. Verified live via `net.http_post`: a
  wrong key returns 403, a correct-key `is_test` insert landed and was deleted.
- **`check.sh` +1 guard (→ 32):** no secret-shaped literal (`eyJ…` JWT,
  `sk-ant-`, `sb_secret_`, `re_…`, `sk_live_`) may appear in
  `supabase/functions/**`. They all read from `Deno.env`; this keeps them that
  way now that the functions deploy live from the repo. Mutation-tested.
- **Reliability bug found while verifying (fixed).** Live-testing the hardened
  `lead-intake-google` surfaced a pre-existing defect it did not cause: the
  `leads_external_id_key` index was **partial** (`WHERE external_id IS NOT
  NULL`), and PostgREST's `on_conflict=external_id` cannot infer a partial
  index — so every insert failed `42P10` and **every Google Ads lead was
  silently dropped** (Google retries a 502, gets 502 again, gives up). Fixed to
  a **full** unique index (`docs/supabase-crm-pipeline.sql`): still allows
  multiple NULL external_ids (website/WhatsApp leads — NULLs are distinct), and
  now `ON CONFLICT` infers correctly. Verified live: correct key + `is_test` →
  200 and a row landed, then deleted. The webhook key was configured in
  `private.settings`, so this had been costing real leads.

**Still open, owner-only — I checked, and I genuinely cannot do these:**

- **Leaked-password protection is OFF** in Auth (advisor WARN). One dashboard
  toggle (Authentication → Policies / Password), and these are the CRM admin
  credentials — worth enabling. **There is NO Supabase MCP tool that edits Auth
  config**, so this one is the owner's click, not mine.
- **`pg_net` is installed in `public`** (advisor WARN). **Cannot be moved, and
  now with proof:** `pg_net.extrelocatable = false` (checked live), so
  `ALTER EXTENSION … SET SCHEMA` errors; the only "move" is drop+recreate, which
  destroys the `net` schema the lead-alert trigger's `net.http_post` depends on.
  Leaving it is the correct call, not a deferral.
- **`is_admin()` is callable by `authenticated`** via RPC (advisor WARN). Benign:
  it returns a boolean about the caller and `authenticated` needs EXECUTE for the
  read policy. Left as-is.
- The three retired probe functions (`capi-read`, `meta-capi-probe`,
  `lead-alert-probe`) are already 410 stubs touching no secret — safe to delete
  from the dashboard whenever (the MCP has no delete), no rush.

Across both waves `check.sh` grew 27 → 32 (every guard mutation-tested).
`verify.mjs` is unchanged at 270 — no client DOM was touched. No honeypot was
added to the form: it does not stop a direct POST (the real vector), and it would
complicate the 8-copy form parity and the `privacy.html` enumeration; RLS + the
rate ceilings already contain the impact.

## Before any deploy

```bash
tools/set-site-url.sh https://the-real-domain
tools/check.sh          # must exit 0
```

`check.sh` fails on purpose while `SITE_URL` is still a placeholder.

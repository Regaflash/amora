# Amora Studio — project memory

## ⚑ Fresh session? Read this first

The site is **live at https://www.amora-studios.com**, on Vercel, on the
owner's domain. SITE_URL has been replaced everywhere it appears (canonical,
og:url, JSON-LD, sitemap.xml). The lead form is wired to Supabase and the
private CRM at `admin.html` reads it back.

```
Before any change goes out:
1. tools/check.sh          # must exit 0 — 19 checks + a phone-format count
   node tools/verify.mjs   # must exit 0 — 24 runtime checks in a real browser
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
- **Vercel** — connected to that GitHub account, **and holds the domain**.
  This is where the site is hosted. Deploys should target Vercel.
- **Supabase** — connected to the same GitHub account. Available as the
  backend for the lead form (see `docs/supabase-leads.sql`).

Because the host is Vercel, header rules live in **`vercel.json`**, not in
`_headers` — Vercel does not read Netlify/Cloudflare's `_headers` format. The
`_headers` file is kept only so the site stays portable to those hosts.

### Known access limits from this environment

- The Claude GitHub App does not have access to `Regaflash/amora`, so `add_repo`
  fails and the repo cannot be pushed to from here. The owner pushes from their
  own machine, or grants access at github.com/settings/installations.
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
- Testimonial portraits were deliberately removed: they showed real people who
  had not said the quoted words. Do not re-add without written permission.
- The hero streams the studio's real footage from YouTube — `2DHdORDXVmo`
  (showreel, landscape) and `3O13FGO_f08` (vertical Short), chosen by viewport
  orientation. There is no local hero video and no `assets/video/`. This is the
  only third-party request the site makes on load; it was the owner's call,
  `privacy.html` states it, and `frame-src` in `vercel.json` names the two
  origins. The film section further down still asks before it loads.
- There are seven pages, not two: `index.html`, `camera-3d.html`,
  `accessibility.html`, `privacy.html`, `terms.html`, `404.html` and
  `admin.html` (the private lead CRM — noindex, no-store, its own enforcing
  CSP, absent from both sitemap.xml and robots.txt on purpose). The
  accessibility widget and the site assistant load on every public page.
  `404.html` is served by Vercel AT the address that was not found, so every
  asset it references must stay root-absolute — a relative href resolves
  against the dead path. That is a real bug that has already happened once.
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

## Still outstanding, owner-supplied only

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
- **Google Search Console**, verified by DNS TXT in the Vercel dashboard —
  zero repo change, zero deploy. Until it exists nobody can measure whether any
  of the search work is working.
- **A business email.** There is no `mailto:` anywhere in the six HTML pages.
- Venue names, dated real weddings, and written confirmation that the three
  testimonials may be attributed. This is what unblocks service-area and
  case-study pages, and nothing else does.

### Three contradictions live on the site — the owner must pick

- **The album.** `index.html:711` says inside 30 days. The FAQ, the FAQPage
  JSON-LD and `assistant.js` all say two weeks after the selection is approved.
  Three against one, but it is a customer promise, so it is not ours to change.
- **The film length.** `index.html:650` says שלוש דקות; the FAQ and the JSON-LD
  say 3–5 דקות.
- **`+500 זוגות מאושרים`** (`index.html:321`). Nothing in the repo supports it,
  and `assistant.js:54-57` carries a no-counts policy that contradicts it. Same
  class of problem as the testimonial portraits that were removed for showing
  people who had not said the quoted words.

## Before any deploy

```bash
tools/set-site-url.sh https://the-real-domain
tools/check.sh          # must exit 0
```

`check.sh` fails on purpose while `SITE_URL` is still a placeholder.

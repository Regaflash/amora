# Amora Studio — project memory

## ⚑ Fresh session? Read this first

The site is **live at https://www.amora-studios.com**, on Vercel, on the
owner's domain. SITE_URL has been replaced everywhere it appears (canonical,
og:url, JSON-LD, sitemap.xml). The lead form is wired to Supabase and the
private CRM at `admin.html` reads it back.

```
Before any change goes out:
1. tools/check.sh          # must exit 0 — 14 checks, see tools/README.md
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
- There are six pages, not two: `index.html`, `camera-3d.html`,
  `accessibility.html`, `privacy.html`, `terms.html` and `admin.html` (the
  private lead CRM — noindex, no-store, its own enforcing CSP, absent from
  both sitemap.xml and robots.txt on purpose). The accessibility widget and
  the site assistant load on every public page.

## Still outstanding, owner-supplied only

- A photo of the team at work — the `about` slot is a stand-in, and the section
  text talks about "the two of us" with no name or face anywhere on the site.
- Legal review of `accessibility.html`, `privacy.html` and `terms.html` (all
  three are drafts with `[להשלים]` markers and a visible banner).
- A logo master of 512px or more. `assets/img/logo.jpg` is 150×150, so the
  180 and 192 icons `tools/make-icons.mjs` produces are upscaled from it.
- A Google Business Profile.

## Before any deploy

```bash
tools/set-site-url.sh https://the-real-domain
tools/check.sh          # must exit 0
```

`check.sh` fails on purpose while `SITE_URL` is still a placeholder.

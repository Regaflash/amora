# Amora Studio — project memory

## ⚑ Fresh session? Read this first

The site is **finished and verified**. It has never been deployed. The one
remaining job is to put it live on Vercel.

```
1. Confirm the Vercel connector's tools are loaded (deploy_to_vercel etc.).
2. Deploy this directory. vercel.json and .vercelignore are already correct —
   do not add a build step, this is a static site with no dependencies.
3. Report the live URL, then FETCH IT and check it actually renders: images
   load, the hero loop plays, the gallery filters, the form validates.
4. Once there is a permanent domain:
      tools/set-site-url.sh https://<domain>
      tools/check.sh            # must exit 0
   then redeploy. SITE_URL sits in canonical, og:url, JSON-LD and sitemap.xml;
   until it is replaced, WhatsApp shares show no image and Google cannot read
   the FAQ schema.
5. Optional, if the Supabase connector is also loaded: run
   docs/supabase-leads.sql, then set supabaseUrl / supabaseKey in the CONFIG
   block at the top of assets/js/main.js, redeploy, and submit a real test
   lead to confirm it lands in the `leads` table.
```

Do not re-audit or re-verify the build. That work is done and documented below.


## Infrastructure (standing context — do not re-ask)

The owner's accounts are already wired together:

- **GitHub** — `Regaflash/amora` (private). Holds the studio's photo library at
  the repo root (86 files, Instagram-style filenames).
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
- The hero loops are stand-ins generated from stills. Real footage exists on
  YouTube (`3O13FGO_f08` — vertical Short, `2DHdORDXVmo` — the showreel, already
  embedded in the film section) but could not be downloaded from here.

## Still outstanding, owner-supplied only

- Real hero footage (vertical + landscape).
- A photo of the team at work — the `about` slot is a stand-in, and the section
  text talks about "the two of us" with no name or face anywhere on the site.
- Legal review of `accessibility.html` and `privacy.html` (both are drafts with
  `[להשלים]` markers).
- A Google Business Profile.

## Before any deploy

```bash
tools/set-site-url.sh https://the-real-domain
tools/check.sh          # must exit 0
```

`check.sh` fails on purpose while `SITE_URL` is still a placeholder.

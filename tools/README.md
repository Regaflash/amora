# tools

Build and maintenance scripts. None of them ship to the browser — `tools/` is
in `.vercelignore` and the site itself stays dependency-free. They need `sharp`
(images), `ffmpeg` (video), and `playwright-core` + `pngjs` (verification):

    npm i sharp playwright-core pngjs

## The two checks

`check.sh` reads the files. `verify.mjs` drives the real site in a real browser
and asserts what a visitor can observe. They catch different things and neither
replaces the other — the focus ring once went invisible at 1.00:1 with entirely
valid CSS, and no amount of reading the stylesheet would have found it.

    tools/check.sh          # 21 assertions + a phone-format count, must exit 0
    node tools/verify.mjs   # 263 runtime assertions, must exit 0

Those numbers said 19 and 28 until 2026-08-13, when they were re-counted
against **what the scripts actually print**. The gap had grown large enough to
mislead: a session that reads "28" and watches 263 assertions scroll past
concludes it is running the wrong tool.

Count them by running them, not by grepping them. `grep -c "ok(" verify.mjs`
undercounts and is **wrong** — several `ok()` calls sit inside loops, and the
suite's own closing line is the only honest total. `check.sh` prints 22 lines,
but one of them (`פורמטי טלפון בשימוש`) reports a number without ever setting
`fail`, so it is a count and not an assertion. **When you add one, change the
number in the same commit** — here and in `CLAUDE.md`, which carries the pair.

| file | what it does |
| --- | --- |
| `build-assets.mjs` | Regenerates every derivative in `assets/img/` from a source folder. The slot → source mapping is the `SLOTS` array at the top — edit it to swap a photo. |
| `manifest.json` | What the last run produced: slot, source file, source dimensions, output widths. |
| `index.json` | The numbered index of the source library that `SLOTS` refers to. |
| `hero.mjs` | **Obsolete.** Built the stand-in hero loops from stills. The hero now streams the studio's YouTube footage, there is no `assets/video/`, and this script still points at paths from the sandbox it was written in (`./amora-media`, `.ffpath`). Kept only as a record of how the stand-ins were made. |
| `encode-hero.sh` | Encodes a hero loop from real footage. `./encode-hero.sh wide clip.mp4` |
| `dedupe.mjs` | Perceptual duplicate finder for a source folder. |
| `sheet.mjs` | Contact sheets, for choosing photos. |
| `set-site-url.sh` | Replaces the `SITE_URL` placeholder. **Run once before going live.** |
| `check.sh` | Static consistency checks. Run before deploying — must exit 0. |
| `verify.mjs` | Runtime checks in Chromium: keyboard and focus behaviour, live regions, the form with JS disabled, WCAG 2.2 target sizes, Core Web Vitals, composited-pixel contrast, the 404, and the CRM's escaping of hostile lead data. Supabase is stood in for with route fulfilment, so it runs offline and touches no real data. Must exit 0. |
| `gen-sitemap.py` | Regenerates `sitemap.xml` from each page's own robots meta, git dates and the homepage's alt-bearing photographs. `--check` fails if stale. |
| `gen-image-schema.py` | Regenerates the `ImageGallery` JSON-LD in `index.html` from the gallery markup. `--check` fails if stale. |
| `make-icons.mjs` | Regenerates `favicon.ico` and the PNG icon set from `assets/img/logo.jpg`. |
| `anchors.sh` | Given a JSON array of `{file, find, replace}` patches, checks each `find` matches exactly once. |

## Swapping a gallery photo

1. Edit the `SLOTS` entry in `build-assets.mjs` (`n` is the index in `index.json`).
2. `node tools/build-assets.mjs`
3. Update `data-alt` on the matching `.masonry__btn` in `index.html` if the subject changed.

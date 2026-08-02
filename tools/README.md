# tools

Build and maintenance scripts. None of them run in the browser — the site
itself stays dependency-free. They need `sharp` (images) and `ffmpeg` (video):

    npm i sharp

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
| `check.sh` | Consistency checks. Run before deploying — must exit 0. |
| `make-icons.mjs` | Regenerates `favicon.ico` and the PNG icon set from `assets/img/logo.jpg`. |
| `anchors.sh` | Given a JSON array of `{file, find, replace}` patches, checks each `find` matches exactly once. |

## Swapping a gallery photo

1. Edit the `SLOTS` entry in `build-assets.mjs` (`n` is the index in `index.json`).
2. `node tools/build-assets.mjs`
3. Update `data-alt` on the matching `.masonry__btn` in `index.html` if the subject changed.

# tools

Build and maintenance scripts. None of them run in the browser — the site
itself stays dependency-free. They need `sharp` (images) and `ffmpeg` (video):

    npm i sharp

| file | what it does |
| --- | --- |
| `build-assets.mjs` | Regenerates every derivative in `assets/img/` from a source folder. The slot → source mapping is the `SLOTS` array at the top — edit it to swap a photo. |
| `manifest.json` | What the last run produced: slot, source file, source dimensions, output widths. |
| `index.json` | The numbered index of the source library that `SLOTS` refers to. |
| `hero.mjs` | Builds the hero loops from stills. Only needed while the hero is a stand-in. |
| `encode-hero.sh` | Encodes a hero loop from real footage. `./encode-hero.sh wide clip.mp4` |
| `dedupe.mjs` | Perceptual duplicate finder for a source folder. |
| `sheet.mjs` | Contact sheets, for choosing photos. |
| `set-site-url.sh` | Replaces the `SITE_URL` placeholder. **Run once before going live.** |
| `check.sh` | Consistency checks. Run before deploying. |

## Swapping a gallery photo

1. Edit the `SLOTS` entry in `build-assets.mjs` (`n` is the index in `index.json`).
2. `node tools/build-assets.mjs`
3. Update `data-alt` on the matching `.masonry__btn` in `index.html` if the subject changed.

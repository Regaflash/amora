# Amora Studio

אתר תדמית לסטודיו צילום וידאו וסטילס לחתונות ואירועים — תל אביב.
Static site, RTL Hebrew, no build step and no dependencies.

Implemented from the Claude Design handoff bundle in [`project/`](project/) —
see [`docs/handoff.md`](docs/handoff.md) for the original brief and
[`chats/`](chats/) for the design conversation.

## Running it

Any static file server will do — the pages use relative paths only:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

Opening `index.html` straight off the filesystem mostly works, but the `#gear`
section's `<iframe>` and the three.js module imports need `http://`.

## Layout

```
index.html                  homepage — all 11 sections
camera-3d.html              standalone 3D camera viewer (also embedded in #gear)
assets/
  css/styles.css            every style; no inline styles left
  js/main.js                header, gallery, lightbox, carousel, FAQ, form, reveal
  js/camera-model.js        the camera model, built from named three.js meshes
  js/three-d-stage.js       <three-d-stage> web component (vendored, unmodified)
  img/logo.jpg
project/                    original Claude Design prototype (reference)
chats/                      design conversation transcript
docs/handoff.md             the bundle's original README
```

## Sections

Hero · trust bar · about · services · gallery · film · **3D gear viewer** ·
process · testimonials · FAQ · contact form · footer.

## Media

The photography is wired in — 27 `<picture>` elements, WebP with JPEG fallback,
two widths each, `srcset` + `sizes`, lazy-loaded below the fold. Source images
came from the studio's own library (78 unique frames after de-duplication).

Derivatives live in `assets/img/` and are generated, not hand-made. Slot → source
mapping is in `manifest.json` alongside the build script.

| Slot | Ratio | Notes |
| --- | --- | --- |
| `about-*` | 4:5 | **Stand-in.** No team/behind-the-scenes photo was available |
| `svc-*` | 4:5 | Five service cards |
| `g01`–`g18` | 4:5 / 16:9 / 21:9 | Gallery; `data-cat` drives the filter |
| `avatar-1..3` | 1:1 | Testimonial portraits — **not the actual couples quoted** |
| `cta` | 21:9 | Full-bleed contact background |
| `film-poster` | 16:9 | Showreel poster frame |

### The hero loop

Two encodes, chosen at runtime by viewport shape — a phone held upright gets a
9:16 loop, everything else gets 16:9. Neither is a centre-crop of the other.

| | |
| --- | --- |
| `hero-wide-poster.jpg / .webp` | 1280×720 — the hero still, and the fallback whenever the video cannot load |
| `hero-vertical-poster.jpg / .webp` | art-directed portrait cut of the same |

`<source media>` is only evaluated when a `<video>` loads, never on resize, so
the choice is made in JS (`initHero` in `main.js`) and redone if the viewport
crosses the boundary. Each viewport downloads exactly one file.

The loop does **not** play when `prefers-reduced-motion` is set, when
`navigator.connection.saveData` is on, or on a 2g connection — in all three
cases the poster alone stands as the hero. It also pauses when the tab is
hidden or the hero scrolls out of view. Autoplay refusal (iOS Low Power Mode)
degrades to the poster.

**These are placeholders built from the studio's stills** — a slow push-in with
crossfades, generated from photos, not real footage. Replace them with the real
thing via `tools/encode-hero.sh wide <file>` and `... vertical <file>`; no
markup changes needed.

Text legibility over the loop is measured, not eyeballed: worst-case contrast
across every frame is 6.5:1 (desktop) and 5.5:1 (mobile) against `#FFFDF9`.
The `.hero__scrim` ellipse is what buys that — with the design's original
linear wash alone it was 2.2:1, and the headline disappeared into the veil.
If you swap in a brighter source, re-check it.

Wide slots (16:9, 21:9) were filled from square sources cropped horizontally —
the library had exactly one landscape frame. Scenes were chosen so the crop
works (venue, dance floor, table settings) rather than cropping portraits.

## The lead form

Collects name, phone, date, event type, area and coverage, plus a honeypot.
Validates client-side, then:

- **With `CONFIG.formEndpoint` set** — POSTs JSON with a 12s timeout. A failure
  shows a real error and offers the same details over WhatsApp, so a network
  blip never loses a lead.
- **With it empty (the default)** — hands the completed details to WhatsApp as
  a formatted message. It does **not** show a thank-you for a message that was
  never sent. The site never tells a visitor it received something it didn't.

To go live with email delivery, set `formEndpoint` (and `formKey` for
Web3Forms) at the top of `assets/js/main.js`.

## Before going live

```bash
tools/set-site-url.sh https://your-domain.co.il   # fills the SITE_URL placeholder
tools/check.sh                                    # assets, WebP sizes, JSON-LD, externals
```

Deploy **only** `index.html`, `camera-3d.html`, `accessibility.html`,
`privacy.html`, `robots.txt`, `sitemap.xml`, `_headers` and `assets/`.
`project/`, `chats/`, `docs/` and `tools/` are repo-only — `project/` is a
near-duplicate of the homepage and would compete with it in search.

`accessibility.html` and `privacy.html` are **drafts**. Both carry a visible
banner saying so and contain `[להשלים]` markers for the business name,
accessibility officer, email and retention period. Have a lawyer review them.

## The 3D viewer

`camera-3d.html` renders a rangefinder camera built from ~35 named three.js
meshes, with orbit controls and OBJ/GLB export. The homepage embeds it via
`camera-3d.html?embed=1`, which hides the page chrome and lets the stage fill
the frame.

three.js is **vendored** into `assets/vendor/three/` and resolved through a
local import map — no CDN at runtime. If WebGL is unavailable the stage falls
back to `assets/img/camera-still.jpg` via its `fallback` attribute, so the
section still looks deliberate instead of showing an English stack trace. The
OBJ/GLB toolbar is hidden in the embedded strip and kept on the standalone page.

Model units are real-world metres, y-up, resting on `y = 0`. The stage ships no
environment map, so materials cap `metalness` around 0.3–0.4 and carry the metal
look through base colour instead.

## Configuration

The prototype's three editor props survive as `CONFIG` at the top of
`assets/js/main.js`:

| Key | Default | Effect |
| --- | --- | --- |
| `accent` | `null` | Overrides `--champagne` (and `--line` at 30% alpha) |
| `showFilm` | `true` | `false` removes the showreel section |
| `reveal` | `true` | `false` disables the scroll-in animation |

The full palette lives in `:root` in `styles.css`.

## Notes

- Contact details are wired throughout: `050-3662699`, `wa.me/972503662699`,
  `@amora___studio`. Change them in `index.html`; the WhatsApp number also
  lives in `CONFIG.whatsapp` in `main.js`.
- **Every WhatsApp link opens with a message already written.** The generic one
  is set in `main.js`; override per-link with `data-wa-text`.
- Testimonial portraits were removed — they showed real people who had not said
  the words beside them. The quotes stand on their own; re-add photos only with
  written permission from the couples actually quoted.
- Fonts are self-hosted in `assets/fonts/` (Hebrew + Latin subsets, woff2).
  Nothing is fetched from Google.
- No prices anywhere, by design — the FAQ answer on cost routes to the form.
- `prefers-reduced-motion` disables every animation, transition, smooth scroll
  and the reveal effect.
- Still outstanding and **only the owner can supply**: real hero footage, a
  photo of the team at work (the `about` slot is a stand-in), and a Google
  Business Profile.

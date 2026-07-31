# Amora Studio — integration spec

Four builds are landing in parallel: **CRM admin page**, **accessibility widget**,
**site assistant**, **legal pages**. All four want `index.html` and the same
corner of the screen. This document is the contract that lets them coexist.

Follow it literally. Where it says "exact tag", copy the tag.

---

## 0. Ownership — who may touch what

Every file below has exactly one owner. If your build needs a change in a file
you do not own, ask that owner; do not edit it.

| File | Owner | Everyone else |
|---|---|---|
| `index.html` — floating-control corner (the `.wa-float` block, `<body>` end) | **plumbing** (this spec) | may add **one** `<script>` line in the reserved body slot |
| `index.html` — `<head>` | **plumbing** | may add **one** `<link>` and/or `<script>` in the reserved head slot |
| `index.html` — everything else (sections, form, footer, JSON-LD) | nobody | frozen for this effort |
| `assets/css/styles.css`, `assets/js/main.js` | nobody | frozen — override from your own file |
| `assets/css/dock.css`, `assets/js/dock.js` | **plumbing** | consume via `AmoraDock.register()` |
| `accessibility.html`, `privacy.html`, any new legal page — prose | **legal** | — |
| `admin.html` (or `admin/`) | **CRM** | — |
| `robots.txt`, `sitemap.xml` | **CRM** adds the admin lines, **legal** adds the legal lines | apply serially, §5 |
| `vercel.json` | **plumbing** | tell plumbing what host/asset you added, §6 |
| `tools/check.sh` | **plumbing** | §7.4 |

**Hard rules, all four builds:**

1. No new `position: fixed` element anchored to the bottom edge. The dock is the
   only one. (`.site-header`, `.menu`, `.lightbox`, `.skip-link` already exist and
   are not yours.)
2. No new inline `<script>` anywhere. The CSP in §6 uses hashes; an inline script
   you add will be blocked, and adding `'unsafe-inline'` back to make it work
   would remove the only real XSS defence the assistant has.
3. Never write `document.body.style.overflow`. `main.js` owns it (`setMenu`,
   `openLightbox`, `closeLightbox`) and its `closeLightbox` clear is conditional
   on the menu state — a second writer unlocks a page that is meant to stay locked.
4. Never apply `filter`, `backdrop-filter`, `transform`, `perspective` or
   `will-change` to **`body`**. Any of them turns `body` into the containing
   block for `position: fixed` descendants, which instantly breaks the sticky
   header, the mobile menu, the lightbox **and** the dock. The root element
   `html` is exempt by spec — put contrast/greyscale filters on `:root`.
5. No secret in client code. §8.
6. No prices, no invented reviews, ratings or counts. Applies to assistant
   answers too — the assistant must route cost questions to the contact form,
   exactly as the FAQ does.

---

## 1. What is actually there today (measured, not assumed)

**`.wa-float`** — `index.html` lines 827–830, immediately after `</footer>`,
before the lightbox and before `<script src="assets/js/main.js">`:

```html
<a class="wa-float" data-wa href="https://wa.me/972503662699" target="_blank" rel="noopener" aria-label="שליחת הודעה בוואטסאפ">
  <span>וואטסאפ</span>
</a>
```

`styles.css:1119` —

```css
.wa-float { position: fixed; bottom: 20px; left: 20px; z-index: 70;
            display:flex; align-items:center; gap:8px; padding:14px 20px;
            background: var(--champagne); color:#1C1A18; border-radius:2px;
            box-shadow: 0 6px 24px rgba(28,26,24,.18);
            transition: opacity 400ms, transform 400ms;
            opacity:0; transform: translateY(14px); pointer-events:none; }
.wa-float.is-visible { opacity:1; transform:none; pointer-events:auto; }
```

Facts that matter:

- **Physical `left: 20px`**, not `inset-inline-start`. In `dir="rtl"` that is the
  inline-**end** side — the idiomatic chat-widget corner for Hebrew. Keep it.
- **Rendered box ≈ 98 × 51 px** (13px Heebo, line-height 1.8, 20px side padding).
- **No media query touches it.** Identical at every breakpoint. The site's only
  breakpoint is `@media (max-width: 760px)` (nav swap).
- **It is invisible until 30 % scroll.** `main.js:114` toggles `.is-visible` from
  `onScroll` at `WA_THRESHOLD = 0.3`. It is `opacity:0` + `pointer-events:none`,
  **not** `display:none` — so it always occupies layout.
- `main.js` caches the node (`waFloat = $('[data-wa]')`, line 92) and rewrites its
  `href` with a pre-written Hebrew opener (line 72). **The node must be re-parented,
  never cloned or recreated**, or both are lost.

**z-index ladder as shipped** (`styles.css`):

| z | element |
|---|---|
| 2–3 | hero scrim/inner, `.hero__cue`, `.contact__grid` |
| 60 | `.site-header` (fixed, full width, top) |
| **70** | `.wa-float` |
| 80 | `.menu` mobile overlay (`inset:0`, opaque cream) |
| 90 | `.lightbox` |
| 100 | `.skip-link` |

**Other bottom-edge furniture:** `.hero__cue` — `position:absolute; bottom:34px;
left:50%`, ~8 px wide, 62 px tall. `.contact__note` exists in CSS (line 946) but
there is no such element in any page — dead rule, ignore it.

**Pages and what they load today:**

| page | fonts.css | styles.css | legal.css | main.js | notes |
|---|---|---|---|---|---|
| `index.html` | ✔ | ✔ | — | ✔ (end of body, not deferred) | has `.wa-float` |
| `camera-3d.html` | ✔ | — | — | — | **iframed** by index `#gear` as `?embed=1`; sets `.is-embed` on `<html>` synchronously in `<head>`; own inline CSS, no design tokens |
| `accessibility.html` | ✔ | ✔ | ✔ | **—** | no `<script>` at all |
| `privacy.html` | ✔ | ✔ | ✔ | **—** | no `<script>` at all |

The last two are the reason the accessibility widget cannot be bolted onto
`main.js`: it would be absent from the accessibility statement page itself.

---

## 2. The floating-control layout

### 2.1 Decision: one cluster, not three corners

Three independently-positioned fixed controls is the defect this whole effort is
most likely to ship. They become **one rail**, `.am-dock`, in the same corner
`.wa-float` already occupies. One region of the viewport is obscured instead of
two or three, and content-avoidance becomes one problem.

### 2.2 Geometry

```
--am-dock-size : 52px    control side (≥ 44px WCAG 2.5.5)
--am-dock-gap  : 12px    between controls, and rail → panel
--am-dock-edge : 20px    from the viewport edges (unchanged from .wa-float)
--am-dock-clear: calc(52px + 20px + 16px + env(safe-area-inset-bottom, 0px))  = 88px
```

```css
.am-dock {
  position: fixed;
  bottom: calc(var(--am-dock-edge) + env(safe-area-inset-bottom, 0px));
  left: var(--am-dock-edge);
  right: auto;
  z-index: 70;                 /* the slot .wa-float already held */
  display: flex; flex-direction: row; align-items: center;
  gap: var(--am-dock-gap);
  max-width: calc(100vw - 40px);
}
```

**A horizontal row at every breakpoint**, not a column, and not a
collapse/expand toggle. Reasons:

- One layout, no breakpoint for direction, no open/closed state → the smallest
  possible bug surface for the thing most likely to break.
- A column of three is **180 px tall**; a row is **52 px tall**. The footer
  reserve in §2.5 is proportional to that height, and 88 px of extra whitespace
  under the footer is acceptable where 216 px is not.
- Nothing on this site sits at the bottom-left of the *viewport* other than
  `.hero__cue` (checked in §2.6).

A vertical variant is available as `.am-dock--stack` with **no markup change** —
add the class, and bump `--am-dock-clear` per the note at the end of `dock.css`.

### 2.3 Order, and why it is what it is

`AmoraDock` sorts controls by a numeric `order` and **re-inserts the DOM nodes**
in that order. It does **not** use the CSS `order` property, so DOM order,
visual order and tab order are always the same thing. Higher `order` = closer to
the screen corner.

| order | control | owner | position in RTL row |
|---|---|---|---|
| 10 | WhatsApp (adopted `.wa-float`) | plumbing | rightmost — furthest from the corner |
| 20 | site assistant | assistant build | middle |
| 30 | accessibility | accessibility build | leftmost — in the corner |

Leave gaps in the numbering.

Two non-obvious consequences, both deliberate:

- In `dir="rtl"` a plain `flex-direction: row` puts the **first** DOM child at the
  right of the box and the last at the left. The box is anchored `left: 20px` and
  is shrink-to-fit, so it grows rightward. Hence order 30 lands in the corner and
  DOM order still reads right-to-left, which is correct Hebrew reading order. No
  `-reverse`, no `direction` override, no reversed tab order.
- **WhatsApp is deliberately the outermost control, not the corner one.** It is
  invisible below 30 % scroll but still occupies its box. If it sat in the corner,
  the two visible controls would float 110 px away from the corner above the fold,
  which reads as broken. Putting the hole at the outer edge keeps the visible
  controls flush to the corner at all times.

### 2.4 z-index

| z | element | change |
|---|---|---|
| 60 | `.site-header` | unchanged |
| **70** | `.am-dock` rail + all three controls | takes over `.wa-float`'s slot |
| 80 | `.menu` | unchanged |
| **85** | `.am-dock-panel` (accessibility panel, assistant panel) | **new** |
| 90 | `.lightbox` | unchanged |
| 100 | `.skip-link` | unchanged |

Panels sit at 85 — **above** the mobile menu — so a panel is never buried under
an opaque overlay while its own trigger is hidden behind it. The dock also
enforces that the two can't be open at once: opening a panel clicks
`[data-menu-toggle]` if `#mobile-menu` is open, which routes through `main.js`'s
own `setMenu(false)` so body overflow and focus are restored correctly. On pages
without `main.js` there is no menu and nothing happens.

Panels are **non-modal**: focus moves in on open, `Escape` and outside-click close
them, focus returns to the trigger — but Tab is **not** trapped and body scroll is
**not** locked. `main.js`'s focus trap (line 371) only knows about `menu` and
`lightbox`; a trapped dock panel would fight it.

Two details in `dock.js` that are load-bearing and easy to undo by accident:

- **Focus is returned only when it was inside the panel, and that test is taken
  *before* `hidden` is set.** Setting `hidden` on the focused element blurs it
  immediately, so a test taken afterwards always reads `<body>` and the trigger
  never gets focus back. A jsdom test cannot catch this — jsdom does not model
  the blur — so it must be checked in a browser. It also means an outside *click*
  correctly does **not** steal focus back, while `Escape` does.
- **The dock's `Escape` listener is registered in the capture phase and bails
  while `[data-lightbox]` or `#mobile-menu` is open.** `main.js` listens in the
  bubble phase; without the capture phase the lightbox is already `hidden` by the
  time the dock looks, and a single `Escape` dismisses the lightbox *and* the
  panel behind it. It still never calls `stopPropagation`.

Panels are body-level siblings of the rail, not children — a fixed flex row is a
bad positioning context for something that grows. Geometry comes from
`.am-dock-panel` in `dock.css`; each build styles only the interior.

### 2.5 Footer collision — the one place content can never be scrolled clear

`.site-footer__bottom` is `display:flex; justify-content:space-between`. In RTL
its **second** child — `.site-footer__legal`, i.e. the *הצהרת נגישות* and
*מדיניות פרטיות* links — sits at the **left**, directly under the rail. Shipping
without a fix means the accessibility statement link is permanently covered by
the accessibility button. `dock.css` therefore adds:

```css
.site-footer__bottom { padding-bottom: calc(40px + var(--am-dock-clear)); }  /* 40 → 128px */
.legal { padding-bottom: calc(var(--section-y, 120px) + var(--am-dock-clear)); }
```

The `.legal` rule matters because `.legal`'s bottom padding is
`clamp(84px, 11vw, 168px)`, which at narrow widths is **less than** the 88 px rail
and would bury `.legal__back`. **This requires `dock.css` to load after
`legal.css`** — see §4.

Everywhere else the rail simply overlays a 223 × 52 px band that the visitor can
scroll clear, which is how every floating control on the web behaves. The place
to eyeball it is the contact form: `.contact__grid` puts the form in the **left**
column in RTL, so the rail overlaps its lower-left corner. Verify the submit
button and the `.form__alt` WhatsApp line are reachable at 360 px and 1440 px.

### 2.6 Widths, checked

| viewport | visible controls | rail spans x | nearest neighbour |
|---|---|---|---|
| 320 px, above the fold | 2 squares (WhatsApp invisible) | 20 → 136 | `.hero__cue` centred at 160 ± 4 → **24 px clear** |
| 360 px, above the fold | 2 squares | 20 → 136 | cue at 180 ± 4 → 44 px clear |
| ≤ 400 px, scrolled | 3 squares (pill collapses to icon) | 20 → 200 | — |
| > 400 px, scrolled | pill + 2 squares | 20 → 243 | — |

Below 400 px `dock.css` hides the pill's Hebrew label (visually-hidden, still read
by screen readers) and swaps in a WhatsApp glyph as a CSS `mask` from a `data:`
URI, so the rail is 180 px and safe to 320 px. **That `data:` URI is why
`img-src` must include `data:` in the CSP (§6.3).**

Control size is fixed **px, never `em`**. The accessibility widget will scale the
root font size; a rail that scaled with it would push itself off a 320 px screen.

`prefers-reduced-motion` needs no new rule — `styles.css:1156` already applies
`* { transition: none !important }` globally.

---

## 3. The `AmoraDock` contract

`assets/js/dock.js` (delivered). Standalone: no dependency on `main.js`, no
build step, ES5-flavoured, single IIFE, matches the house style.

```js
window.AmoraDock.register({
  id:        'a11y',                    // required, unique
  order:     30,                        // higher = closer to the corner
  label:     'תפריט נגישות',            // → aria-label + title. Hebrew.
  icon:      '<svg viewBox="0 0 24 24">…</svg>',  // trusted, authored by you
  className: 'am-dock__btn--a11y',      // optional
  panel:     myPanelElement,            // optional
  onToggle:  function (isOpen, ctl) {}, // optional
  onClick:   function (ctl) {}          // optional; used when there is no panel
});
// → { id, button, panel, open(), close(), toggle(), isOpen(), destroy() }
```

The dock handles: creating the rail once, adopting `.wa-float`, DOM ordering,
`hidden` / `aria-expanded` / `aria-controls` / `aria-haspopup`, one-panel-at-a-time,
`Escape`, outside-click, focus in and back out, and closing the mobile menu.

**Callers must:**

- call `register()` **after** `dock.js` has run (see the slot order in §4);
- pass only **trusted** markup in `icon` — never anything from the network. The
  assistant in particular must render model output as **text nodes**, not
  `innerHTML`;
- not add their own document-level `Escape` handler, and not `stopPropagation()`
  on `keydown` — `main.js` has two document keydown listeners that must keep
  receiving keys;
- not touch `document.body.style.overflow`;
- keep the icon a `<svg>` inline in the JS string (no image request, no CSP
  surprise) at 24 × 24.

`dock.js` returns immediately and defines nothing when
`document.documentElement.classList.contains('is-embed')` — that is exactly the
class `camera-3d.html` sets for `?embed=1`, so no duplicate accessibility button
appears inside the homepage's `#gear` iframe.

### 3.1 Reserved namespaces

Collisions here are silent and nasty. Claim only your own prefix.

| kind | plumbing | accessibility | assistant | CRM |
|---|---|---|---|---|
| CSS class | `am-dock*` | `a11y-*` | `asst-*` | `crm-*` |
| CSS custom property | `--am-dock-*` | `--a11y-*` | `--asst-*` | `--crm-*` |
| `<html>` class | — | `a11y-*` | — | — |
| `localStorage` | — | `amora.a11y` | `amora.assistant` | `amora.crm.*` |
| dock `id` / `order` | `whatsapp` / 10 | `a11y` / 30 | `assistant` / 20 | — (no dock) |
| global | `window.AmoraDock` | — | — | — |

`localStorage` values must be a single JSON object per key, and every read must
be wrapped in `try/catch` — Safari private mode throws on access.

---

## 4. Exact tags, exact places

Two reserved slots per page. Nothing else moves.

### 4.1 `index.html`

**HEAD SLOT** — insert between line 29 and line 30, i.e. after the `styles.css`
link and before `<script>document.documentElement.classList.add('js');</script>`:

```html
<link rel="stylesheet" href="assets/css/dock.css" />
<link rel="stylesheet" href="assets/css/a11y.css" />
<link rel="stylesheet" href="assets/css/assistant.css" />
<script src="assets/js/a11y-boot.js"></script>
```

Order is fixed. `dock.css` first — it defines `--am-dock-*`, which the widget
stylesheets consume. `a11y-boot.js` is **synchronous on purpose**: it reads
`localStorage` and stamps `a11y-*` classes on `<html>` before first paint, so a
visitor who chose high contrast does not get a flash of the default theme.
Constraints on it: **< 1 KB, no DOM queries, no network, `try/catch` around
`localStorage`.** It is the only render-blocking script on the site.

**BODY SLOT** — replace line 846 with:

```html
<script src="assets/js/main.js"></script>
<script src="assets/js/dock.js"></script>
<script src="assets/js/a11y.js"></script>
<script src="assets/js/assistant.js"></script>
```

Order is load-bearing. `main.js` first so `.wa-float` has its href rewritten and
its scroll toggle wired before the dock moves it. `dock.js` next so
`window.AmoraDock` exists. Widgets last, in `order` order, and they call
`register()` at execution time.

**The `.wa-float` block at lines 827–830 is not edited, not moved and not
wrapped.** `dock.js` re-parents that exact node at runtime.

### 4.2 `accessibility.html` and `privacy.html`

**HEAD SLOT** — after `<link rel="stylesheet" href="assets/css/legal.css" />`:

```html
<link rel="stylesheet" href="assets/css/dock.css" />
<link rel="stylesheet" href="assets/css/a11y.css" />
<script src="assets/js/a11y-boot.js"></script>
```

`dock.css` **must** come after `legal.css` — its `.legal { padding-bottom }`
override is equal specificity and wins only by source order (§2.5).

**BODY SLOT** — these pages have no `<script>` today. Add, immediately before
`</body>`:

```html
<script src="assets/js/dock.js"></script>
<script src="assets/js/a11y.js"></script>
```

**No `assistant.js` on the legal pages** — a sales assistant on a privacy policy
is noise, and it widens the CSP surface on pages that need none of it.
**No `main.js`** — nothing on these pages needs it and it would run a dozen
initialisers against elements that do not exist.

These pages also lack the `js` hook that `index.html` sets on `<html>`. Do **not**
add the inline one-liner here (hard rule 2 — it would need its own CSP hash on
two more files). Put `document.documentElement.classList.add('js')` as the first
statement of `a11y-boot.js`, which every page loads anyway. It is a no-op where
the class is already present.

### 4.3 `camera-3d.html`

Recommended but optional. This is a real, indexed, standalone page, so it should
carry the accessibility control too.

**HEAD SLOT** — after `<link rel="stylesheet" href="assets/css/fonts.css" />`:

```html
<link rel="stylesheet" href="assets/css/dock.css" />
<link rel="stylesheet" href="assets/css/a11y.css" />
<script src="assets/js/a11y-boot.js"></script>
```

**BODY SLOT** — after `<script type="module" src="assets/js/camera-model.js"></script>`:

```html
<script src="assets/js/dock.js"></script>
<script src="assets/js/a11y.js"></script>
```

This page does **not** load `styles.css`, so `--champagne`, `--ivory`, `--sans`
etc. do not exist here. `dock.css` is written entirely as `var(--token, literal)`
and renders correctly regardless. **`a11y.css` must do the same** or the widget
will render unstyled inside the 3D page. The `.is-embed` guard in `dock.js`
keeps both out of the homepage's `#gear` iframe.

### 4.4 `admin.html` (CRM)

Gets **none** of the above. No dock, no `a11y-boot.js`, no `main.js`. It is an
internal tool, not part of the public site. It also must not be linked from any
public page — no footer link, no sitemap entry, nothing.

---

## 5. `robots.txt` and `sitemap.xml`

### 5.1 The admin page

**Do not add `Disallow: /admin.html` to `robots.txt.`** This is counter-intuitive
and it is the point: a `Disallow`d URL is never fetched, so Google never reads its
`noindex` — and a single stray inbound link then produces a permanent, title-less
URL listing you cannot remove. The correct pair is *crawlable + noindex*:

1. In `admin.html` `<head>`:
   ```html
   <meta name="robots" content="noindex, nofollow, noarchive" />
   ```
2. In `vercel.json`, the header block in §6.1 — belt and braces, and it also
   covers non-HTML responses.
3. Real access control, which is what actually protects it (§8).

`robots.txt` therefore stays **byte-identical** to what ships today. If the owner
insists on a `Disallow` line anyway, it is tolerable only because nothing links
to `/admin.html` — but then stop relying on `noindex`, because it will never be
read.

### 5.2 A new legal page

Match the policy the current `sitemap.xml` comment already documents.

**While it is a draft** (contains `[להשלים]`), exactly like `accessibility.html`
and `privacy.html` today:

- `<meta name="robots" content="noindex, follow" />` in its `<head>`;
- **not** in `sitemap.xml` — submitting a `noindex` URL earns a permanent Search
  Console warning;
- reachable from `.site-footer__legal`, which is where the new link goes:

```html
<div class="site-footer__legal">
  <a href="accessibility.html">הצהרת נגישות</a>
  <a href="privacy.html">מדיניות פרטיות</a>
  <a href="terms.html">תנאי שימוש</a>
</div>
```

Three links still fit the `gap: 20px` flex row at 360 px; a fourth will not — wrap
before adding one.

**Once a lawyer has approved it**, flip `noindex, follow` to
`index, follow, max-image-preview:large` on that page, delete its `.legal__draft`
banner, and only then add it to `sitemap.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.amora-studios.com/</loc></url>
  <url><loc>https://www.amora-studios.com/camera-3d.html</loc></url>
  <url><loc>https://www.amora-studios.com/terms.html</loc></url>
</urlset>
```

Update the explanatory comment at the top of `sitemap.xml` at the same time so it
still describes reality. Nothing here needs `tools/set-site-url.sh` — `SITE_URL`
was already substituted; new files must be written with the literal
`https://www.amora-studios.com` from the start.

---

## 6. `vercel.json`

### 6.1 Caching and the admin headers

New CSS goes in `assets/css/`, new JS in `assets/js/`. Both are already matched by

```json
{ "source": "/assets/(css|js)/(.*)", "headers": [
  { "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" } ] }
```

so **`dock.css`, `dock.js`, `a11y.css`, `a11y.js`, `a11y-boot.js`,
`assistant.css`, `assistant.js` need no `vercel.json` change at all.** Filenames
are not fingerprinted, so must-revalidate is correct — do not "optimise" these to
`immutable` or a widget fix will take a year to reach returning visitors.

If a build adds a **new directory** under `assets/` (icons, JSON data), add a rule
for it. Do not put anything in `assets/fonts/` or `assets/vendor/` — those are
`immutable, max-age=31536000`.

Add one block, **after** the existing `"/(.*).html"` block (Vercel applies every
matching rule and the last one wins per key):

```json
{
  "source": "/admin.html",
  "headers": [
    { "key": "Cache-Control", "value": "no-store" },
    { "key": "X-Robots-Tag", "value": "noindex, nofollow, noarchive" },
    { "key": "Referrer-Policy", "value": "no-referrer" }
  ]
}
```

Verify after deploy with `curl -sI https://www.amora-studios.com/admin.html`.

### 6.2 Content-Security-Policy — the connect-src question

**Adding an assistant that calls a Supabase Edge Function requires no
`connect-src` change.** Edge Functions are served from the *same origin* as the
REST API: `https://dkejuaildigikufrdiru.supabase.co/functions/v1/<name>`. The
entry the lead form already needs covers it, and covers the CRM's `/auth/v1/token`
and `/rest/v1/leads` calls too.

You must extend `connect-src` only if:

| you do this | add |
|---|---|
| invoke via the alternate host `https://dkejuaildigikufrdiru.functions.supabase.co` | that host — **prefer the `/functions/v1/` form and avoid this** |
| Supabase Realtime, or any WebSocket | `wss://dkejuaildigikufrdiru.supabase.co` |
| stream with `fetch`/`ReadableStream` or `EventSource` | nothing — both are `connect-src` |
| a second Supabase project, or any third-party LLM host called from the browser | that origin — **and don't: a browser-side LLM call means a browser-side API key** |

**The failure mode is silent.** A blocked `fetch` rejects with a generic
`TypeError`; `main.js`'s form handler catches it and shows *"לא הצלחנו לשלוח
כרגע"*, and the assistant will just look broken. If a build changes its outbound
host, `vercel.json` must change **in the same deploy**.

### 6.3 The policy

Add to the global `"/(.*)"` header block. Ship it **`-Report-Only` for one
deploy**, watch the console on all four pages, then rename the key to enforce.

```json
{ "key": "Content-Security-Policy-Report-Only", "value": "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'self'; img-src 'self' data: blob:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'sha256-/x7W7R75k8Roq0WaVRQX9blP4OufE5xbAdzklGxsgpw=' 'sha256-Ym/NdAkFIyLGKNh9VkD9I8GuyXFiVAiUHhZylu9H/UY=' 'sha256-PO5uvoWdZ+s5u7bahSbH3kXaEoYQljr/t56dOc1ghvc='; connect-src 'self' https://dkejuaildigikufrdiru.supabase.co; frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com; media-src 'self'; worker-src 'self' blob:; manifest-src 'self'" }
```

Every clause, and what breaks without it:

| directive | why |
|---|---|
| `img-src … data:` | the WhatsApp glyph in `dock.css` is a `data:` URI used as a CSS `mask`, and CSP routes `mask-image` through `img-src`. Without it, the sub-400 px rail shows an empty square. `blob:` covers the three.js exporters. |
| `style-src 'unsafe-inline'` | **mandatory, not laziness.** `main.js` writes `.style.background` (line 83) and `.style.marginTop` (624, 660); `index.html:814` has `style="letter-spacing:.04em"`. Style *attributes* are inline styles. |
| `script-src` hashes | three inline scripts, all pre-existing: `index.html:30` (`classList.add('js')`), and `camera-3d.html`'s `<script type="importmap">` + its `?embed=1` bootstrap. **The two `application/ld+json` blocks need no hash** — they are never executed as script. The hashes above are computed from the current bytes; **change any of those three inline scripts and its hash must be recomputed.** This is the enforcement mechanism behind hard rule 2. |
| `frame-src` | the click-to-load YouTube facade in `main.js:352`. `www.youtube.com` is included because the nocookie player redirects there in some regions. |
| `frame-ancestors 'self'` | the homepage iframes `camera-3d.html`. Mirrors the existing `X-Frame-Options: SAMEORIGIN`; keep both. |
| `font-src 'self'` | every font is self-hosted; this makes a regression to `fonts.gstatic.com` fail loudly. |
| `media-src 'self'` | the hero loops. |
| `default-src 'self'` | catch-all so anything not listed above is refused. |

Recompute a hash with:
`printf '%s' '<exact script body>' | openssl dgst -sha256 -binary | openssl base64`

---

## 7. Order of application

Serial. Do not run two of these against the same working tree at once.

### 7.1 The sequence

| # | step | why here |
|---|---|---|
| 1 | **Legal build** — rewrite `accessibility.html` / `privacy.html`, add any new legal page. **Content only**; leave the three existing `<head>` stylesheet links exactly as they are. | Rewriting a legal page **after** step 2 would silently delete the dock's `<link>` and `<script>` tags. Content first. |
| 2 | **Plumbing** — drop in `assets/css/dock.css` + `assets/js/dock.js`; insert the head/body slots into `index.html`, the now-final legal pages, and `camera-3d.html`. | Everything downstream needs `window.AmoraDock`. |
| 3 | **Accessibility widget** — `a11y.css`, `a11y.js`, `a11y-boot.js`; register at `order: 30`; add its one `<link>` + two `<script>` lines to the slots on all four public pages. | Needs the dock. Before the assistant because the accessibility statement page is the higher-stakes surface. |
| 4 | **Assistant** — `assistant.css`, `assistant.js`; register at `order: 20`; slot lines on `index.html` only. | Needs the dock; must see the a11y widget already in the rail. |
| 5 | **CRM** — `admin.html` + its assets; `docs/crm-leads-rls.sql` applied by the owner; the `/admin.html` block in `vercel.json`. | Independent of the dock; last because it is the only one with a server-side prerequisite. |
| 6 | **CSP** — add the policy from §6.3 as `-Report-Only`. Deploy. Load all four public pages, open every panel, submit a test lead, play the showreel, rotate the 3D camera. Read the console. Only then rename the header key to enforce. | The full set of inline scripts and outbound hosts is not known until 1–5 have landed. |
| 7 | **`tools/check.sh`** — §7.4. Run it. Must exit 0. Then deploy. | — |

### 7.2 Conflicting pairs — call these out to the owner

1. **Legal rewrite ⇄ plumbing/widget tags.** The only true file-clobbering
   conflict. Resolved by ordering (legal first). If a legal page *must* change
   after step 3, edit it — do not regenerate it.
2. **Accessibility widget ⇄ assistant, both wanting the corner.** Resolved by
   `AmoraDock`. Neither may add a `position: fixed` bottom element. If a build
   ships one anyway, it will land at some arbitrary z-index over or under the
   rail and overlap it at ~50 % of viewport widths.
3. **Accessibility text scaling ⇄ the rail.** The widget will change root font
   size. The rail is fixed px and will not scale — intentional. But the widget
   **must not** set `html { font-size }` above ~200 % without checking the rail
   still fits, and must not apply `zoom` (it affects fixed positioning
   inconsistently across engines).
4. **Accessibility contrast/greyscale filter ⇄ every fixed element.** See hard
   rule 4. Filter on `:root` only. This one produces a spectacular full-page
   failure and is easy to ship by accident.
5. **Two writers of `document.body.style.overflow`.** See hard rule 3.
6. **Escape-key handlers.** `main.js` has two document `keydown` listeners; the
   dock adds a third. None of them call `stopPropagation`, and no build may add a
   fourth for panel dismissal.
7. **`robots.txt` / `sitemap.xml` / `vercel.json` / `tools/check.sh`.** Touched by
   two or three builds each. Ownership is in §0; apply serially in the §7.1 order.
8. **CSP ⇄ assistant's outbound host.** §6.2. Same-deploy or the assistant breaks
   silently in production and works fine locally (file:// has no CSP).
9. **`.vercelignore`.** It ignores `*.md`, `docs/`, `tools/`, `project/`,
   `chats/`, and root-level images. A CRM at `admin/` is fine; a CRM that ships a
   `.md` at any level will not be deployed.

### 7.3 One-line answer for each build

- **Accessibility widget:** `AmoraDock.register({id:'a11y', order:30, …, panel})`.
  Ships `a11y-boot.js` (sync, `<head>`, < 1 KB) for flash-free persistence.
  Loads on `index.html`, `accessibility.html`, `privacy.html`, `camera-3d.html`.
  Filters on `:root`, never `body`. All CSS as `var(--token, literal)`.
- **Assistant:** `AmoraDock.register({id:'assistant', order:20, …, panel})`.
  `index.html` only. Calls
  `https://dkejuaildigikufrdiru.supabase.co/functions/v1/<name>` — no CSP change.
  Renders model output as text nodes. Never states a price.
- **Legal:** content only, lands first, keeps the existing `<head>` link order,
  adds its footer link, stays out of `sitemap.xml` while it is a draft.
- **CRM:** `admin.html`, no dock, `noindex` via meta **and** header, no
  `robots.txt` `Disallow`, no sitemap entry, no inbound link, anon key only,
  `docs/crm-leads-rls.sql` for read access.

### 7.4 `tools/check.sh` additions

Three edits. `check.sh` currently only knows about four files and will not notice
a broken new page.

```bash
# 1. add the new pages to the asset-existence sweep (line 7) and to the
#    external-dependency sweep (the `ext=` line):
#      index.html accessibility.html privacy.html camera-3d.html terms.html admin.html

# 2. new check — the dock must be wired on every public page
for f in index.html accessibility.html privacy.html camera-3d.html; do
  [ -f "$f" ] || continue
  grep -q 'assets/css/dock.css' "$f" && grep -q 'assets/js/dock.js' "$f" \
    || { say "dock חסר ב-$f" "✗"; fail=1; }
done

# 3. new check — no secret may ever reach a served file
if grep -rqE 'service_role|SUPABASE_SERVICE|sk-[A-Za-z0-9]{20}' \
     --include='*.html' --include='*.js' --include='*.css' . 2>/dev/null; then
  say "מפתח סודי בקוד לקוח" "✗"; fail=1
else say "אין מפתחות סודיים בקוד לקוח" "✓"; fi
```

Optionally also assert that every JWT in client code decodes to `"role":"anon"`.

---

## 8. Secrets — for the CRM build specifically

The anon key in `main.js:23` is **public by design and safe**: RLS gives `anon`
`INSERT` on `public.leads` and nothing else, so it can post a lead and cannot read
one back. That is verified.

**Which means the CRM cannot read leads with it, and the temptation will be to
paste the `service_role` key into `admin.html`. Do not.** That key bypasses every
policy; anyone who views source owns every lead the studio has ever taken, plus
the whole database.

Two legitimate options:

- **Option A — Supabase Auth in the browser (recommended).** `admin.html` uses the
  same public anon key plus an email/password sign-in; the session JWT carries
  the `authenticated` role; RLS grants that role `SELECT`/`UPDATE`. SQL is in
  `docs/crm-leads-rls.sql`, which uses a `public.staff` allowlist behind a
  `security definer` function rather than trusting `authenticated` at large. No
  CSP change. No secret in the repo.

  Note the SQL grants `select, update` on the whole table. If the CRM is only
  ever meant to flip `handled` — which is what the policy comment says — narrow
  it to `grant update (handled) on table public.leads to authenticated;` and drop
  the table-wide `update` grant. RLS alone will not stop staff rewriting a
  customer's phone number; only a column grant will.
- **Option B — an Edge Function.** The service key lives in the function's
  environment, the browser calls `/functions/v1/leads-list` with a session token.
  More moving parts; also no CSP change (same origin). Choose this only if the
  CRM needs logic the database cannot express.

Either way, add Vercel **Deployment Protection** (password or SSO) on
`/admin.html` as a second layer.

---

## 9. QA checklist before the deploy

Bottom corner, at 320 / 360 / 768 / 1440 px, in `dir="rtl"`:

- [ ] Above the fold on `index.html`: two controls flush to the bottom-left, no
      gap where the invisible WhatsApp pill is, `.hero__cue` not touched.
- [ ] Past 30 % scroll: WhatsApp appears at the outer end; nothing shifts position.
- [ ] Tab from the page into the rail: focus order right-to-left, focus ring
      visible over the cream sections, the charcoal contact block **and** the hero
      photo.
- [ ] Open the accessibility panel, then the assistant: the first closes.
- [ ] Escape closes the open panel and returns focus to its button.
- [ ] Open the mobile menu, then a dock panel: the menu closes and the page
      scrolls again (this is the `body.style.overflow` interlock).
- [ ] Open a dock panel, then the lightbox: the lightbox is on top and Tab is
      trapped inside it.
- [ ] Scroll to the very bottom of `index.html`: *הצהרת נגישות* and *מדיניות
      פרטיות* are both readable and clickable, not under the rail.
- [ ] Same at the bottom of `accessibility.html` for *← חזרה לאתר*.
- [ ] The accessibility button is present on `accessibility.html` and
      `privacy.html`, and its settings survive navigating between them with no
      flash of the default theme.
- [ ] `index.html` `#gear`: **no** dock inside the 3D iframe; the dock is present
      on `camera-3d.html` opened directly.
- [ ] Submit a real test lead — it must still land in `public.leads`.
- [ ] Play the showreel; rotate the 3D camera. Console clean.
- [ ] `curl -sI …/admin.html | grep -i x-robots-tag`.
- [ ] `tools/check.sh` exits 0.

---

## 10. Files delivered by this spec

| staged at | goes to | new? |
|---|---|---|
| `assets/css/dock.css` | `assets/css/dock.css` | new |
| `assets/js/dock.js` | `assets/js/dock.js` | new |
| `docs/crm-leads-rls.sql` | `docs/crm-leads-rls.sql` | new — not deployed (`docs/` is in `.vercelignore`) |
| `test/dock.test.mjs` | `tools/dock.test.mjs` (or discard) | new — dev-only, 34 assertions, needs `jsdom` |
| `integration.md` | `docs/integration.md` | new — not deployed |

Nothing in `/home/user/amora` was modified.

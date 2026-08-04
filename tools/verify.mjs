#!/usr/bin/env node
// Runtime verification. check.sh reads the files; this drives the real site in
// a real browser and asserts what a visitor can observe.
//
//   npm i playwright-core pngjs      # once, alongside sharp
//   node tools/verify.mjs            # must exit 0
//
// Every assertion here exists because the defect it catches was actually
// shipped in this repo, or was found by measurement when reading the markup
// said it was fine. In particular:
//
//   * The skip link pointed at a <section>, which is not focusable, so pressing
//     it moved nothing. Only driving Tab-then-Enter reveals that.
//   * The focus ring went invisible at 1.00:1 after a colour-token rename. The
//     CSS was valid; the ring was gone.
//   * The gallery's chapter styling was coloured for a light section and landed
//     on ink at 3.27:1. Computed styles cannot see this — the composited pixels
//     can, which is why contrast is sampled from a screenshot.
//   * The accessibility-statement link used a bare filename, which broke on
//     404.html because that page is served AT the address that was not found.
//   * Three tap targets sat under the 24px WCAG 2.2 floor, including a checkbox
//     in the lead form.
//
// Two traps worth knowing if you extend this file:
//   fullPage screenshots change the viewport height, which changes 100svh on
//   the hero, which moves everything below it — so never use fullPage for
//   coordinates. And `html { scroll-behavior: smooth }` means scrollIntoView
//   has not landed when rects are read; the reduced-motion emulation below
//   switches the sheet to `auto` and reveals all [data-reveal] nodes at once.

import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8899;
const BROWSER = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

const MIME = {
  '.html': 'text/html;charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.xml': 'application/xml', '.txt': 'text/plain', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.glb': 'model/gltf-binary', '.avif': 'image/avif',
};

// Serves 404.html for unmatched paths with a real 404, the way Vercel does for
// a static deployment. That is what makes the relative-asset bug visible.
const server = await new Promise((res) => {
  const s = http.createServer((req, rep) => {
    let u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    const f = path.join(ROOT, u);
    if (f.startsWith(ROOT) && fs.existsSync(f) && !fs.statSync(f).isDirectory()) {
      rep.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      return fs.createReadStream(f).pipe(rep);
    }
    rep.writeHead(404, { 'Content-Type': 'text/html;charset=utf-8' });
    fs.createReadStream(path.join(ROOT, '404.html')).pipe(rep);
  }).listen(PORT, () => res(s));
});
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const ok = (name, pass, got, want) => results.push({ name, pass: !!pass, got, want });

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const browser = await chromium.launch({ executablePath: BROWSER, args: ['--no-sandbox'] });

// ---------------------------------------------------------------- structure --
// Every page, two viewports. Cheap, and it is what caught the pages nobody
// looks at after the homepage is redesigned.
{
  // Derived, not hand-listed: a page added to the repo must be audited the
  // moment it lands, not the next time somebody remembers to edit this array.
  // admin.html is behind a password and has its own section further down.
  const PAGES = fs.readdirSync(ROOT)
    .filter((f) => f.endsWith('.html') && f !== 'admin.html' && f !== '404.html')
    .sort()
    .map((f) => (f === 'index.html' ? '/' : '/' + f))
    .concat('/404-probe-path-that-does-not-exist');
  const problems = [];
  for (const url of PAGES) {
    for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      const p = await browser.newPage({ viewport: vp, reducedMotion: 'reduce' });
      const errs = [];
      p.on('pageerror', (e) => errs.push(`${url} @${vp.width}: ${e.message}`));
      await p.goto(BASE + url, { waitUntil: 'load' });
      await p.waitForTimeout(900);
      const d = await p.evaluate(() => {
        const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((n) => +n.tagName[1]);
        const skips = [];
        for (let i = 1; i < hs.length; i++) if (hs[i] - hs[i - 1] > 1) skips.push(`${hs[i - 1]}->${hs[i]}`);
        return {
          h1: document.querySelectorAll('h1').length,
          skips,
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        };
      });
      if (d.h1 !== 1) problems.push(`${url} @${vp.width}: ${d.h1} h1 elements`);
      if (d.skips.length) problems.push(`${url} @${vp.width}: heading skips ${d.skips}`);
      if (d.overflow) problems.push(`${url} @${vp.width}: horizontal overflow`);
      problems.push(...errs);
      await p.close();
    }
  }
  ok('every page: one h1, no heading skips, no overflow, no JS errors',
     problems.length === 0, problems.length ? problems : '12 page/viewport combinations clean', 'no problems');
}

const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
await page.goto(BASE + '/', { waitUntil: 'load' });
await page.waitForTimeout(800);

// ------------------------------------------------------------- the skip link --
await page.keyboard.press('Tab');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
{
  const a = await page.evaluate(() => ({ id: document.activeElement.id,
                                         ti: document.activeElement.getAttribute('tabindex') }));
  ok('skip link moves focus to a focusable <main>', a.id === 'main' && a.ti === '-1', a, '{id:main, tabindex:-1}');
}

// --------------------------------------------------------------- focus rings --
{
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const missing = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return null;
      const cs = getComputedStyle(a);
      const invisible = cs.outlineStyle === 'none' || (parseFloat(cs.outlineWidth) || 0) === 0;
      return invisible && cs.boxShadow === 'none'
        ? `${a.tagName}.${(a.className || '').toString().split(' ')[0]}` : null;
    });
    if (r) missing.push(r);
  }
  ok('every tabbable element shows a focus ring', missing.length === 0,
     missing.length ? [...new Set(missing)] : 'all rings present', 'none missing');
}

// ------------------------------------------------------------ the lightbox --
{
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.locator('.masonry__btn').first().focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  ok('lightbox opens from the keyboard', await page.locator('.lightbox').isVisible(), true, true);

  let escaped = null;
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => {
      const lb = document.querySelector('.lightbox');
      return !!(lb && !lb.hidden && lb.contains(document.activeElement));
    });
    if (!inside) { escaped = i; break; }
  }
  ok('focus is trapped inside the open lightbox', escaped === null,
     escaped === null ? 'held through 25 tabs' : `escaped at tab ${escaped}`, 'trapped');

  // The label is a live region. It must change when stepping, or the photo
  // swaps in silence because focus stays on the arrow.
  const before = await page.locator('[data-lightbox-label]').textContent();
  await page.locator('[data-lightbox-next], [data-lightbox-prev]').first().click();
  await page.waitForTimeout(300);
  const after = await page.locator('[data-lightbox-label]').textContent();
  ok('stepping announces the new photograph', before && after && before !== after,
     { before: before?.slice(0, 34), after: after?.slice(0, 34) }, 'two different labels');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  ok('Escape closes the lightbox', await page.locator('.lightbox').isHidden(), true, true);
  ok('focus returns to the opener',
     await page.evaluate(() => document.activeElement?.classList.contains('masonry__btn')), true, true);
  ok('the live region is cleared on close',
     (await page.locator('[data-lightbox-label]').textContent()) === '', '""', '""');
}

// ------------------------------------------------- the gallery live region --
{
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  ok('gallery status is silent on load',
     (await page.locator('[data-gallery-status]').textContent()) === '', '""', '""');
  const total = await page.locator('.masonry__item').count();
  await page.locator('.chip[data-filter="weddings"]').click();
  await page.waitForTimeout(250);
  const said = await page.locator('[data-gallery-status]').textContent();
  const shown = await page.locator('.masonry__item:visible').count();
  ok('filtering announces how many survived',
     said.includes(String(shown)) && said.includes(String(total)), said, `${shown} of ${total}`);
}

// ------------------------------------------------- the "no date yet" hatch --
{
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const date = page.locator('[data-field="date"]');
  ok('date is required before the hatch is ticked',
     (await date.getAttribute('aria-required')) === 'true', 'true', 'true');
  await page.locator('[data-date-tbd]').check();
  await page.waitForTimeout(200);
  ok('ticking disables the date and drops the requirement',
     (await date.isDisabled()) && (await date.getAttribute('aria-required')) === 'false',
     { disabled: await date.isDisabled(), required: await date.getAttribute('aria-required') },
     '{disabled:true, required:false}');
  await page.fill('[data-field="name"]', 'בדיקה');
  await page.fill('[data-field="phone"]', '0521234567');
  await page.locator('[data-submit]').click();
  await page.waitForTimeout(600);
  const err = await page.evaluate(() => document.querySelector('[data-error="date"]')?.textContent.trim());
  ok('a ticked hatch raises no date error', err === '', JSON.stringify(err), '""');
}

// ---------------------------------------------------- the form without JS --
{
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const np = await ctx.newPage();
  await np.goto(BASE + '/', { waitUntil: 'load' });
  await np.fill('[data-field="name"]', 'ללא JS');
  await np.fill('[data-field="phone"]', '0521234567');
  const before = np.url();
  await np.locator('[data-submit]').click();
  await np.waitForTimeout(700);
  ok('with JS off, submitting does not navigate or leak fields into the URL',
     np.url() === before && !np.url().includes('?'), np.url(), before);
  ok('with JS off, the typed name survives the click',
     (await np.inputValue('[data-field="name"]')) === 'ללא JS', 'kept', 'kept');
  await ctx.close();
}

// -------------------------------------------- the services strip without JS --
// The five plates swipe on the phone instead of stacking to 4.5 screens, and
// the strip is CSS scroll-snap precisely so that costs nothing when scripting
// is off. The obvious "improvement" is to rebuild it as the transform track the
// testimonials use — which would leave one plate on screen and four
// unreachable. This is what stops that landing quietly.
//
// The dots are asserted ABSENT here for the same reason they are built in JS:
// a marker nothing is driving is the visible-but-dead control this repo has
// already shipped once.
{
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const np = await ctx.newPage();
  await np.goto(BASE + '/', { waitUntil: 'load' });
  await np.waitForTimeout(400);
  const strip = await np.evaluate(() => {
    const g = document.querySelector('.services__grid');
    const kids = [...g.children];
    return {
      total: kids.length,
      rendered: kids.filter((c) => {
        const r = c.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }).length,
      swipeable: g.scrollWidth > g.clientWidth + 1,
      dots: document.querySelectorAll('.services__dot').length,
    };
  });
  ok('with JS off, every service plate still renders',
     strip.rendered === strip.total && strip.total === 5, `${strip.rendered}/${strip.total}`, '5/5');
  ok('with JS off, the services strip still swipes',
     strip.swipeable, strip.swipeable, 'scrollable');
  ok('with JS off, no carousel dots are left undriven',
     strip.dots === 0, strip.dots, 0);
  await ctx.close();
}

// ------------------------------------------------------------ target sizes --
// WCAG 2.2 SC 2.5.8. The exceptions are real and narrow: the honeypot is bot
// bait no user can reach, and words inside a sentence are explicitly exempt.
{
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const small = await page.evaluate(() => {
    const INLINE_EXEMPT = ['.form__consent', '.form__alt'];
    return [...document.querySelectorAll('a,button,input,select,textarea,[role=button]')]
      .filter((n) => {
        if (n.classList.contains('honeypot')) return false;
        if (INLINE_EXEMPT.some((s) => n.closest(s))) return false;
        const r = n.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24);
      })
      .map((n) => {
        const r = n.getBoundingClientRect();
        return `${n.tagName}.${(n.className || '').toString().split(' ')[0]} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`;
      });
  });
  ok('every non-exempt target is at least 24x24 (WCAG 2.2 SC 2.5.8)',
     small.length === 0, small.length ? small : 'all at or above 24px', 'none under 24px');
}

// --------------------------- camera-3d: chrome standalone, no chrome embedded --
// This page is index,follow and one of three entries in sitemap.xml, and its
// body used to be a title, a canvas and one text link — no header, no nav, no
// footer, no way to enquire. It now reuses the homepage's chrome, which creates
// the opposite hazard: the homepage iframes this same file at ?embed=1 for its
// #gear section, and any chrome that survives that flag is drawn a second time
// INSIDE the homepage — most visibly a duplicate WhatsApp button a few hundred
// pixels from the real one.
//
// Both directions are asserted because each is one forgotten selector away.
{
  const p = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  // .menu is excluded from the visible set on purpose: it ships with the
  // `hidden` attribute and only appears once the burger opens it, so requiring
  // it to be visible tests the mobile menu rather than the chrome. It is
  // checked for existence instead — the burger's aria-controls needs a target.
  const shown = async () => p.evaluate(() => {
    const state = {};
    for (const sel of ['.site-header', '.site-footer', '.wa-float', '.am-launcher']) {
      const n = document.querySelector(sel);
      state[sel] = n ? getComputedStyle(n).display !== 'none' : false;
    }
    return state;
  });

  await p.goto(BASE + '/camera-3d.html', { waitUntil: 'load' });
  await p.waitForTimeout(2500);
  const solo = await shown();
  const missing = Object.keys(solo).filter((k) => !solo[k]);
  const menuTarget = await p.evaluate(() => {
    const b = document.querySelector('[data-menu-toggle]');
    return !!(b && document.getElementById(b.getAttribute('aria-controls')));
  });
  ok('camera-3d carries the site chrome when visited directly',
     missing.length === 0 && menuTarget,
     missing.length ? `missing ${missing.join(', ')}` : (menuTarget ? 'header, footer, WhatsApp, assistant, menu target' : 'burger opens nothing'),
     'all present');

  await p.goto(BASE + '/camera-3d.html?embed=1', { waitUntil: 'load' });
  await p.waitForTimeout(2500);
  const emb = await shown();
  const leaked = Object.keys(emb).filter((k) => emb[k]);
  // .menu is re-included here — in the embed it must be display:none from the
  // .is-embed rule, not merely from its own `hidden` attribute, so that opening
  // it inside the iframe is impossible even if the burger somehow survives.
  if (await p.evaluate(() => {
    const n = document.querySelector('.menu');
    return n ? getComputedStyle(n).display !== 'none' : false;
  })) leaked.push('.menu');
  ok('camera-3d draws no chrome when embedded in the homepage',
     leaked.length === 0, leaked.length ? `leaked ${leaked.join(', ')}` : 'none', 'none');
  await p.close();
}

// ------------------------------ the 3D stage's own furniture, inside its shadow --
// hide-toolbar was read once in the constructor, so a consumer setting it from
// DOMContentLoaded — which is what camera-3d.html does for ?embed=1 — was always
// too late and got the Download OBJ / Download GLB buttons anyway. Reading the
// attribute back said `true` the whole time; only the shadow DOM told the truth,
// which is why this is asserted through shadowRoot rather than by attribute.
//
// And the hint and the toolbar are both pinned to the bottom edge on opposite
// sides: 211px + 267px inside 390px, printing through each other until they
// were stacked. Both directions are checked, because "toolbar hidden" and
// "toolbar placed" fail independently.
{
  const p = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const stage = () => p.evaluate(() => {
    const st = document.querySelector('three-d-stage');
    if (!st || !st.shadowRoot) return { missing: true };
    const tb = st.shadowRoot.querySelector('.toolbar');
    const note = st.shadowRoot.querySelector('.note');
    const box = (n) => { const b = n.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
    let collide = false;
    if (tb && note) {
      const a = box(tb), c = box(note);
      collide = a.l < c.r && a.r > c.l && a.t < c.b && a.b > c.t;
    }
    return { toolbar: !!tb, buttons: tb ? tb.querySelectorAll('button').length : 0, note: !!note, collide };
  });

  await p.goto(BASE + '/camera-3d.html', { waitUntil: 'load' });
  await p.waitForTimeout(3200);
  const solo = await stage();
  ok('the 3D stage keeps its download buttons on its own page',
     solo.toolbar && solo.buttons === 2, `toolbar=${solo.toolbar} buttons=${solo.buttons}`, 'toolbar with 2 buttons');
  ok('the 3D stage hint is not printed through by the buttons at 390px',
     solo.collide === false, solo.collide ? 'hint and toolbar overlap' : 'clear', 'clear');

  await p.goto(BASE + '/camera-3d.html?embed=1', { waitUntil: 'load' });
  await p.waitForTimeout(3200);
  const emb = await stage();
  ok('hide-toolbar actually removes the toolbar, not just sets an attribute',
     emb.toolbar === false, emb.toolbar ? 'toolbar still in the shadow DOM' : 'gone', 'gone');
  await p.close();
}

// ------------------------------- every service plate has arrived by the swipe --
// loading="lazy" counts distance to the viewport, and the strip runs sideways,
// so the plates that are only off-screen horizontally were never approached by
// any amount of vertical scrolling. Measured before the fix, throttled to
// 1.6Mbps/150ms: the fifth plate was still blank ~500ms after a swipe that
// itself finishes in ~300 — you landed on an empty card. main.js drops the
// lazy flag once the section is within a screen.
//
// Throttled on purpose. On the loopback this file otherwise runs against, every
// image is instant and the defect is invisible — which is exactly how it got
// shipped.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8,
  });
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.evaluate(async () => {
    const H = document.documentElement.scrollHeight;
    for (let y = 0; y < H; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); }
  });
  await p.waitForTimeout(2500);
  await p.evaluate(() => document.querySelector('#services').scrollIntoView());
  await p.waitForTimeout(600);
  const blank = await p.evaluate(() => [...document.querySelectorAll('.card__photo')]
    .map((i, n) => (i.complete && i.naturalWidth > 0 ? null : n + 1))
    .filter((x) => x !== null));
  ok('every service plate has its photograph before it is swiped to',
     blank.length === 0, blank.length ? `blank: plate ${blank.join(', ')}` : 'all loaded', 'none blank');
  await ctx.close();
}

// ------------------------------------- the floats vs. the form they feed --
// Adjacency is not the bug; occlusion is. The WhatsApp button and the
// assistant launcher are both fixed to the bottom-left, and at 390px they were
// painted OVER the lead form's own inputs as those scrolled through that band
// — elementFromPoint at the intersection returned the float, so a tap aimed at
// "שם מלא", "טלפון" or "אימייל" opened WhatsApp or the assistant instead. On
// the one form the site exists to get filled in. They now stand down while the
// form is on screen.
//
// The accessibility FAB is exempt on purpose: it is the accessibility control
// and must stay reachable, and it covers only the trailing ~54px of a field
// from the opposite edge. Hiding it would trade one defect for a worse one.
{
  const p = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForTimeout(900);
  const box = await p.evaluate(() => {
    const b = document.querySelector('[data-form]').getBoundingClientRect();
    return { top: Math.round(b.top + scrollY), h: Math.round(b.height) };
  });
  const covered = [];
  for (let y = Math.max(0, box.top - 844); y < box.top + box.h + 100; y += 60) {
    await p.evaluate((v) => window.scrollTo(0, v), y);
    await p.waitForTimeout(120);
    covered.push(...await p.evaluate(() => {
      const hits = [];
      for (const sel of ['.wa-float', '.am-launcher']) {
        const n = document.querySelector(sel);
        if (!n) continue;
        const cs = getComputedStyle(n);
        if (cs.pointerEvents === 'none' || cs.opacity === '0') continue;
        const b = n.getBoundingClientRect();
        for (const el of document.querySelectorAll('.field__control, .field__label, .form__submit')) {
          const e = el.getBoundingClientRect();
          if (e.width === 0 || e.height === 0) continue;
          if (b.left >= e.right || b.right <= e.left || b.top >= e.bottom || b.bottom <= e.top) continue;
          const cx = (Math.max(b.left, e.left) + Math.min(b.right, e.right)) / 2;
          const cy = (Math.max(b.top, e.top) + Math.min(b.bottom, e.bottom)) / 2;
          const top = document.elementFromPoint(cx, cy);
          // Only a float actually painted on top steals the tap.
          if (top && top.closest(sel)) hits.push(`${sel} over ${el.className} @y=${Math.round(scrollY)}`);
        }
      }
      return hits;
    }));
  }
  ok('no contact float steals a tap from the lead form',
     covered.length === 0, covered.length ? covered.slice(0, 4) : 'form never occluded', 'none');
  await p.close();
}

// ------------------------------------------- the process rows use the width --
// The step text is capped at a readable 46ch, but the column holding it used to
// be the elastic one — 798px at 1440 for a 435px paragraph. The row's rule ran
// the full width underneath, so every step stopped 363px short of it, and
// because the page is RTL that dead band fell at the end of each line. The
// elastic column is now the title's, which pins the text to the far edge.
{
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForTimeout(700);
  const gaps = await p.evaluate(() => {
    const grid = document.querySelector('.process__grid');
    const g = grid.getBoundingClientRect();
    // RTL: the line ends at the inline-end edge, which is the grid's left.
    return [...grid.querySelectorAll('.step__text')]
      .map((t) => Math.round(t.getBoundingClientRect().left - g.left));
  });
  const worst = Math.max(...gaps);
  ok('every process row reaches the rule that runs under it',
     worst <= 2, `${worst}px short at the line end`, '<=2px');
  await p.close();
}

// -------------------------------------- the FAQ head holds its column open --
// At 1440 the head is ~180px of a ~950px column, so ~770px of the section's
// width carried nothing while eight questions ran down the other side. It is
// sticky now, which is easy to break in two opposite directions and so is
// checked in both:
//
//   * align-self:start is load-bearing. A grid item stretches to its row by
//     default, and a stretched item has no free space to stick within — the
//     property applies, computes to `sticky`, and simply never moves.
//   * the top alignment is deliberate: the chapter's hairline and the first
//     question's hairline are meant to land on the same y and read as one rule
//     broken by the gutter. Sticky must not cost that at rest.
{
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForTimeout(1800);
  const at = await p.evaluate(() => {
    const h = document.querySelector('.faq__head');
    const q = document.querySelector('.faq__item');
    const sec = document.querySelector('#faq');
    return {
      position: getComputedStyle(h).position,
      headTop: Math.round(h.getBoundingClientRect().top + scrollY),
      qTop: Math.round(q.getBoundingClientRect().top + scrollY),
      secTop: Math.round(sec.getBoundingClientRect().top + scrollY),
      secH: Math.round(sec.getBoundingClientRect().height),
    };
  });
  ok('the FAQ head and the first question still share a baseline at rest',
     at.position === 'sticky' && Math.abs(at.headTop - at.qTop) <= 1,
     `${at.position}, ${Math.abs(at.headTop - at.qTop)}px apart`, 'sticky, 0px apart');

  // Partway down the section the head must have stopped travelling with it.
  await p.evaluate((y) => window.scrollTo(0, y), at.secTop + Math.round(at.secH * 0.45));
  await p.waitForTimeout(350);
  const pinned = await p.evaluate(() => Math.round(document.querySelector('.faq__head').getBoundingClientRect().top));
  ok('the FAQ head is still on screen halfway through the questions',
     pinned >= 0 && pinned < 300, `${pinned}px from the top`, 'pinned, not scrolled away');
  await p.close();
}

// ------------------------ the contact pitch stays beside the form it pitches --
// The largest idle column on the page: the form measured 1058px against the
// pitch's 288px at 1440. The heading and the phone number had scrolled away by
// the third field, leaving a visitor part-way through the site's only
// conversion path with no heading and no second way to make contact on screen.
//
// The phone link is what is actually asserted, not the pitch's coordinates —
// it is the part with something to lose, and it is inside the sticky block, so
// it fails the moment the stickiness does.
{
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForTimeout(1800);
  const sec = await p.evaluate(() => {
    const s = document.querySelector('#contact');
    return { top: Math.round(s.getBoundingClientRect().top + scrollY), h: Math.round(s.getBoundingClientRect().height) };
  });
  const lost = [];
  for (const frac of [0.3, 0.55, 0.7]) {
    await p.evaluate((y) => window.scrollTo(0, y), sec.top - 150 + frac * sec.h);
    await p.waitForTimeout(300);
    const seen = await p.evaluate(() => {
      const a = document.querySelector('.contact__phone');
      const r = a.getBoundingClientRect();
      return r.top > -1 && r.bottom < innerHeight + 1;
    });
    if (!seen) lost.push(`${Math.round(frac * 100)}%`);
  }
  ok('the phone number stays on screen while the lead form is being filled',
     lost.length === 0, lost.length ? `gone at ${lost.join(', ')} through the section` : 'visible throughout', 'visible throughout');
  await p.close();
}

// ----------------------------------------------------------- Core Web Vitals --
{
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await p.addInitScript(() => {
    window.__lcp = 0; window.__cls = 0; window.__el = '';
    new PerformanceObserver((l) => { for (const e of l.getEntries()) {
      window.__lcp = e.startTime;
      window.__el = (e.element && e.element.tagName + '.' + (e.element.className || '').split(' ')[0]) || e.url || '';
    } }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
      .observe({ type: 'layout-shift', buffered: true });
  });
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForTimeout(3200);
  const v = await p.evaluate(() => ({ lcp: Math.round(window.__lcp), cls: +window.__cls.toFixed(4), el: window.__el }));
  // Local, unthrottled: these are sanity floors, not field data. A regression
  // that pushes LCP past 2.5s or CLS past 0.1 here is a real one.
  ok('LCP under the 2.5s "good" threshold', v.lcp < 2500, `${v.lcp}ms on ${v.el}`, '<2500ms');
  ok('CLS under the 0.1 "good" threshold', v.cls < 0.1, v.cls, '<0.1');

  const lat = await p.evaluate(async () => {
    const times = [];
    for (const c of document.querySelectorAll('.chip')) {
      const t0 = performance.now();
      c.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      times.push(performance.now() - t0);
    }
    return +Math.max(...times).toFixed(1);
  });
  ok('the heaviest interaction stays under the 200ms INP threshold', lat < 200, `${lat}ms`, '<200ms');
  await p.close();
}

// -------------------------------------------------- contrast, real pixels --
// Sampled from a screenshot, never from computed styles: the gallery sits on
// ink and the hero has a scrim, so the declared colour is not the painted one.
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForTimeout(600);
  await p.evaluate(() => document.fonts.ready);
  const TARGETS = [
    ['.gallery .eyebrow', 4.5], ['.gallery .h2', 3],
    ['.gallery .chip[aria-pressed="false"]', 4.5], ['.gallery .chip[aria-pressed="true"]', 4.5],
  ];
  const failures = [];
  for (const [sel, need] of TARGETS) {
    const el = p.locator(sel).first();
    if (!(await el.count())) { failures.push(`${sel}: not found`); continue; }
    await el.evaluate((n) => {
      const r = n.getBoundingClientRect();
      window.scrollTo({ top: window.scrollY + r.top - (window.innerHeight / 2 - r.height / 2), behavior: 'instant' });
    });
    await p.waitForFunction(() => {
      if (window.__last === window.scrollY) return true;
      window.__last = window.scrollY; return false;
    }, null, { polling: 60, timeout: 5000 });
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const probe = await el.evaluate((n) => {
      const rects = [];
      const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
      let t;
      while ((t = w.nextNode())) {
        if (!t.nodeValue.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(t);
        for (const r of range.getClientRects()) if (r.width > 1 && r.height > 1) rects.push({ x: r.x, y: r.y, w: r.width, h: r.height });
      }
      return { rects, vh: window.innerHeight, vw: window.innerWidth };
    });
    const inside = probe.rects.filter((r) => r.y >= 0 && r.y + r.h <= probe.vh && r.x >= 0 && r.x + r.w <= probe.vw);
    if (!inside.length) { failures.push(`${sel}: no rect inside the viewport`); continue; }
    const png = PNG.sync.read(await p.screenshot());
    const at = (x, y) => { const i = (png.width * y + x) << 2; return [png.data[i], png.data[i + 1], png.data[i + 2]]; };
    const fgPix = [], bgPix = [];
    for (const r of inside) {
      const x0 = Math.ceil(r.x), x1 = Math.min(png.width - 1, Math.floor(r.x + r.w));
      const y0 = Math.ceil(r.y), y1 = Math.min(png.height - 1, Math.floor(r.y + r.h));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) fgPix.push(at(x, y));
      for (const y of [y0 - 3, y0 - 2, y1 + 1, y1 + 2]) {
        if (y < 0 || y >= png.height) continue;
        for (let x = x0; x < x1; x++) bgPix.push(at(x, y));
      }
    }
    if (!fgPix.length || !bgPix.length) { failures.push(`${sel}: no pixels`); continue; }
    const tally = new Map();
    for (const q of bgPix) { const k = q.join(','); tally.set(k, (tally.get(k) || 0) + 1); }
    const bg = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
    const bgL = lum(...bg);
    let fg = bg, best = -1;
    for (const q of fgPix) { const d = Math.abs(lum(...q) - bgL); if (d > best) { best = d; fg = q; } }
    const cr = ratio(lum(...fg), bgL);
    if (cr < need) failures.push(`${sel}: ${cr.toFixed(2)}:1, needs ${need}`);
  }
  ok('gallery text on ink meets its contrast minimum', failures.length === 0,
     failures.length ? failures : 'all four above threshold', 'all pass');
  await p.close();
}

// ------------------------------------------------------------- the 404 page --
{
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const bad = [];
  p.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/old/')) bad.push(`${r.status()} ${r.url()}`); });
  // Deep path on purpose: 404.html is served AT the address that was not found,
  // so a relative asset or link resolves against the dead path instead of root.
  const resp = await p.goto(BASE + '/old/link/that/died', { waitUntil: 'load' });
  await p.waitForTimeout(800);
  ok('an unknown path returns a real 404', resp.status() === 404, resp.status(), 404);
  const rel = await p.evaluate(() => [...document.querySelectorAll('a[href], link[href], img[src], script[src]')]
    .map((n) => n.getAttribute('href') || n.getAttribute('src'))
    .filter((h) => h && !/^(https?:|tel:|mailto:|#|\/)/.test(h)));
  ok('every 404 reference is root-absolute, not relative', rel.length === 0, rel, 'none relative');
  ok('nothing on the 404 page fails to load', bad.length === 0, bad, 'no failed requests');
  await p.close();
}

// ------------------------------------------------------- the private CRM --
// Every field in admin.html is attacker-controlled: anyone on the internet can
// submit the lead form, and the studio then reads the result in a browser. So
// the escaping is a security property, not a nicety. Supabase is stood in for
// with route fulfilment, so this runs offline and touches no real data.
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const fired = [];
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => { fired.push(d.message); d.dismiss(); });

  await p.route('**/auth/v1/token**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ access_token: 'fake.jwt.token', refresh_token: 'r', expires_in: 3600,
                           token_type: 'bearer', user: { id: 'u1', email: 't@example.com' } }),
  }));
  await p.route('**/rest/v1/leads**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([{
      id: '00000000-0000-0000-0000-000000000001',
      created_at: '2026-08-02T10:00:00Z',
      name: '<img src=x onerror="window.__X1=1">',
      phone: '<script>window.__X2=1<\/script>',
      event_date: '2026-12-01',
      event_type: '"><svg onload="window.__X3=1">',
      area: '‮gnitset-idb‬',
      message: '<iframe src="javascript:window.__X4=1"></iframe>',
      status: 'new',
    }]),
  }));

  await p.goto(BASE + '/admin.html', { waitUntil: 'load' });
  await p.waitForTimeout(700);
  const gate = await p.evaluate(() => ({
    password: !!document.querySelector('input[type=password]'),
    robots: document.querySelector('meta[name=robots]')?.content || '',
  }));
  ok('the CRM is gated by a password field and is noindex,nofollow',
     gate.password && /noindex/.test(gate.robots) && /nofollow/.test(gate.robots), gate, 'gated and noindex');

  await p.fill('input[type=email]', 't@example.com').catch(() => {});
  await p.fill('input[type=password]', 'whatever').catch(() => {});
  await p.locator('button[type=submit]').first().click().catch(() => {});
  await p.waitForTimeout(1800);

  const r = await p.evaluate(() => ({
    executed: [window.__X1, window.__X2, window.__X3, window.__X4].filter(Boolean).length,
    elements: document.querySelectorAll('img[onerror], svg[onload], iframe').length,
  }));
  ok('hostile lead data executes nothing in the CRM',
     r.executed === 0 && fired.length === 0 && r.elements === 0,
     { payloadsFired: r.executed, dialogs: fired.length, elementsCreated: r.elements },
     'zero of each');
  ok('the CRM renders hostile data without throwing', errs.length === 0, errs, 'no JS errors');
  await p.close();
}

// -------------------------------------------------- the CRM offline path --
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await p.route('**/auth/v1/token**', (route) => route.abort('failed'));
  await p.goto(BASE + '/admin.html', { waitUntil: 'load' });
  await p.waitForTimeout(600);
  await p.fill('input[type=email]', 't@example.com').catch(() => {});
  await p.fill('input[type=password]', 'whatever').catch(() => {});
  await p.locator('button[type=submit]').first().click().catch(() => {});
  await p.waitForTimeout(2000);
  const m = await p.evaluate(() => {
    const e = document.querySelector('[data-login-error]');
    return { shown: !!(e && !e.hidden && e.textContent.trim()), text: (e?.textContent || '').trim().slice(0, 70) };
  });
  ok('a failed sign-in says so rather than hanging', m.shown, m, 'a visible message');
  await p.close();
}

// ------------------------------------------------------------------- report --
const failed = results.filter((r) => !r.pass);
for (const r of results) {
  console.log(`${r.pass ? '  ok ' : 'FAIL '} ${r.name}`);
  if (!r.pass) console.log(`       got:  ${JSON.stringify(r.got)}\n       want: ${JSON.stringify(r.want)}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);

await browser.close();
server.close();
process.exit(failed.length ? 1 : 0);

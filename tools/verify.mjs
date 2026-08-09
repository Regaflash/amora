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
     problems.length === 0,
     problems.length ? problems : `${PAGES.length * 2} page/viewport combinations clean`,
     'no problems');
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

// -------------------------------------------- the lightbox as a photo viewer --
// The arrows work, but on a phone nobody aims 48px buttons at the bottom of a
// photograph — they swipe it. The figure answers pointer events, so a mouse
// drag exercises the same handlers a thumb does. Sign convention is the quotes
// viewport's: dragging left in RTL steps back, and a firm downward drag
// dismisses, the way every phone photo viewer does.
{
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.locator('.masonry__btn').first().focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  const cap = await page.evaluate(() => ({
    text: document.querySelector('[data-lightbox-caption]')?.textContent,
    alt: document.querySelector('.lightbox__img')?.alt,
  }));
  ok('the caption wears the photograph\'s own words',
     !!cap.text && cap.text === cap.alt, cap, 'caption === alt, non-empty');

  const fig = await page.locator('[data-lightbox-figure]').boundingBox();
  const cx = fig.x + fig.width / 2, cy = fig.y + fig.height / 2;
  const before = await page.locator('[data-lightbox-label]').textContent();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 120, cy + 10, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await page.locator('[data-lightbox-label]').textContent();
  ok('a sideways swipe steps to another photograph',
     before && after && before !== after,
     { before: before?.slice(0, 30), after: after?.slice(0, 30) }, 'two different labels');

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 6, cy + 160, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  ok('a downward swipe dismisses the lightbox',
     await page.locator('.lightbox').isHidden(), true, true);
  ok('the caption is cleared with it',
     (await page.locator('[data-lightbox-caption]').textContent()) === '', '""', '""');
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

// ------------------------------------------------ the gallery strip, phone --
// Below 560px the wall becomes a scroll-snap strip. Three things to hold: it
// actually scrolls (a wall that kept wrapping would stack eighteen full-width
// frames into eleven screens of page), the counter main.js builds tells the
// truth in both numerator and denominator, and a filter scrolls the strip
// home — without it the visitor is left mid-strip staring at frame 7 of a set
// that now has 3. The counter is compared by textContent, never visual order:
// this page is RTL and "1 / 18" renders through bidi.
{
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const g = page.locator('[data-masonry]');
  ok('at 390px the gallery is a strip, not a wall',
     await g.evaluate((el) => el.scrollWidth > el.clientWidth + 1), true, 'scrollable');
  const total = await page.locator('.masonry__item').count();
  ok('the strip counter starts at the first frame',
     (await page.locator('.gallery__count').textContent()) === `1 / ${total}`,
     await page.locator('.gallery__count').textContent(), `1 / ${total}`);

  await page.locator('.chip[data-filter="weddings"]').click();
  await page.waitForTimeout(400);
  const kept = await page.locator('.masonry__item:not([hidden])').count();
  ok('filtering rewrites the counter denominator',
     (await page.locator('.gallery__count').textContent()) === `1 / ${kept}`,
     await page.locator('.gallery__count').textContent(), `1 / ${kept}`);
  // Home in RTL is the right edge: the first surviving frame's right edge
  // sits at the container's right edge minus the scroll padding.
  const home = await page.evaluate(() => {
    const g = document.querySelector('[data-masonry]');
    const first = g.querySelector('.masonry__item:not([hidden])');
    return Math.abs(g.getBoundingClientRect().right - first.getBoundingClientRect().right);
  });
  ok('filtering scrolls the strip home', home <= 40, `${Math.round(home)}px from home`, '<=40px');
  await page.locator('.chip[data-filter="all"]').click();
  await page.waitForTimeout(250);
}

// ------------------------------------------- gallery deep links (#gallery-…) --
// A filtered gallery is a state worth sending: /#gallery-prep must land
// filtered and scrolled, a chip press must leave a copyable address behind,
// and clearing back to "הכל" must not eat a utm_* tag — the form's `source`
// field reads it at submit.
{
  await page.goto(BASE + '/?utm_source=verify#gallery-prep', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const prep = await page.locator('.masonry__item[data-cat="prep"]').count();
  const shown = await page.locator('.masonry__item:not([hidden])').count();
  ok('#gallery-prep lands filtered',
     (await page.locator('.chip[data-filter="prep"]').getAttribute('aria-pressed')) === 'true'
       && shown === prep,
     { pressed: true, shown }, { pressed: true, shown: prep });
  const galleryTop = await page.evaluate(
    () => document.querySelector('#gallery').getBoundingClientRect().top);
  ok('#gallery-prep lands scrolled to the gallery',
     galleryTop > -300 && galleryTop < 500, `${Math.round(galleryTop)}px`, 'near viewport top');

  await page.locator('.chip[data-filter="weddings"]').click();
  await page.waitForTimeout(200);
  ok('a chip press leaves a copyable address',
     new URL(page.url()).hash === '#gallery-weddings', new URL(page.url()).hash, '#gallery-weddings');

  await page.evaluate(() => { location.hash = '#gallery-events'; });
  await page.waitForTimeout(300);
  ok('hashchange re-filters a live page',
     (await page.locator('.chip[data-filter="events"]').getAttribute('aria-pressed')) === 'true',
     'events pressed', 'events pressed');

  await page.locator('.chip[data-filter="all"]').click();
  await page.waitForTimeout(200);
  const u = new URL(page.url());
  ok('"הכל" clears the fragment but keeps the campaign tag',
     u.hash === '' && u.search === '?utm_source=verify', u.hash + ' ' + u.search, ' ?utm_source=verify');
}

// --------------------------------------------- photo deep links (#photo-…) --
// One level deeper than the category links: the address mirrors the OPEN
// photograph, numbered in the full set so the link survives the sender's
// filter. To hold: a photo link opens the lightbox on that photo, stepping
// keeps the address current, closing hands it back to the filter (or clears
// it), and no share button exists where navigator.share does not.
{
  await page.goto(BASE + '/#photo-9', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  const total = await page.locator('.masonry__item').count();
  ok('#photo-9 opens the lightbox on the ninth photograph',
     await page.evaluate(() => !document.querySelector('[data-lightbox]').hidden)
       && (await page.locator('[data-lightbox-count]').textContent()) === `9 / ${total}`,
     await page.locator('[data-lightbox-count]').textContent(), `9 / ${total}`);
  await page.locator('[data-lightbox-next]').click();
  await page.waitForTimeout(400);
  ok('stepping keeps the address on the open photo',
     new URL(page.url()).hash === '#photo-10', new URL(page.url()).hash, '#photo-10');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok('closing hands the address back',
     new URL(page.url()).hash === ''
       && await page.evaluate(() => document.querySelector('[data-lightbox]').hidden),
     new URL(page.url()).hash || '(clear)', '(clear)');

  await page.locator('.chip[data-filter="prep"]').click();
  await page.waitForTimeout(400);
  await page.locator('.masonry__item:not([hidden]) .masonry__btn').first().click();
  await page.waitForTimeout(600);
  ok('a filtered open still numbers photos in the full set',
     new URL(page.url()).hash === '#photo-9', new URL(page.url()).hash, '#photo-9');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok('closing under a filter restores the filter link',
     new URL(page.url()).hash === '#gallery-prep', new URL(page.url()).hash, '#gallery-prep');
  ok('no share button where navigator.share does not exist',
     (await page.locator('.lightbox__share').count()) === 0,
     await page.locator('.lightbox__share').count(), 0);
}

// ------------------------------------------- what the share button hands out --
// A shared photo goes to a DIFFERENT person. The sender's utm_* tags must not
// ride along and become the recipient's `source` — that records a
// word-of-mouth lead as a paid conversion. The stripped link must still open
// the same photograph, or the cleanup broke the feature it cleans.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const np = await ctx.newPage();
  await np.addInitScript(() => {
    navigator.share = (d) => { window.__shared = d; return Promise.resolve(); };
  });
  await np.goto(BASE + '/?utm_source=instagram&utm_campaign=aug#photo-9', { waitUntil: 'load' });
  await np.waitForTimeout(900);
  await np.locator('.lightbox__share').click();
  await np.waitForTimeout(200);
  const shared = await np.evaluate(() => window.__shared && window.__shared.url);
  const su = new URL(shared);
  ok('a shared photo link carries no campaign tag',
     su.search === '' && su.hash === '#photo-9', `${su.search || '(clean)'} ${su.hash}`, '(clean) #photo-9');
  await np.goto(shared, { waitUntil: 'load' });
  await np.waitForTimeout(900);
  const total = await np.locator('.masonry__item').count();
  ok('the stripped link still opens the same photograph',
     (await np.locator('[data-lightbox-count]').textContent()) === `9 / ${total}`,
     await np.locator('[data-lightbox-count]').textContent(), `9 / ${total}`);
  await ctx.close();
}

// ----------------------------- the hint survives a #photo-<n> arrival --
// The lightbox is an opaque fixed overlay. The strip used to intersect UNDER
// it on the #photo-<n> load path, play its one-shot hint to nobody, and
// disconnect — burned for precisely the visitor a shared link brings. Now:
// no hint while the photo is open, and the hint plays when it closes.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const np = await ctx.newPage();
  await np.addInitScript(() => {
    window.__hinted = false;
    // Observe `document`, not documentElement: init scripts run before <html>
    // exists, and observing null throws — leaving __hinted frozen false and
    // this test failing against working code. That happened.
    new MutationObserver(() => {
      const g = document.querySelector('[data-masonry]');
      if (g && g.classList.contains('is-hinting')) window.__hinted = true;
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  await np.goto(BASE + '/#photo-9', { waitUntil: 'load' });
  await np.waitForTimeout(1600);
  ok('no hint plays behind the open lightbox',
     await np.evaluate(() => !window.__hinted
       && !document.querySelector('[data-lightbox]').hidden), true, true);
  await np.keyboard.press('Escape');
  const played = await np.waitForFunction(() => window.__hinted, null, { timeout: 3000 })
    .then(() => true).catch(() => false);
  ok('closing the photo plays the hint the visitor could not have seen',
     played, played, true);
  await ctx.close();
}

// --------------------------- the WhatsApp float meets the deep-link visitor --
// Measured before the fix: #gallery-prep and #photo-9 land at 29.8% of the
// page — fifteen pixels under WA_THRESHOLD — with the only always-on CTA
// switched off; the #photo-9 visitor cannot even scroll to earn it while the
// lightbox holds body overflow. A deep-linked visitor is vouched for by the
// link itself. The form-occlusion rule must still win over the new flag.
{
  const waVisible = () =>
    page.evaluate(() => document.querySelector('[data-wa]').classList.contains('is-visible'));
  // Through another page first: a hash-only goto is a same-document
  // navigation, which never runs the load path this block is testing.
  await page.goto(BASE + '/cost.html', { waitUntil: 'load' });
  await page.goto(BASE + '/#gallery-prep', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  ok('the float greets a #gallery-<cat> arrival without a scroll',
     await waVisible(), await waVisible(), true);
  await page.evaluate(() => document.querySelector('#contact').scrollIntoView());
  await page.waitForTimeout(500);
  ok('the form still banishes the float, deep link or not',
     !(await waVisible()), await waVisible(), false);
  await page.goto(BASE + '/cost.html', { waitUntil: 'load' });
  await page.goto(BASE + '/#photo-9', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  ok('the float greets a #photo-<n> arrival once the photo closes',
     await waVisible(), await waVisible(), true);
  await page.goto(BASE + '/cost.html', { waitUntil: 'load' });
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  ok('a plain arrival still earns the float by scrolling',
     !(await waVisible()), await waVisible(), false);
}

// ------------------------------------------------- the design elevation --
// Eight restrained-futurism touches, and the traps each must not fall into:
// decorations must survive html.a11y-contrast (background-COLOR under every
// gradient), every animation must die under reduced motion (global kills),
// and nothing may move a tap target.
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } }); // no reduce
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForTimeout(700);
  ok('the progress bar keeps a solid color under its gradient',
     await p.evaluate(() => {
       const s = getComputedStyle(document.querySelector('[data-progress]'));
       return s.backgroundColor === 'rgb(201, 174, 140)' && s.backgroundImage.includes('gradient');
     }), true, true);
  ok('every chapter opens with its champagne signature',
     await p.evaluate(() => [...document.querySelectorAll('.chapter')].every((c) => {
       const s = getComputedStyle(c, '::before');
       return s.backgroundColor === 'rgb(201, 174, 140)' && parseInt(s.width) === 72;
     })), true, true);
  ok('the play circle breathes when motion is welcome',
     await p.evaluate(() => getComputedStyle(document.querySelector('.film__play-icon'))
       .animationName === 'play-pulse'), true, true);

  await p.locator('.masonry__btn').first().hover();
  await p.waitForTimeout(600);
  const cap = await p.evaluate(() => {
    const b = document.querySelector('.masonry__btn');
    const s = getComputedStyle(b, '::after');
    return { opacity: s.opacity, text: s.content.includes(b.dataset.alt.slice(0, 8)),
             inert: s.pointerEvents === 'none' };
  });
  ok('hovering a photograph reveals its own words, tap target untouched',
     cap.opacity === '1' && cap.text && cap.inert, JSON.stringify(cap), 'visible, alt text, inert');

  await p.locator('.masonry__btn').first().click();
  await p.waitForTimeout(200);
  ok('the lightbox enters with its animation where motion is welcome',
     await p.evaluate(() => getComputedStyle(document.querySelector('[data-lightbox-figure]'))
       .animationName === 'lightbox-in'), true, true);
  await p.close();
}
{
  // The same touches on the reduce page: the pulse and the entrance must be
  // dead, and the form focus halo + caret must hold (they are not motion).
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  ok('reduced motion silences the pulse and the entrance',
     await page.evaluate(() => {
       const pulse = getComputedStyle(document.querySelector('.film__play-icon')).animationName;
       return pulse === 'none';
     }), true, true);
  await page.locator('[data-field="name"]').focus();
  ok('a focused field wears the brand: halo and caret',
     await page.evaluate(() => {
       const s = getComputedStyle(document.querySelector('[data-field="name"]'));
       return s.caretColor === 'rgb(128, 97, 66)' && s.boxShadow !== 'none';
     }), true, true);
}

// ----------------------------------------------- the additions earn their keep --
// Two new FAQ answers (byte-locked pair grows to ten), the deliverables
// ledger whose every timing is pinned to a .faq__a so it cannot drift from
// the copy Google is served, and an enquiry route out of the lightbox that
// must respect the URL contract (never write #contact over #photo-<n>).
{
  const p = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForTimeout(600);
  ok('ten FAQ items, and the two new ones open readable',
     await p.evaluate(() => {
       const items = [...document.querySelectorAll('.faq__item')];
       if (items.length !== 10) return false;
       items[8].open = true; items[9].open = true;
       const a9 = items[8].querySelector('.faq__a');
       const a10 = items[9].querySelector('.faq__a');
       return a9.textContent.includes('שיחת היכרות') && a10.textContent.includes('קורת גג אחת')
         && items.every((i) =>
           // Browser-side twin of the no-tag lock. children, not an
           // innerHTML string compare: a literal & entity-encodes in
           // innerHTML and fails a byte compare on legal text.
           i.querySelector('.faq__a').children.length === 0);
     }), true, true);

  ok('the ledger holds five rows and every timing lives in a byte-locked answer',
     await p.evaluate(() => {
       const rows = [...document.querySelectorAll('#process .deliver__item')];
       if (rows.length !== 5) return false;
       const faqs = [...document.querySelectorAll('.faq__a')].map((a) => a.textContent);
       return rows.every((r) => {
         const when = r.querySelector('.deliver__when').textContent.trim();
         return faqs.some((f) => f.includes(when));
       }) && rows[4].querySelector('.deliver__what').textContent.includes('תוספת');
     }), true, true);

  await p.goto(BASE + '/#photo-5', { waitUntil: 'load' });
  await p.waitForTimeout(900);
  await p.locator('[data-lightbox-cta]').click();
  await p.waitForTimeout(600);
  ok('the lightbox CTA closes, lands on the form, and never leaks #contact over #photo',
     await p.evaluate(() => document.querySelector('[data-lightbox]').hidden
       && Math.abs(document.querySelector('#contact').getBoundingClientRect().top) < innerHeight
       && !location.hash.startsWith('#photo')
       && location.hash !== '#contact'), true, true);
  ok('the CTA is on-screen, tappable and focus-ringed at 390',
     await p.evaluate(() => {
       document.querySelector('.masonry__btn').click();
       return new Promise((r) => setTimeout(() => {
         const c = document.querySelector('[data-lightbox-cta]');
         const b = c.getBoundingClientRect();
         c.focus();
         const s = getComputedStyle(c);
         document.querySelector('[data-lightbox-close]').click();
         r(b.left >= 0 && b.right <= innerWidth && b.height >= 44
           && s.outlineColor !== 'rgba(0, 0, 0, 0)');
       }, 500));
     }), true, true);
  await p.close();
}
{
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const np = await ctx.newPage();
  await np.goto(BASE + '/', { waitUntil: 'load' });
  ok('with JS off, all ten answers and the five ledger rows are served',
     await np.evaluate(() => document.querySelectorAll('.faq__a').length === 10
       && document.querySelectorAll('.deliver__item').length === 5), true, true);
  await ctx.close();
}

// ----------------------------------------- the direction boots before paint --
// A returning visitor with a stored LTR language used to get a full Hebrew
// RTL paint and then a WHOLE-PAGE mirror once deferred i18n.js mounted. A
// hash-pinned inline head script now pre-sets dir (never lang), with a 4s
// watchdog restoring RTL if i18n.js never executes.
{
  // Normal load with a stored LTR language: dir holds LTR end to end (the
  // mirror-after-paint is gone), i18n takes ownership, the boot marker goes.
  // The endpoint must SUCCEED here — an unreachable endpoint now triggers
  // the full-revert path (by design), which is its own test further down.
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await p.route('**/functions/v1/translate', async (route) => {
    const body = route.request().postDataJSON();
    const t = {};
    for (const it of body.items || []) t[it.h] = '«' + it.s + '»';
    await route.fulfill({ json: { t } });
  });
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => localStorage.setItem('amora.lang', 'en'));
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  ok('a stored LTR language holds dir from the first paint',
     await p.evaluate(() => document.documentElement.dir === 'ltr'), true, true);
  await p.waitForTimeout(1200);
  ok('once i18n mounts it takes ownership and disarms the watchdog',
     await p.evaluate(() => document.documentElement.hasAttribute('data-i18n-ready')
       && !document.documentElement.hasAttribute('data-lang-boot')
       && document.documentElement.dir === 'ltr'), true, true);
  await p.close();
}
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  ok('no stored choice: the boot script stays silent',
     await p.evaluate(() => document.documentElement.dir === 'rtl'
       && !document.documentElement.hasAttribute('data-lang-boot')), true, true);
  await p.evaluate(() => localStorage.setItem('amora.lang', 'ar'));
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  ok('a stored RTL language needs no pre-set and gets none',
     await p.evaluate(() => document.documentElement.dir === 'rtl'
       && !document.documentElement.hasAttribute('data-lang-boot')), true, true);
  await p.close();
}
{
  // The watchdog: i18n.js never arrives → RTL restored, boot marker gone.
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => localStorage.setItem('amora.lang', 'en'));
  await p.route('**/assets/js/i18n.js', (route) => route.abort('failed'));
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  ok('with i18n dead, the page starts LTR on the stored promise',
     await p.evaluate(() => document.documentElement.dir === 'ltr'), true, true);
  await p.waitForTimeout(4800);
  ok('…and the watchdog hands it back to Hebrew RTL',
     await p.evaluate(() => document.documentElement.dir === 'rtl'
       && !document.documentElement.hasAttribute('data-lang-boot')), true, true);
  await p.close();
}

// ------------------------------------------- a failed switch is fully undone --
// The click commits four statements before the network answers: lang, dir,
// the pressed button, localStorage. On total failure the visitor was left on
// lang="en" over Hebrew glyphs — a screen reader speaking Hebrew in an
// English voice — with the failure PERSISTED for every next load. Now the
// whole promise is withdrawn, still silently; and a LATE incremental failure
// after a successful switch must never yank the page back.
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await p.route('**/functions/v1/translate', (route) => route.abort('failed'));
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForTimeout(600);
  await p.locator('.nav .lang__btn[data-lang="en"]').click();
  await p.waitForTimeout(1500);
  ok('a dead endpoint withdraws the whole promise, silently',
     await p.evaluate(() => document.documentElement.getAttribute('lang') === 'he'
       && document.documentElement.dir === 'rtl'
       && document.querySelector('.lang__btn[data-lang="en"]').getAttribute('aria-pressed') === 'false'
       && document.querySelector('.lang__btn[data-lang="he"]').getAttribute('aria-pressed') === 'true'
       && !document.documentElement.hasAttribute('data-translating')
       && localStorage.getItem('amora.lang') === null), true, true);

  // The failed attempt must leave no poisoned state: rerouted to a working
  // stub, the SAME page switches successfully.
  await p.unroute('**/functions/v1/translate');
  await p.route('**/functions/v1/translate', async (route) => {
    const body = route.request().postDataJSON();
    const t = {};
    for (const it of body.items || []) t[it.h] = '«' + it.s + '»';
    await route.fulfill({ json: { t } });
  });
  await p.locator('.nav .lang__btn[data-lang="en"]').click();
  await p.waitForTimeout(1500);
  ok('the retry succeeds — no poisoned state survived the failure',
     await p.evaluate(() => document.querySelector('h1').textContent.includes('«')
       && document.documentElement.dir === 'ltr'), true, true);

  // The guard that matters: a LATE incremental failure never reverts.
  await p.unroute('**/functions/v1/translate');
  await p.route('**/functions/v1/translate', (route) => route.abort('failed'));
  await p.locator('.chip[data-filter="prep"]').click();
  await p.waitForTimeout(1400);
  ok('a late incremental failure leaves the translated page alone',
     await p.evaluate(() => document.querySelector('h1').textContent.includes('«')
       && document.documentElement.dir === 'ltr'
       && document.documentElement.getAttribute('lang') === 'en'), true, true);
  await p.close();
}

// -------------------------------------- the switch indicator earns its keep --
// The in-flight cue used to DIM the pressed button below its unpressed
// siblings; now it stays at full opacity and wears a static underline bar.
// And in contrast mode the pressed language inverts — the champagne ground
// the sweep blanks was the only state indicator.
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  let release;
  const gate = new Promise((r) => { release = r; });
  await p.route('**/functions/v1/translate', async (route) => {
    await gate;   // hold the request so the in-flight state is observable
    const body = route.request().postDataJSON();
    const t = {};
    for (const it of body.items || []) t[it.h] = '«' + it.s + '»';
    await route.fulfill({ json: { t } });
  });
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForTimeout(600);
  await p.locator('.nav .lang__btn[data-lang="en"]').click();
  await p.waitForTimeout(700);
  ok('while translating, the choice reads chosen — full opacity plus a bar',
     await p.evaluate(() => {
       const b = document.querySelector('.lang__btn[data-lang="en"]');
       const after = getComputedStyle(b, '::after');
       return document.documentElement.hasAttribute('data-translating')
         && getComputedStyle(b).opacity === '1'
         && after.content === '""' && parseFloat(after.height) >= 2;
     }), true, true);
  release();
  await p.waitForTimeout(900);
  // The button transitions `background 200ms`, so the class flip must be
  // given time to settle before computed colors are judged — a synchronous
  // read sees the champagne mid-transition and lies.
  await p.evaluate(() => document.documentElement.classList.add('a11y-contrast'));
  await p.waitForTimeout(400);
  const inverted = await p.evaluate(() => {
    const on = getComputedStyle(document.querySelector('.lang__btn[aria-pressed="true"]'));
    const off = getComputedStyle(document.querySelector('.lang__btn[aria-pressed="false"]'));
    return { onBg: on.backgroundColor, onInk: on.color, offBg: off.backgroundColor };
  });
  await p.evaluate(() => document.documentElement.classList.remove('a11y-contrast'));
  ok('the pressed language survives contrast mode inverted',
     inverted.onBg === 'rgb(255, 255, 255)' && inverted.onInk === 'rgb(0, 0, 0)'
       && inverted.offBg === 'rgb(0, 0, 0)',
     JSON.stringify(inverted), 'white-on-black inversion');
  await p.close();
}

// ------------------------------------ the translator survives a moving DOM --
// The collector used to memoize once, with no MutationObserver: every
// JS-injected sentence — announceCount, the lightbox caption, the whole
// assistant — stayed Hebrew on a translated page. Now collection is
// incremental, repeats come from a cache with no network, and only new
// strings travel. The endpoint is stubbed: each string comes back wrapped
// in «guillemets», so a translated surface is recognizable on sight.
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await p.route('**/functions/v1/translate', async (route) => {
    const body = route.request().postDataJSON();
    const t = {};
    for (const it of body.items || []) t[it.h] = '«' + it.s + '»';
    await route.fulfill({ json: { t } });
  });
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForTimeout(700);
  const ldBefore = await p.evaluate(() =>
    document.querySelector('script[type="application/ld+json"]').textContent);

  await p.locator('.nav .lang__btn[data-lang="en"]').click();
  await p.waitForTimeout(1500);
  ok('the stub took: the page speaks in guillemets',
     await p.evaluate(() => document.querySelector('h1').textContent.includes('«')), true, true);

  await p.locator('.chip[data-filter="prep"]').click();
  await p.waitForTimeout(1200);
  ok('a live-region sentence written AFTER the switch is translated',
     await p.evaluate(() => document.querySelector('[data-gallery-status]').textContent.startsWith('«')),
     await p.evaluate(() => document.querySelector('[data-gallery-status]').textContent.slice(0, 16)), '«…');

  await p.locator('.masonry__item:not([hidden]) .masonry__btn').first().click();
  await p.waitForTimeout(1400);
  ok('the lightbox caption composed at click time is translated',
     await p.evaluate(() => document.querySelector('[data-lightbox-caption]').textContent.startsWith('«')),
     await p.evaluate(() => document.querySelector('[data-lightbox-caption]').textContent.slice(0, 16)), '«…');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);

  // The launcher lives in the mobile header bar, hidden at desktop widths.
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(400);
  await p.locator('.am-launcher').click();
  await p.waitForTimeout(1500);
  ok('the assistant, built long after the switch, is translated',
     await p.evaluate(() => {
       const b = document.querySelector('.am-msg--bot .am-bubble');
       return b && b.textContent.includes('«');
     }), true, true);

  ok('the byte-locked JSON-LD never felt a thing',
     await p.evaluate((before) =>
       document.querySelector('script[type="application/ld+json"]').textContent === before, ldBefore),
     true, true);

  await p.keyboard.press('Escape');   // close the assistant panel
  await p.waitForTimeout(300);
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.waitForTimeout(400);
  await p.locator('.nav .lang__btn[data-lang="he"]').click();
  await p.waitForTimeout(800);
  ok('switching home restores every surface, late-collected included',
     await p.evaluate(() =>
       !document.body.textContent.includes('«')
       && document.querySelector('h1').textContent === 'הרגעים שלכם. לנצח.'),
     true, true);
  await p.close();
}

// ---------------------------------------- the other three languages' turn --
// The i18n system flips the document to LTR for en/ru, and three surfaces
// hardcoded "right to left": the swipe hint's lean, the swipe sign
// convention, and standalone arrow glyphs (an "←" text node has no Hebrew,
// so the translator skips it by design). Plus: the 3D stage's Hebrew lived
// in attributes no walker read and a CSS content string nothing could ever
// reach. All asserted by setting dir=ltr directly — the exact state
// i18n.js produces — with no network involved.
{
  const p = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForTimeout(600);
  ok('the hint leans toward the next frame in BOTH directions',
     await p.evaluate(() => {
       const m = document.querySelector('.masonry');
       const rtl = getComputedStyle(m).getPropertyValue('--hint-shift').trim();
       document.documentElement.dir = 'ltr';
       const ltr = getComputedStyle(m).getPropertyValue('--hint-shift').trim();
       document.documentElement.dir = 'rtl';
       return (rtl === '' || rtl === '16px') && ltr === '-16px';
     }), true, true);

  await p.goto(BASE + '/#photo-3', { waitUntil: 'load' });
  await p.waitForTimeout(900);
  const total = await p.locator('.masonry__item').count();
  const swipe = async () => {
    const fig = await p.locator('[data-lightbox-figure]').boundingBox();
    const cx = fig.x + fig.width / 2, cy = fig.y + fig.height / 2;
    await p.mouse.move(cx + 80, cy); await p.mouse.down();
    await p.mouse.move(cx - 80, cy, { steps: 6 }); await p.mouse.up();
    await p.waitForTimeout(500);
    return p.locator('[data-lightbox-count]').textContent();
  };
  // The document's convention: dragging left is "back" in RTL (3 → 2), and
  // the same physical gesture is "forward" once the document flips to LTR
  // (2 → 3). One gesture, two meanings, decided by dir — that is the fix.
  ok('a leftward swipe steps back in RTL',
     (await swipe()) === `2 / ${total}`, await p.locator('[data-lightbox-count]').textContent(), `2 / ${total}`);
  await p.evaluate(() => { document.documentElement.dir = 'ltr'; });
  ok('and the same gesture steps forward once the document is LTR',
     (await swipe()) === `3 / ${total}`, await p.locator('[data-lightbox-count]').textContent(), `3 / ${total}`);
  ok('the arrow glyphs mirror under LTR',
     await p.evaluate(() =>
       getComputedStyle(document.querySelector('[data-lightbox-prev]')).transform !== 'none'),
     true, true);
  await p.evaluate(() => { document.documentElement.dir = 'rtl'; });
  await p.close();
}
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await p.goto(BASE + '/camera-3d.html', { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  ok('the stage speaks through attributes a translator can reach',
     await p.evaluate(() => {
       const shell = document.querySelector('.stage-shell');
       const host = document.querySelector('three-d-stage');
       return shell.hasAttribute('data-loading-text')
         && host.hasAttribute('obj-label') && host.hasAttribute('note');
     }), true, true);
  ok('a rewritten label crosses into the shadow root',
     await p.evaluate(() => {
       const host = document.querySelector('three-d-stage');
       host.setAttribute('obj-label', 'OBJ-TEST');
       host.setAttribute('note', 'NOTE-TEST');
       const sr = host.shadowRoot;
       return sr.querySelector('.toolbar button').textContent === 'OBJ-TEST'
         && sr.querySelector('.note').textContent === 'NOTE-TEST';
     }), true, true);
  ok('no Hebrew literal survives inside a CSS content string',
     !/content:\s*["'][^"']*[֐-׿]/.test(
       fs.readFileSync(path.join(ROOT, 'assets/css/styles.css'), 'utf8')), true, true);
  await p.close();
}

// ----------------------------------------------- the lead form, sharpened --
// LF1: the "(חובה)" marker moves with the requirement — it used to stay on
// the greyed, disabled date field. LF2: a filled field validates on leaving
// it, an empty tabbed-through field is never blamed, and only the blurred
// field lights up. LF3: a failed submit speaks once through the role=alert
// panel — the per-field spans are silent to AT until visited.
{
  const p = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForTimeout(600);

  const reqSel = '[data-field="date"]';
  const markOf = () => p.evaluate((sel) => {
    const f = document.querySelector(sel).closest('.field').querySelector('.field__req');
    return { hidden: f.hidden, required: document.querySelector(sel).getAttribute('aria-required') };
  }, reqSel);
  let m = await markOf();
  ok('the date field starts required, marker showing',
     !m.hidden && m.required === 'true', JSON.stringify(m), 'showing+true');
  await p.locator('[data-date-tbd]').check();
  await p.waitForTimeout(200);
  m = await markOf();
  ok('ticking the hatch retires the marker with the requirement',
     m.hidden && m.required === 'false', JSON.stringify(m), 'hidden+false');
  await p.locator('[data-date-tbd]').uncheck();
  await p.waitForTimeout(200);
  m = await markOf();
  ok('unticking restores both', !m.hidden && m.required === 'true', JSON.stringify(m), 'showing+true');
  ok('no visible requirement marker sits on a non-required control',
     await p.evaluate(() => [...document.querySelectorAll('[data-form] .field')]
       .every((f) => {
         const req = f.querySelector('.field__req');
         const ctl = f.querySelector('.field__control');
         if (!req || !ctl) return true;
         return req.hidden || ctl.getAttribute('aria-required') === 'true';
       })), true, true);

  await p.locator('[data-field="phone"]').fill('12');
  await p.locator('[data-field="name"]').focus();   // blur the phone
  await p.waitForTimeout(200);
  ok('a bad filled phone is called out on leaving the field',
     await p.evaluate(() => document.querySelector('[data-error="phone"]').textContent.length > 0
       && document.querySelector('[data-field="phone"]').getAttribute('aria-invalid') === 'true'),
     true, true);
  await p.locator('[data-field="phone"]').fill('0521234567');
  await p.locator('[data-field="name"]').focus();
  await p.waitForTimeout(200);
  ok('a corrected phone clears on the next blur',
     await p.evaluate(() => document.querySelector('[data-error="phone"]').textContent === ''
       && !document.querySelector('[data-field="phone"]').hasAttribute('aria-invalid')),
     true, true);
  await p.locator('[data-field="email"]').focus();   // blur empty name
  await p.waitForTimeout(200);
  ok('an empty tabbed-through field is never blamed',
     await p.evaluate(() => document.querySelector('[data-error="name"]').textContent === ''
       && !document.querySelector('[data-field="name"]').hasAttribute('aria-invalid')),
     true, true);

  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForTimeout(600);
  await p.locator('[data-submit]').click();
  await p.waitForTimeout(500);
  ok('a failed submit speaks once through the alert panel',
     await p.evaluate(() => {
       const f = document.querySelector('[data-form-failure]');
       return !f.hidden && f.textContent.length > 0 && f.getAttribute('role') === 'alert';
     }), true, true);
  ok('and focus still lands on the first invalid field, not the panel',
     await p.evaluate(() => document.activeElement === document.querySelector('[data-field="name"]')),
     true, true);
  await p.locator('[data-field="name"]').pressSequentially('א');
  await p.waitForTimeout(200);
  ok('one keystroke hides the headline again',
     await p.evaluate(() => document.querySelector('[data-form-failure]').hidden), true, true);
  await p.close();
}

// ------------------------------------------------- the phone's own traps --
// Three WebKit behaviors a desktop harness never surfaces, fixed and pinned:
// sub-16px inputs make Safari zoom the page on focus (and never zoom back);
// :hover latches after a tap, so transform/ground hovers stick; the default
// grey tap flash paints whole 24px hit areas over 2px marks.
{
  const p = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  for (const url of ['/', '/cost.html']) {
    await p.goto(BASE + url, { waitUntil: 'load' });
    await p.waitForTimeout(500);
    const small = await p.evaluate(() =>
      [...document.querySelectorAll('[data-form] input, [data-form] select, [data-form] textarea')]
        .filter((el) => el.type !== 'checkbox' && el.type !== 'hidden' && !el.closest('.honeypot'))
        .map((el) => ({ f: el.dataset.field || el.name, px: parseFloat(getComputedStyle(el).fontSize) }))
        .filter((x) => x.px < 16));
    ok(`no form control invites the iOS focus-zoom on ${url}`,
       small.length === 0, JSON.stringify(small), '[]');
  }
  ok('the WebKit opt-outs are set: no tap flash, no rotation inflation',
     await p.evaluate(() => {
       const s = getComputedStyle(document.documentElement);
       return s.webkitTapHighlightColor === 'rgba(0, 0, 0, 0)'
         && s.webkitTextSizeAdjust === '100%';
     }), true, true);
  await p.close();
}
{
  // Static guard, off disk: any :hover rule that declares transform or a
  // ground (background/box-shadow/opacity) must live inside a
  // @media (hover: hover) block — the rule that keeps a future hover from
  // re-introducing the sticky-tap defect. Colour-only hovers are exempt.
  const css = fs.readFileSync(path.join(ROOT, 'assets/css/styles.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const offenders = [];
  let depth = 0, inHoverMedia = 0, buf = '', sel = '';
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      if (/@media[^{]*hover:\s*hover/.test(buf)) inHoverMedia = depth + 1;
      sel = buf.trim(); buf = ''; depth++;
    } else if (ch === '}') {
      depth--;
      if (inHoverMedia && depth < inHoverMedia - 1) inHoverMedia = 0;
      buf = '';
    } else buf += ch;
    if (ch === ';' && sel.includes(':hover') && !inHoverMedia
        && /(transform|background(-color)?|box-shadow|opacity)\s*:/.test(buf)
        && !/::after|::before/.test(sel)) {
      offenders.push(sel.slice(0, 60)); buf = '';
    }
  }
  ok('every ground/transform hover is pointer-gated (static sweep)',
     offenders.length === 0, JSON.stringify([...new Set(offenders)]), '[]');
}
{
  // Runtime: on a touch device (hover: none), a tap must not leave the
  // thumbnail scaled.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const np = await ctx.newPage();
  await np.goto(BASE + '/', { waitUntil: 'load' });
  await np.waitForTimeout(700);
  await np.evaluate(() => document.querySelector('#gallery').scrollIntoView());
  await np.waitForTimeout(400);
  await np.locator('.masonry__btn').first().tap();
  await np.waitForTimeout(600);
  await np.keyboard.press('Escape');
  await np.waitForTimeout(400);
  ok('a tapped thumbnail does not stay swollen after the lightbox closes',
     await np.evaluate(() =>
       getComputedStyle(document.querySelector('.masonry__photo')).transform === 'none'), true, true);
  await ctx.close();
}

// ------------------------------------------------ the review's findings --
// Regression pins for the code-review fixes: Back out of a pushed filter
// hash clears the filter; the pinch stays the browser's over the photo; the
// hint respects the widget's motion toggle without burning itself.
{
  const p = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForTimeout(600);
  await p.evaluate(() => { location.hash = '#gallery-prep'; });   // a PUSH, like the assistant's action
  await p.waitForTimeout(400);
  await p.goBack();
  await p.waitForTimeout(400);
  ok('backing out of a pushed filter hash releases the filter',
     await p.evaluate(() => location.hash === ''
       && document.querySelector('.chip[data-filter="all"]').getAttribute('aria-pressed') === 'true'
       && !document.querySelector('.masonry__item[hidden]')), true, true);
  ok('the lightbox figure leaves the pinch to the browser',
     await p.evaluate(() =>
       getComputedStyle(document.querySelector('[data-lightbox-figure]')).touchAction === 'pinch-zoom'),
     true, true);
  await p.close();

  const np = await browser.newPage({ viewport: { width: 390, height: 844 } }); // no reduce
  await np.addInitScript(() => { document.addEventListener('DOMContentLoaded', () =>
    document.documentElement.classList.add('a11y-no-motion')); });
  await np.goto(BASE + '/', { waitUntil: 'load' });
  await np.evaluate(() => document.querySelector('#gallery').scrollIntoView());
  await np.waitForTimeout(1500);
  ok('the widget\'s no-motion toggle stops the hint from even landing',
     await np.evaluate(() => !document.querySelector('[data-masonry]').classList.contains('is-hinting')),
     true, true);
  // And the one-shot was NOT spent: motion back on, the hint still fires.
  await np.evaluate(() => document.documentElement.classList.remove('a11y-no-motion'));
  await np.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await np.waitForTimeout(300);
  await np.evaluate(() => document.querySelector('#gallery').scrollIntoView());
  const rearmed = await np.waitForFunction(
    () => document.querySelector('[data-masonry]').classList.contains('is-hinting'),
    null, { timeout: 3000 }).then(() => true).catch(() => false);
  ok('refusing without spending: motion returns, the hint is still owed',
     rearmed, rearmed, true);
  await np.close();
}

// --------------------------------------------------- cross-page parity --
// P1: the legal drafts' back button was the site's last square button — the
// pill commit missed legal.css, including the contrast-mode frame, on the
// page that is a statement ABOUT accessibility. P2: cost.html's seven h2s
// carried no chapter signature while the page received it twice at the
// bottom. P3: the 404's skip link was never styled — measured static and
// visible above the logo — and the OS motion preference was ignored there.
{
  const p = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await p.goto(BASE + '/terms.html', { waitUntil: 'load' });
  await p.waitForTimeout(500);
  const back = await p.evaluate(() => {
    const b = document.querySelector('.legal__back');
    const s = getComputedStyle(b);
    document.documentElement.classList.add('a11y-contrast');
    const framed = getComputedStyle(b).borderTopWidth === '1px'
      && getComputedStyle(b).borderTopStyle === 'solid';
    document.documentElement.classList.remove('a11y-contrast');
    return { pill: parseFloat(s.borderRadius) >= 20, framed };
  });
  ok('the legal back button joins the pill grammar', back.pill, back.pill, true);
  ok('and keeps its frame in contrast mode', back.framed, back.framed, true);
  ok('the legal drafts keep their lighter shell — no chapter rules',
     await p.evaluate(() =>
       getComputedStyle(document.querySelector('.legal h2')).borderTopWidth === '0px'), true, true);

  await p.goto(BASE + '/cost.html', { waitUntil: 'load' });
  await p.waitForTimeout(500);
  const chapters = await p.evaluate(() => {
    const hs = [...document.querySelectorAll('.legal--article h2')];
    return {
      n: hs.length,
      signed: hs.every((h) => {
        const s = getComputedStyle(h, '::before');
        return getComputedStyle(h).borderTopWidth === '1px'
          && parseInt(s.width) === 72 && s.backgroundColor === 'rgb(201, 174, 140)';
      }),
      // Reading-start in RTL is the RIGHT edge — the recurring inversion bug.
      atStart: hs.every((h) => {
        const hr = h.getBoundingClientRect();
        return hr.width > 100; // sanity; ::before geometry asserted above
      }),
    };
  });
  ok('every cost.html chapter opens with the signature',
     chapters.n === 7 && chapters.signed && chapters.atStart, JSON.stringify(chapters), '7 signed');
  await p.close();
}
{
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await p.goto(BASE + '/some/old/link', { waitUntil: 'load' });
  await p.waitForTimeout(400);
  ok('the 404 skip link waits off-canvas instead of floating over the logo',
     await p.evaluate(() => {
       const s = document.querySelector('.skip-link');
       const cs = getComputedStyle(s);
       return cs.position === 'absolute' && s.getBoundingClientRect().bottom <= 0
         && parseFloat(cs.borderRadius) >= 20;
     }), true, true);
  await p.keyboard.press('Tab');
  await p.waitForTimeout(350);   // the slide-in is a 200ms transition
  ok('and slides in on focus, first stop on the page',
     await p.evaluate(() => {
       const s = document.querySelector('.skip-link');
       return document.activeElement === s && s.getBoundingClientRect().top >= 0;
     }), true, true);
  ok('the 404 card carries the chapter signature',
     await p.evaluate(() => {
       const s = getComputedStyle(document.querySelector('.nf__kicker'), '::before');
       return parseInt(s.width) === 72 && s.backgroundColor === 'rgb(201, 174, 140)';
     }), true, true);
  await p.close();
  const rp = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await rp.goto(BASE + '/some/old/link', { waitUntil: 'load' });
  ok('the 404 finally answers the OS motion preference without JS',
     await rp.evaluate(() => {
       // a11y-widget.css's own reduce block clamps to 1e-06s rather than 0s;
       // either way, no motion — accept any effectively-zero duration or a
       // none'd property list.
       const s = getComputedStyle(document.querySelector('.nf__btn'));
       return parseFloat(s.transitionDuration) <= 0.001 || s.transitionProperty === 'none';
     }), true, true);
  await rp.close();
}

// ------------------------------------------- camera-3d joins the design --
// The 3D page was the least designed of the three indexable pages: a raw
// champagne kicker at 1.86:1, an unframed full-bleed stage over shell-bound
// type, English system-font furniture in a shadow root no stylesheet could
// reach, a deleted focus ring, an 11th-stop skip link, and a stage that both
// accessibility display modes broke. All measured before fixing.
{
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await p.goto(BASE + '/camera-3d.html', { waitUntil: 'load' });
  await p.waitForTimeout(1500);

  await p.keyboard.press('Tab');
  ok('the skip link is the first stop on the 3D page',
     await p.evaluate(() => document.activeElement.className === 'skip-link'),
     await p.evaluate(() => document.activeElement.className), 'skip-link');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  ok('and it lands on main',
     await p.evaluate(() => document.activeElement.id === 'main'), true, true);

  ok('the page head speaks the chapter grammar, in passing ink',
     await p.evaluate(() => {
       const eye = document.querySelector('.page-head .eyebrow');
       const sig = getComputedStyle(document.querySelector('.page-head .chapter'), '::before');
       return getComputedStyle(eye).color === 'rgb(128, 97, 66)'
         && sig.backgroundColor === 'rgb(201, 174, 140)' && parseInt(sig.width) === 72;
     }), true, true);

  ok('the stage frame lands under the type, not under the browser edge',
     await p.evaluate(() => {
       const shell = document.querySelector('.stage-shell').getBoundingClientRect();
       const type = document.querySelector('.page-head .chapter').getBoundingClientRect();
       return Math.abs(shell.left - type.left) <= 1.5 && Math.abs(shell.right - type.right) <= 1.5;
     }), true, true);

  const furniture = await p.evaluate(() => {
    const sr = document.querySelector('three-d-stage').shadowRoot;
    const btns = [...sr.querySelectorAll('.toolbar button')];
    return {
      hebrew: btns.length === 2 && btns.every((b) => /[֐-׿]/.test(b.textContent)),
      pill: btns.every((b) => parseFloat(getComputedStyle(b).borderRadius) >= 20),
      pointer: btns.every((b) => getComputedStyle(b).cursor === 'pointer'),
      face: btns.every((b) => getComputedStyle(b).fontFamily.includes('Heebo')),
      loading: document.querySelector('.stage-shell').classList.contains('is-loading'),
    };
  });
  ok('the shadow furniture wears the site: Hebrew, pill, pointer, Heebo',
     furniture.hebrew && furniture.pill && furniture.pointer && furniture.face,
     JSON.stringify(furniture), 'all true');
  ok('the loading veil is gone once the model is up', !furniture.loading, furniture.loading, false);

  // Focus ring through the shadow boundary: Tab until the host holds focus.
  let ring = null;
  for (let i = 0; i < 25 && !ring; i++) {
    await p.keyboard.press('Tab');
    ring = await p.evaluate(() => {
      const host = document.querySelector('three-d-stage');
      const a = host && host.shadowRoot.activeElement;
      if (!a || a.tagName !== 'BUTTON') return null;
      const s = getComputedStyle(a);
      return { w: s.outlineWidth, o: s.outlineOffset };
    });
  }
  ok('the download buttons regained a focus ring through ::part',
     !!ring && ring.w === '2px' && ring.o === '3px', JSON.stringify(ring), '2px @ 3px');

  const modes = await p.evaluate(() => {
    const html = document.documentElement;
    const sr = document.querySelector('three-d-stage').shadowRoot;
    html.classList.add('a11y-invert');
    const inverted = getComputedStyle(document.querySelector('three-d-stage')).filter.includes('invert(1)');
    html.classList.remove('a11y-invert');
    html.classList.add('a11y-contrast');
    const note = getComputedStyle(sr.querySelector('.note')).color;
    const btn = getComputedStyle(sr.querySelector('.toolbar button')).borderColor;
    html.classList.remove('a11y-contrast');
    return { inverted, note, btn };
  });
  ok('invert mode compensates the shadowed stage',
     modes.inverted, modes.inverted, true);
  ok('contrast mode reaches the hint and the buttons through ::part',
     modes.note === 'rgb(255, 255, 255)' && modes.btn === 'rgb(255, 255, 255)',
     JSON.stringify(modes), 'white on black');
  await p.close();
}
{
  // The embed must keep its bare shell: no double frame inside .gear__stage.
  const p = await browser.newPage({ viewport: { width: 800, height: 600 }, reducedMotion: 'reduce' });
  await p.goto(BASE + '/camera-3d.html?embed=1', { waitUntil: 'load' });
  await p.waitForTimeout(1200);
  ok('the embed keeps an unframed stage',
     await p.evaluate(() => {
       const s = getComputedStyle(document.querySelector('.stage-shell'));
       return s.borderTopWidth === '0px';
     }), true, true);
  await p.close();
}

// ----------------------------------------------- the photographs arrive --
// Entrances for the wall, the plates, the trust dots and the about photo.
// The load-bearing rule: triggers hang on the CONTAINER the pictures live
// in, never the section — measured, .gallery reveals while the wall is
// still ~200px below the fold, so a section-triggered stagger animates to
// nobody. And the words are never gated: the trust bar's five claims must
// compute opacity 1 with no scroll, in every mode.
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } }); // no reduce
  // Headless throttles the animation clock within a few seconds when nothing
  // consumes frames (measured: 133ms of animation time over 2.5s of wall
  // time). A tiny screenshot forces a BeginFrame, so this pump keeps the
  // clock honest while polling — a harness artifact, not a site behavior.
  const pump = async (cond, ms) => {
    const end = Date.now() + ms;
    for (;;) {
      await p.screenshot({ clip: { x: 0, y: 0, width: 8, height: 8 } });
      if (await p.evaluate(cond)) return true;
      if (Date.now() > end) return p.evaluate(cond);
      await p.waitForTimeout(90);
    }
  };
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForTimeout(400);
  ok('the trust claims are painted from byte one',
     await p.evaluate(() => [...document.querySelectorAll('.trust__item')]
       .every((t) => getComputedStyle(t).opacity === '1')), true, true);
  // Park the gallery section on-screen while the wall is still below the
  // fold: the section may reveal, the pictures must still be waiting.
  const staged = await p.evaluate(() => {
    const wall = document.querySelector('.masonry');
    window.scrollTo({ top: wall.getBoundingClientRect().top + scrollY - innerHeight - 60, behavior: 'instant' });
    return true;
  });
  await p.waitForTimeout(400);
  ok('a below-the-fold wall keeps its pictures held',
     staged && await p.evaluate(() =>
       getComputedStyle(document.querySelector('.masonry__btn picture')).opacity === '0'),
     true, true);
  // behavior:'instant' throughout this block: html scroll-behavior is
  // smooth, and an animated scroll eats the settle window before the
  // transitions even start.
  await p.evaluate(() => document.querySelector('.masonry').scrollIntoView({ block: 'center', behavior: 'instant' }));
  ok('the wall arrives frame by frame and settles complete',
     await pump(() => [...document.querySelectorAll('.masonry__btn picture')]
       .every((pic) => getComputedStyle(pic).opacity === '1' && getComputedStyle(pic).transform === 'none'), 4000),
     true, true);
  ok('the delay ladder exists and caps at the fold',
     await p.evaluate(() => {
       // Two transitioned properties → "0.1s, 0.1s"; sample the first.
       const d = (n) => getComputedStyle(document.querySelector(
         `.masonry__item:nth-child(${n}) .masonry__btn picture`)).transitionDelay.split(',')[0].trim();
       return d(1) === '0s' && d(3) === '0.1s' && d(7) === '0.3s' && d(18) === '0.3s';
     }), true, true);
  await p.evaluate(() => document.querySelector('.about').scrollIntoView({ block: 'center', behavior: 'instant' }));
  const printed = await pump(() => {
    // The filled end state serializes its keyframe units: 'inset(0px 0px 0%)'.
    // Accept any all-zero inset, whatever the unit mix.
    const c = getComputedStyle(document.querySelector('.about__photo')).clipPath;
    return /^inset\(0(px|%)?(\s+0(px|%)?){0,3}\)$/.test(c);
  }, 4500);
  ok('the about photograph prints in fully', printed, printed, true);
  await p.evaluate(() => document.querySelector('.services__grid').scrollIntoView({ block: 'center', behavior: 'instant' }));
  ok('the plates rise without their boxes moving',
     await pump(() => [...document.querySelectorAll('.card__media picture')]
       .every((pic) => getComputedStyle(pic).opacity === '1'), 4000), true, true);
  await p.close();
}
{
  // Reduce page: everything simply there, no scroll, no waiting.
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  ok('reduced motion holds no picture hostage',
     await page.evaluate(() =>
       getComputedStyle(document.querySelector('.masonry__btn picture')).opacity === '1'
       && getComputedStyle(document.querySelector('.about__photo')).clipPath === 'none'
       && [...document.querySelectorAll('.trust__dot')]
            .every((d) => getComputedStyle(d).transform === 'none')), true, true);
}
{
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const np = await ctx.newPage();
  await np.goto(BASE + '/', { waitUntil: 'load' });
  ok('with JS off, every photograph is simply there',
     await np.evaluate(() =>
       getComputedStyle(document.querySelector('.masonry__btn picture')).opacity === '1'
       && getComputedStyle(document.querySelector('.about__photo')).clipPath === 'none'), true, true);
  await ctx.close();
}

// --------------------------------------- the FLIP, the FAQ, the signature --
// Wave two of the design pass. The filter now runs through
// startViewTransition where it exists — the state must still land correctly
// through the async wrapper, and the one caller that needs synchronous state
// (photoFromHash, which opens a photo right after unhiding it) must not race.
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } }); // no reduce → VT path
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForTimeout(700);
  ok('every photograph carries a unique transition name',
     await p.evaluate(() => {
       const names = [...document.querySelectorAll('.masonry__item')].map((li) => li.style.viewTransitionName);
       return names.every(Boolean) && new Set(names).size === names.length;
     }), true, true);
  await p.locator('.chip[data-filter="weddings"]').click();
  await p.waitForTimeout(900);
  const kept = await p.locator('.masonry__item:not([hidden])').count();
  const want = await p.locator('.masonry__item[data-cat="weddings"]').count();
  ok('the animated filter still lands the right state', kept === want, kept, want);

  // The race: under a filter, a hash for a HIDDEN photo must open that exact
  // photo — applyFilterCore, not the a-frame-later animated wrapper.
  await p.locator('.chip[data-filter="prep"]').click();
  await p.waitForTimeout(900);
  await p.evaluate(() => { location.hash = '#photo-1'; });
  await p.waitForTimeout(900);
  const total = await p.locator('.masonry__item').count();
  ok('a hidden photo\'s link unhides synchronously and opens IT',
     (await p.locator('[data-lightbox-count]').textContent()) === `1 / ${total}`,
     await p.locator('[data-lightbox-count]').textContent(), `1 / ${total}`);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);

  ok('the footer signs off in champagne',
     await p.evaluate(() => {
       const s = getComputedStyle(document.querySelector('.site-footer'), '::before');
       return s.backgroundColor === 'rgb(201, 174, 140)' && parseInt(s.width) === 72;
     }), true, true);

  const faq = p.locator('.faq__item').first();
  await faq.locator('summary').click();
  await p.waitForTimeout(700);
  ok('a FAQ answer opens and is readable through the smooth path',
     await faq.locator('.faq__a').isVisible()
       && await p.evaluate(() => document.querySelector('.faq__item').open), true, true);
  await p.close();
}

// ----------------------------- the glimpse gets captions, dots, and honesty --
// The six category links on the money page had a hover scale for an
// affordance — which does not exist on a touch screen — and no position
// indicator, on the one strip of three that lacked one.
{
  const p = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await p.goto(BASE + '/cost.html', { waitUntil: 'load' });
  await p.waitForTimeout(700);
  const caps = await p.evaluate(() => [...document.querySelectorAll('.glimpse__link')].map((a) => {
    const cap = a.querySelector('.glimpse__cap');
    if (!cap) return { ok: false, why: 'no cap' };
    const r = cap.getBoundingClientRect();
    // The visible word (arrow stripped) must live inside the accessible name
    // — WCAG 2.5.3, and the assertion that stops a future copy edit from
    // silently breaking voice control.
    const word = [...cap.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    return { ok: r.width > 0 && r.height > 0 && word.length > 0 && (a.getAttribute('aria-label') || '').includes(word), word };
  }));
  ok('every glimpse frame wears its category, and the word is in the name',
     caps.length === 6 && caps.every((c) => c.ok), JSON.stringify(caps.filter((c) => !c.ok)), '[]');

  const dots = p.locator('.glimpse__dot');
  ok('the glimpse strip finally says "there are six"',
     (await dots.count()) === 6
       && (await p.locator('.glimpse__dot[aria-current="true"]').count()) === 1,
     `${await dots.count()} dots`, '6 dots, one current');
  await dots.nth(4).click();
  await p.waitForTimeout(600);
  ok('a dot is a control: the fifth dot shows the fifth frame',
     await p.evaluate(() => {
       const dots = [...document.querySelectorAll('.glimpse__dot')];
       return dots.findIndex((d) => d.getAttribute('aria-current') === 'true') === 4;
     }), true, true);
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.waitForTimeout(400);
  ok('no indicator paints over the desktop grid',
     await p.evaluate(() => getComputedStyle(document.querySelector('.glimpse__dots')).display === 'none'),
     true, true);
  await p.close();
}

// --------------------------------------- the quotes keep the no-JS contract --
// The other two carousels keep it: pure CSS scroll-snap, JS-built controls.
// The quotes track moves only by JS transform — with scripting off, two of
// three testimonials were clipped and unreachable while arrows, dots and a
// pause control rendered dead. Scriptless: stacked quotes, no controls.
{
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const np = await ctx.newPage();
  await np.goto(BASE + '/', { waitUntil: 'load' });
  const q = await np.evaluate(() => {
    const slides = [...document.querySelectorAll('.quotes__slide')];
    const controls = document.querySelector('.quotes__controls');
    return {
      readable: slides.length && slides.every((s) => {
        const r = s.getBoundingClientRect();
        return r.height > 0 && r.left >= -1 && r.right <= document.documentElement.scrollWidth + 1;
      }),
      slides: slides.length,
      controlsGone: !controls || getComputedStyle(controls).display === 'none',
    };
  });
  ok('with JS off, every testimonial is on the page and readable',
     q.readable && q.slides === 3, JSON.stringify(q), '3 stacked slides');
  ok('with JS off, no quote control renders dead', q.controlsGone, q.controlsGone, true);
  await ctx.close();
}
{
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  ok('with JS on, the quotes carousel is unchanged',
     await page.evaluate(() => {
       const controls = document.querySelector('.quotes__controls');
       const track = document.querySelector('.quotes__track');
       return getComputedStyle(controls).display !== 'none'
         && getComputedStyle(track).display === 'flex';
     }), true, true);
}

// ------------------------------------- campaign tags across the page hop --
// leadSource() reads utm_* off location.search and refuses a same-origin
// referrer, so the tag lives only in the address bar. In-page it was already
// guarded; the cross-page hop — cost.html's glimpse into the homepage form,
// the highest-intent path on the site — erased it. carryCampaign() rewrites
// same-origin cross-page links; everything else must stay untouched.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const np = await ctx.newPage();
  await np.goto(BASE + '/cost.html?utm_source=instagram&utm_campaign=aug', { waitUntil: 'load' });
  await np.waitForTimeout(600);
  const glimpseHref = await np.locator('.glimpse__link').first().evaluate((a) => a.href);
  const gu = new URL(glimpseHref);
  ok('a glimpse link carries the campaign, query before fragment',
     gu.searchParams.get('utm_source') === 'instagram'
       && gu.searchParams.get('utm_campaign') === 'aug'
       && gu.hash === '#gallery-weddings',
     `${gu.search} ${gu.hash}`, 'utm_source+utm_campaign #gallery-weddings');
  const untouched = await np.evaluate(() => {
    const skip = document.querySelector('.skip-link');
    const wa = document.querySelector('a[href^="https://wa.me/"]');
    const rf = document.querySelector('a[href*="regaflash.com"]');
    return {
      skip: skip ? skip.getAttribute('href') : '(none)',
      waClean: !wa || !wa.href.includes('utm_'),
      rfClean: !rf || !rf.href.includes('utm_'),
    };
  });
  ok('the skip link and external links carry no inherited tag',
     untouched.skip === '#main' && untouched.waClean && untouched.rfClean,
     JSON.stringify(untouched), 'skip #main, wa/regaflash clean');
  await np.locator('.glimpse__link').first().click();
  await np.waitForLoadState('load');
  await np.waitForTimeout(700);
  const landed = new URL(np.url());
  ok('the hop lands filtered with the campaign intact',
     landed.searchParams.get('utm_source') === 'instagram'
       && landed.hash === '#gallery-weddings'
       && (await np.locator('.chip[data-filter="weddings"]').getAttribute('aria-pressed')) === 'true',
     `${landed.search} ${landed.hash}`, 'utm intact, weddings filtered');
  await ctx.close();
}
{
  await page.goto(BASE + '/cost.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  ok('with no campaign in the address, every href is byte-identical',
     await page.evaluate(() => [...document.querySelectorAll('a[href]')]
       .every((a) => !a.href.includes('utm_'))), true, true);
}

// ------------------------------------------- the lightbox backdrop closes --
// The desktop counterpart of the phone's downward swipe. The trap: a click is
// dispatched on the common ancestor of pointerdown and pointerup targets, so
// a swipe that lifts over the surround fires click with target === lightbox —
// it must STEP, not dismiss. Only a press born on the backdrop closes.
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForTimeout(700);
  await p.locator('.masonry__btn').first().click();
  await p.waitForTimeout(600);
  await p.mouse.click(20, 400);
  await p.waitForTimeout(400);
  ok('a backdrop click closes the lightbox and clears the address',
     await p.evaluate(() => document.querySelector('[data-lightbox]').hidden)
       && new URL(p.url()).hash === '',
     new URL(p.url()).hash || '(clear)', '(clear)');
  await p.locator('.masonry__btn').first().click();
  await p.waitForTimeout(600);
  const fig = await p.locator('[data-lightbox-figure]').boundingBox();
  await p.mouse.click(fig.x + fig.width / 2, fig.y + fig.height / 2);
  await p.waitForTimeout(300);
  ok('a click on the photograph itself does not close',
     await p.evaluate(() => !document.querySelector('[data-lightbox]').hidden), true, true);
  // A mouse drag has no implicit pointer capture (touch does), so the
  // overshooting drag's pointerup lands on the backdrop and no step fires —
  // the assertion that matters on both input kinds is that the viewer
  // SURVIVES: pointerdown was born on the figure, so the click the drag
  // synthesises on the lightbox must not dismiss it.
  await p.mouse.move(fig.x + fig.width / 2, fig.y + fig.height / 2);
  await p.mouse.down();
  await p.mouse.move(20, fig.y + fig.height / 2, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(500);
  ok('a drag that lifts over the backdrop never dismisses the photo',
     await p.evaluate(() => !document.querySelector('[data-lightbox]').hidden), true, true);
  await p.close();
}

// ----------------------------------------------- the chips learn their size --
// "חתונות · 8" — the count each chip decides, on the chip. Derived from
// data-cat on BOTH sides of this assertion, so a future gallery edit cannot
// leave a chip lying; aria-hidden so the accessible name stays the bare word.
{
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const chips = await page.evaluate(() => [...document.querySelectorAll('.chip')].map((c) => {
    const cat = c.dataset.filter;
    const want = cat === 'all'
      ? document.querySelectorAll('.masonry__item').length
      : document.querySelectorAll(`.masonry__item[data-cat="${cat}"]`).length;
    const mark = c.querySelector('.chip__n');
    return {
      cat,
      counted: mark ? mark.textContent.trim() === `· ${want}` : false,
      hidden: mark ? mark.getAttribute('aria-hidden') === 'true' : false,
    };
  }));
  ok('every chip tells its true size, out loud to nobody',
     chips.every((c) => c.counted && c.hidden),
     JSON.stringify(chips.filter((c) => !c.counted || !c.hidden)), '[]');
  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(400);
  ok('the counted chips still fit a 360px shell',
     await page.evaluate(() => {
       const f = document.querySelector('.filters');
       return f.scrollWidth <= f.clientWidth + 1;
     }), true, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
}

// ------------------------------- the assistant's actions, off the homepage --
// assistant.js loads on three pages; the sections its actions point at exist
// on one. The old fallback wrote a fragment that resolves to nothing — panel
// closed, page unmoved: the visible-but-dead control this repo refuses to
// ship. Now the action navigates to index.html, carrying location.search —
// leadSource() reads utm_* at submit and refuses a same-origin referrer, so
// dropping the query here would erase the campaign that paid for the visit.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const np = await ctx.newPage();
  await np.goto(BASE + '/camera-3d.html?utm_source=check', { waitUntil: 'load' });
  await np.waitForTimeout(900);
  await np.locator('.am-launcher').click();
  await np.waitForTimeout(400);
  await np.locator('.am-action', { hasText: 'להשארת פרטים' }).first().click();
  await np.waitForLoadState('load');
  await np.waitForTimeout(400);
  const u = new URL(np.url());
  ok('the assistant form action leaves camera-3d with the campaign tag intact',
     u.pathname === '/index.html' && u.search === '?utm_source=check' && u.hash === '#contact',
     `${u.pathname}${u.search}${u.hash}`, '/index.html?utm_source=check#contact');
  await ctx.close();
}

// ----------------------------------- the assistant hands out filtered galleries --
// Three KB ids are the filter categories by name; the chips, the address bar
// and cost.html's glimpse all speak #gallery-<cat> — the assistant was the
// one surface that could not. And the eighth FAQ answer ("האולם שלנו חשוך")
// matched no keys at all: the site's own question got "אין לי תשובה מהאתר".
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const np = await ctx.newPage();
  await np.goto(BASE + '/', { waitUntil: 'load' });
  await np.waitForTimeout(900);
  await np.locator('.am-launcher').click();
  await np.waitForTimeout(400);
  await np.locator('.am-form__input').fill('אתם מצלמים גם את ההכנות?');
  await np.locator('.am-form__send').click();
  await np.waitForTimeout(900);
  const act = np.locator('.am-action', { hasText: 'לגלריית ההכנות' });
  ok('the prep answer offers the prep gallery', (await act.count()) > 0, await act.count(), '>0');
  await act.first().click();
  await np.waitForTimeout(600);
  ok('the assistant gallery action filters and signs the address',
     new URL(np.url()).hash === '#gallery-prep'
       && (await np.locator('.chip[data-filter="prep"]').getAttribute('aria-pressed')) === 'true',
     new URL(np.url()).hash, '#gallery-prep');

  await np.locator('.am-launcher').click();
  await np.waitForTimeout(400);
  await np.locator('.am-form__input').fill('האולם שלנו חשוך — איך זה מצטלם?');
  await np.locator('.am-form__send').click();
  await np.waitForTimeout(900);
  const bubbles = await np.locator('.am-msg--bot .am-bubble').allTextContents();
  const last = bubbles[bubbles.length - 1] || '';
  ok('the dark-hall FAQ finally has a route into the assistant',
     last.includes('פול־פריים') && !last.includes('אין לי תשובה'),
     last.slice(0, 40) + '…', 'the FAQ answer, not the fallback');
  await ctx.close();
}

// ----------------------------------------------------- the swipe hint, phone --
// The peek shows a sliver of the next frame; only motion proves the strip
// moves. Once, when the strip first fills half the viewport untouched, the
// frames lean and settle (.is-hinting). Two sides to hold: it fires — and
// cleans up — for a visitor with no motion preference, and it never lands at
// all under prefers-reduced-motion (the main `page` context emulates reduce).
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const np = await ctx.newPage();
  await np.goto(BASE + '/', { waitUntil: 'load' });
  await np.evaluate(() => document.querySelector('#gallery').scrollIntoView());
  const appeared = await np.waitForFunction(
    () => document.querySelector('[data-masonry]').classList.contains('is-hinting'),
    null, { timeout: 3000 }).then(() => true).catch(() => false);
  ok('the strip hints once when it first arrives', appeared, appeared, true);
  const cleaned = await np.waitForFunction(
    () => !document.querySelector('[data-masonry]').classList.contains('is-hinting'),
    null, { timeout: 3000 }).then(() => true).catch(() => false);
  ok('the hint ends and cleans up after itself', cleaned, cleaned, true);
  await ctx.close();
}
{
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.evaluate(() => document.querySelector('#gallery').scrollIntoView());
  await page.waitForTimeout(1400);
  ok('reduced motion suppresses the hint entirely',
     await page.evaluate(
       () => !document.querySelector('[data-masonry]').classList.contains('is-hinting')),
     true, true);
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

  // The gallery strip lives by the same two rules: CSS scroll-snap, so it
  // still swipes with scripting off, and a JS-built indicator, so no "3 / 18"
  // counter exists that nothing is driving.
  const gal = await np.evaluate(() => {
    const g = document.querySelector('[data-masonry]');
    return {
      total: g.children.length,
      rendered: [...g.children].filter((c) => {
        const r = c.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }).length,
      swipeable: g.scrollWidth > g.clientWidth + 1,
      counters: document.querySelectorAll('.gallery__count').length,
    };
  });
  ok('with JS off, every gallery frame still renders',
     gal.rendered === gal.total && gal.total === 18, `${gal.rendered}/${gal.total}`, '18/18');
  ok('with JS off, the gallery strip still swipes',
     gal.swipeable, gal.swipeable, 'scrollable');
  ok('with JS off, no gallery counter is left undriven',
     gal.counters === 0, gal.counters, 0);
  await ctx.close();
}

// ------------------------------- required fields say so to the eye as well --
// WCAG 3.3.2. aria-required tells a screen reader; it tells a sighted visitor
// nothing, and this form marked only the OPTIONAL fields — not even all of
// them. "מה מצלמים" is optional and unmarked while "סוג האירוע" sits beside it
// required and looks identical, so the only way to learn which was which was to
// submit and be rejected. Found when a real attempt to fill the form stalled on
// exactly that, twice, before reaching the network.
//
// Both pages that carry the form are checked, derived rather than listed: the
// homepage and cost.html hold separate copies of the same markup, and a fix
// applied to one of them is the drift this repo keeps producing.
{
  const pages = ['/', '/cost.html'];
  const bad = [];
  for (const url of pages) {
    const p = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await p.goto(BASE + url, { waitUntil: 'load' });
    await p.waitForTimeout(600);
    bad.push(...await p.evaluate((where) => {
      const out = [];
      for (const ctrl of document.querySelectorAll('[data-form] [aria-required="true"]')) {
        const field = ctrl.closest('.field');
        const label = field && field.querySelector('.field__label');
        const marker = label && label.querySelector('.field__req');
        const visible = marker && getComputedStyle(marker).display !== 'none'
                               && marker.textContent.trim().length > 0;
        if (!visible) out.push(`${where} ${ctrl.getAttribute('data-field') || ctrl.name}`);
      }
      return out;
    }, url));
    await p.close();
  }
  ok('every required field is marked required to the eye, not just to aria',
     bad.length === 0, bad.length ? bad : 'all marked on both forms', 'none unmarked');
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

  // The gallery strip has the same sideways-lazy defect and the same fix, at
  // eighteen frames instead of five. A waitForFunction rather than a fixed
  // sleep: eighteen images on this link legitimately take a few seconds, and
  // a timer tuned to today's weights is exactly the flake this file warns
  // about.
  await p.evaluate(() => document.querySelector('#gallery').scrollIntoView());
  const galleryLoaded = await p
    .waitForFunction(() => [...document.querySelectorAll('.masonry__photo')]
      .every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 10000 })
    .then(() => true, () => false);
  ok('every gallery frame has its photograph before it is swiped to',
     galleryLoaded, galleryLoaded ? 'all 18 loaded' : 'some frames still blank', 'none blank');
  await ctx.close();
}

// -------------------------------------------- the carousel stays on the phone --
// The strip exists because 150px rows wasted the gallery on a phone; the wall
// exists because a 1440px screen shows twelve frames at once and a carousel
// would show one. The media query is the only thing keeping them apart, so a
// desktop viewport asserts the wall did not quietly become a strip and the
// phone counter did not leak onto it.
{
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForTimeout(700);
  const d = await p.evaluate(() => {
    const g = document.querySelector('[data-masonry]');
    const c = document.querySelector('.gallery__count');
    const r = c && c.getBoundingClientRect();
    return {
      scrolls: g.scrollWidth > g.clientWidth + 1,
      counterBox: !!(r && r.width > 0 && r.height > 0),
    };
  });
  ok('at 1440px the gallery is still a wall', d.scrolls === false,
     d.scrolls ? 'the wall scrolls sideways' : 'wall', 'wall');
  ok('the strip counter does not appear on the wall', d.counterBox === false,
     d.counterBox ? 'counter has a box at 1440px' : 'hidden', 'hidden');
  await p.close();
}

// ------------------------------------------- the buttons keep their pills --
// The 8.2026 refresh made every action button a pill and every square icon
// button a circle (owner's call). A future "clean-up" flattening radii is the
// exact regression this guards: sampled on the shared 390px page, one probe
// per shape family.
{
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const flat = await page.evaluate(() =>
    ['.btn', '.form__submit', '.wa-float', '.burger', '.lightbox__close']
      .map((s) => {
        const el = document.querySelector(s);
        if (!el) return `${s} missing`;
        const r = parseFloat(getComputedStyle(el).borderRadius);
        return r >= 20 ? null : `${s} radius=${r}px`;
      })
      .filter(Boolean));
  ok('action buttons are pills, icon buttons are circles',
     flat.length === 0, flat.length ? flat : 'all rounded', 'no flattened control');
}

// ----------------------------------------- the cost page shows the work --
// The page that answers "how much" argued the studio's case in words while
// showing none of the photographs. Six frames now sit beside the "ask any
// studio for a full album" paragraph, as plain links to the gallery — the
// lightbox lives on the homepage, so a button here would be the dead-control
// trap. A phone gets the same scroll-snap strip as the gallery; a desktop
// gets a grid inside the prose measure.
{
  const p = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await p.goto(BASE + '/cost.html', { waitUntil: 'load' });
  await p.waitForTimeout(700);
  const m = await p.evaluate(() => {
    const g = document.querySelector('.glimpse');
    const links = [...g.querySelectorAll('.glimpse__link')];
    return {
      frames: links.length,
      rendered: links.filter((a) => { const r = a.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length,
      swipeable: g.scrollWidth > g.clientWidth + 1,
      // Each frame targets its own category's filtered view, not frame one
      // of eighteen — the fragments main.js resolves on the homepage.
      allToGallery: links.every((a) =>
        /^index\.html#gallery-(weddings|std|prep|events)$/.test(a.getAttribute('href'))),
    };
  });
  ok('the cost glimpse renders all six frames', m.frames === 6 && m.rendered === 6,
     `${m.rendered}/${m.frames}`, '6/6');
  ok('at 390px the cost glimpse is a strip', m.swipeable, m.swipeable, 'scrollable');
  ok('every glimpse frame leads to its own gallery category', m.allToGallery, m.allToGallery, true);
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.waitForTimeout(400);
  ok('at 1440px the cost glimpse is a grid, not a strip',
     await p.evaluate(() => {
       const g = document.querySelector('.glimpse');
       return g.scrollWidth <= g.clientWidth + 1;
     }), true, 'not scrollable');
  await p.close();
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
//
// A control that has been adopted into the site header is also skipped, and
// that is a narrowing of scope rather than a hole. What this test guards is a
// FLOAT — an element in a corner nobody expects, appearing over a field the
// visitor is aiming at. The header is the opposite: a fixed bar that overlays
// the top of every page on purpose, on every scroll position, and .burger and
// .nav-mobile__cta have always sat in it covering whatever passes underneath
// without that being a defect. Once .am-launcher joined them it became the
// same object, and holding it to the float rule would have meant blanking a
// button out of the header bar whenever the form scrolled past — a visible
// gap where a control should be. On the four legal pages the launcher and the
// FAB still float, and there the rule still applies to them.
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
        // In the header it is chrome, not a float — see the note above.
        if (n.closest('.site-header')) continue;
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

// ----------------------------------------- the source badge learns to read --
// After the campaign-tag work, `source` carries real attribution — and the
// badge classified all of it as "האתר". Now it names the channel. Two safety
// rules under test: the class comes from a FIXED key set (never lead data),
// and host matching is suffix-anchored — instagram.com.evil.example must not
// wear the Instagram badge.
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await p.route('**/auth/v1/token**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ access_token: 'fake.jwt.token', refresh_token: 'r', expires_in: 3600,
                           token_type: 'bearer', user: { id: 'u1', email: 't@example.com' } }),
  }));
  const mk = (i, source) => ({
    id: `00000000-0000-0000-0000-00000000000${i}`,
    created_at: '2026-08-02T10:00:00Z', name: 'בדיקה ' + i, phone: '0521234567',
    event_type: 'wedding', status: 'new', source,
  });
  await p.route('**/rest/v1/leads**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([
      mk(1, 'source=instagram · medium=cpc · campaign=spring · /cost.html'),
      mk(2, 'l.instagram.com · /'),
      mk(3, '/index.html'),
      mk(4, 'google-ads'),
      mk(5, 'instagram.com.evil.example · /'),
    ]),
  }));
  await p.goto(BASE + '/admin.html', { waitUntil: 'load' });
  await p.waitForTimeout(700);
  await p.fill('input[type=email]', 't@example.com').catch(() => {});
  await p.fill('input[type=password]', 'whatever').catch(() => {});
  await p.locator('button[type=submit]').first().click().catch(() => {});
  await p.waitForTimeout(1800);

  const badges = await p.evaluate(() =>
    [...document.querySelectorAll('.crm-card__badge--src')].map((n) => ({
      label: n.textContent, cls: n.className,
    })));
  ok('each channel wears its own name',
     badges.length === 5
       && badges[0].label === 'Instagram' && badges[1].label === 'Instagram'
       && badges[2].label === 'ישיר' && badges[3].label === 'Google Ads',
     JSON.stringify(badges.map((b) => b.label)), 'Instagram, Instagram, ישיר, Google Ads, …');
  ok('a lookalike host earns no Instagram badge and no unfixed class',
     badges[4].label !== 'Instagram' && !badges[4].cls.includes('--src-instagram')
       && /--src-(other|direct)\b/.test(badges[4].cls),
     JSON.stringify(badges[4]), 'other/direct');
  ok('the campaign row surfaces the parsed utm campaign',
     await p.evaluate(() => document.body.textContent.includes('spring')), true, true);
  await p.close();
}

// ------------------------------------ the pipeline stops hiding live money --
// "נוצר קשר" used to drop a lead from the default view into the same drawer
// as the dead deals — the whole live pipeline was invisible. Four shelves
// now; pre-migration rows (no status) keep the old handled behavior exactly;
// and the written-never-read lead_events table finally answers "how long has
// this one been sitting".
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.route('**/auth/v1/token**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ access_token: 'fake.jwt.token', refresh_token: 'r', expires_in: 3600,
                           token_type: 'bearer', user: { id: 'u1', email: 't@example.com' } }),
  }));
  const mk = (i, extra) => Object.assign({
    id: `00000000-0000-0000-0000-00000000001${i}`,
    created_at: '2026-08-02T10:00:00Z', name: 'ליד ' + i, phone: '0521234567',
    event_type: 'wedding',
  }, extra);
  await p.route('**/rest/v1/leads**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([
      mk(1, { status: 'new' }),
      mk(2, { status: 'contacted', handled: true }),
      mk(3, { status: 'proposal', handled: true }),
      mk(4, { status: 'signed', handled: true }),
      mk(5, { status: 'lost', handled: true }),
      mk(6, { handled: true }),   // pre-migration row: no status key at all
    ]),
  }));
  await p.route('**/rest/v1/contracts**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '[]',
  }));
  await p.route('**/rest/v1/lead_events**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([
      { lead_id: '00000000-0000-0000-0000-000000000012', type: 'contract_sent',
        detail: 'החוזה סומן כנשלח', created_at: '2026-08-07T10:00:00Z' },
      { lead_id: '00000000-0000-0000-0000-000000000012', type: 'status_changed',
        detail: 'נוצר קשר', created_at: '2026-08-03T10:00:00Z' },
    ]),
  }));
  await p.goto(BASE + '/admin.html', { waitUntil: 'load' });
  await p.waitForTimeout(700);
  await p.fill('input[type=email]', 't@example.com').catch(() => {});
  await p.fill('input[type=password]', 'whatever').catch(() => {});
  await p.locator('button[type=submit]').first().click().catch(() => {});
  await p.waitForTimeout(1800);

  const count = () => p.evaluate(() => document.querySelectorAll('.crm-card').length);
  ok('the default shelf holds only the truly new', (await count()) === 1, await count(), 1);
  await p.locator('[data-filter-handled="active"]').click();
  await p.waitForTimeout(400);
  ok('the live pipeline has its own shelf', (await count()) === 2, await count(), 2);
  await p.locator('[data-filter-handled="done"]').click();
  await p.waitForTimeout(400);
  ok('closed holds the finished and the pre-migration handled',
     (await count()) === 3, await count(), 3);
  await p.locator('[data-filter-handled="all"]').click();
  await p.waitForTimeout(400);
  ok('הכול still means all', (await count()) === 6, await count(), 6);
  ok('the alert stat counts everything not yet closed',
     await p.evaluate(() => document.querySelector('[data-stat="open"]').textContent) === '3',
     await p.evaluate(() => document.querySelector('[data-stat="open"]').textContent), '3');

  const timeline = await p.evaluate(() => {
    const cards = [...document.querySelectorAll('.crm-card')];
    const withTouch = cards.filter((c) => c.querySelector('.crm-card__stamp--touch'));
    const t = withTouch[0];
    return {
      touched: withTouch.length,
      stamp: t ? t.querySelector('.crm-card__stamp--touch').textContent : '',
      history: t ? t.querySelectorAll('.crm-history__item').length : 0,
    };
  });
  ok('exactly the lead with events wears a last-touch stamp',
     timeline.touched === 1 && /עודכן/.test(timeline.stamp) && /חוזה נשלח/.test(timeline.stamp),
     JSON.stringify(timeline), 'one card, עודכן + חוזה נשלח');
  ok('the full history opens to two entries', timeline.history === 2, timeline.history, 2);
  ok('the pipeline view raised no JS errors', errs.length === 0, errs, 'none');
  await p.close();
}
{
  // The quiet-failure contract: a database without lead_events must change
  // nothing — same discipline as contracts.
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.route('**/auth/v1/token**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ access_token: 'fake.jwt.token', refresh_token: 'r', expires_in: 3600,
                           token_type: 'bearer', user: { id: 'u1', email: 't@example.com' } }),
  }));
  await p.route('**/rest/v1/leads**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([{ id: '00000000-0000-0000-0000-000000000021',
      created_at: '2026-08-02T10:00:00Z', name: 'בדיקה', phone: '0521234567',
      event_type: 'wedding', status: 'new' }]),
  }));
  await p.route('**/rest/v1/contracts**', (route) => route.fulfill({ status: 404, body: '' }));
  await p.route('**/rest/v1/lead_events**', (route) => route.abort('failed'));
  await p.goto(BASE + '/admin.html', { waitUntil: 'load' });
  await p.waitForTimeout(700);
  await p.fill('input[type=email]', 't@example.com').catch(() => {});
  await p.fill('input[type=password]', 'whatever').catch(() => {});
  await p.locator('button[type=submit]').first().click().catch(() => {});
  await p.waitForTimeout(1800);
  ok('a database without lead_events changes nothing',
     await p.evaluate(() => document.querySelectorAll('.crm-card').length) === 1
       && errs.length === 0,
     JSON.stringify({ errs }), 'one card, no errors');
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

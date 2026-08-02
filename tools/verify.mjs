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
  const PAGES = ['/', '/camera-3d.html', '/accessibility.html', '/privacy.html',
                 '/terms.html', '/404-probe-path-that-does-not-exist'];
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

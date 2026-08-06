#!/usr/bin/env node
// Amora Studio — collect the exact strings assets/js/i18n.js would send,
// per public page, without touching the network.
//
//   npm install --no-save playwright-core pngjs   # ONE command — see below
//   node tools/collect-i18n-strings.mjs > strings.json
//
// WHEN TO RUN: after any copy change on a public page, to re-warm the
// translation cache so the first visitor in each language reads from the
// database instead of waiting ~15s for a model call. The 6.8.2026 warm-up
// procedure and its measurements live in docs/translation-flow.md.
//
// Why a real browser and not a regex: the collector must match i18n.js
// EXACTLY — same TreeWalker, same SKIP_TAGS, same [data-no-translate]
// scoping, same attribute list, same whitespace normalisation, same sha256
// of the normalised string. Two implementations of "what counts as visible
// Hebrew" WILL drift; running the same walk in the same DOM cannot.
//
// The dependency install is one command on purpose: this repo has no
// package.json, so a second `npm install --no-save` REMOVES the first
// package. Install playwright-core and pngjs together or verify.mjs loses
// its dependency. Run from the repo root so node_modules resolves.
//
// Output: {"/": [{h,s},...], "/cost.html": [...], "/camera-3d.html": [...]}
// — h is the sha256 hex of the normalised Hebrew, s the normalised Hebrew
// itself: exactly the shape the translate function's `items` field takes,
// and exactly what seeds private.i18n_warm. To warm: insert the rows there,
// then fire one net.http_post per language per page (serially — firing all
// nine at once exhausted the model providers' rate limits, measured 6.8).
//
// The four legal pages are absent by design: i18n.js's NO_TRANSLATE_PAGE
// refuses to machine-translate them, so warming them would cache
// translations no visitor is ever served.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8931;
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, rep) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    rep.writeHead(404); rep.end('nope'); return;
  }
  rep.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' });
  rep.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(PORT, r));

// Same launch line as tools/verify.mjs: the pre-installed Chromium at a
// fixed path, overridable with CHROMIUM_PATH. Letting Playwright resolve its
// own browser fails here — it looks for a pinned build that was never
// downloaded (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 in this environment).
const BROWSER = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath: BROWSER, args: ['--no-sandbox'] });
const page = await browser.newPage();
// The endpoint may be unreachable from the build environment; block it so a
// page that auto-restores a saved language never hangs the collector.
await page.route('**/functions/v1/translate', (r) => r.abort());

const PAGES = ['/', '/cost.html', '/camera-3d.html'];
const out = {};
for (const url of PAGES) {
  await page.goto(`http://127.0.0.1:${PORT}${url}`, { waitUntil: 'load' });
  // The assistant launcher and the accessibility trigger mount AFTER load.
  // Collecting before they exist silently drops their strings ("יש שאלה?"
  // and both aria-labels) — caught 6.8 when a second run of this collector
  // returned two fewer strings than the first. i18n.js itself never races
  // this because it collects on the visitor's first language click, long
  // after the widgets mounted. Wait for both, bounded so a page that
  // legitimately lacks one (the legal shells) cannot hang the run.
  await page.waitForSelector('.am-launcher', { timeout: 3000 }).catch(() => {});
  await page.waitForSelector('.a11y-fab', { timeout: 3000 }).catch(() => {});
  const items = await page.evaluate(async () => {
    // Mirrors assets/js/i18n.js exactly — change that file, change this.
    const SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, CODE: 1, PRE: 1, SVG: 1 };
    const ATTRS = ['aria-label', 'placeholder', 'title', 'alt', 'data-label'];
    const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
    const worth = (s) => { const n = norm(s); return n.length >= 2 && /[֐-׿]/.test(n); };
    const list = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentNode;
        if (!p || SKIP[p.nodeName]) return NodeFilter.FILTER_REJECT;
        if (p.closest('[data-no-translate]')) return NodeFilter.FILTER_REJECT;
        if (!worth(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n; while ((n = w.nextNode())) list.push(n.nodeValue);
    for (const a of ATTRS) {
      for (const el of document.body.querySelectorAll('[' + a + ']')) {
        if (el.closest('[data-no-translate]')) continue;
        const v = el.getAttribute(a);
        if (worth(v)) list.push(v);
      }
    }
    const sha = async (s) => {
      const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
    };
    const seen = new Set(), items = [];
    for (const raw of list) {
      const s = norm(raw);
      const h = await sha(s);
      if (seen.has(h)) continue;
      seen.add(h);
      items.push({ h, s });
    }
    return items;
  });
  out[url] = items;
  const chars = items.reduce((a, i) => a + i.s.length, 0);
  console.error(`${url.padEnd(18)} ${String(items.length).padStart(4)} unique strings, ${chars} chars`);
}
console.log(JSON.stringify(out));
await browser.close();
server.close();

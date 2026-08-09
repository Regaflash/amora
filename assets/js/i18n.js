/* Amora Studio — page translation.
 *
 * Translates the page the visitor is on, keeps the choice, and re-applies it
 * on the next page. Hebrew is the source of truth and is never fetched: it is
 * what the document already contains, so switching back is instant and
 * offline.
 *
 * Everything here is progressive. If the network is down, the endpoint is
 * unreachable, or a model refuses, the page simply stays Hebrew. There is no
 * loading state that can strand a visitor and no half-applied language.
 *
 * Vanilla on purpose — no framework, no bundler, no CDN. See CLAUDE.md.
 *
 * All four ship. English and Russian were held back on the belief that
 * flipping direction would break the layout, because styles.css is written
 * mostly with physical properties. That belief was never tested — the
 * stylesheet was counted, not rendered. Rendering it in LTR at 1280 and 390
 * showed a correct mirrored layout with no overflow: the grid and flex
 * containers already do the work, and the property count said nothing about
 * whether anything actually moved.
 *
 * Three rules did depend on direction and are now logical — the skip link,
 * and the two close buttons. The floating controls stay physical on purpose:
 * see the note at the top of assistant.css, which keeps the right-hand side
 * clear for the a11y toolbars that dock there whatever the direction.
 */
(function () {
  'use strict';

  var ENDPOINT = 'https://dkejuaildigikufrdiru.supabase.co/functions/v1/translate';
  var STORE = 'amora.lang';

  /* Every language the backend accepts. `on` gates what the visitor is
     offered — the switch that turns EN/RU on after the CSS work. */
  var LANGS = [
    { code: 'he', label: 'עברית', short: 'עב', dir: 'rtl', on: true },
    { code: 'ar', label: 'العربية', short: 'ع', dir: 'rtl', on: true },
    { code: 'en', label: 'English', short: 'EN', dir: 'ltr', on: true },
    { code: 'ru', label: 'Русский', short: 'RU', dir: 'ltr', on: true }
  ];

  var ENABLED = LANGS.filter(function (l) { return l.on; });
  if (ENABLED.length < 2) return;            // nothing to switch between

  /* Pages whose text must not be machine translated. The legal pages are
     drafts awaiting a lawyer; a machine rendering of them would be a document
     the studio never wrote and cannot stand behind. */
  var NO_TRANSLATE_PAGE = /(privacy|terms|accessibility)\.html$/i;

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, CODE: 1, PRE: 1, TEXTAREA: 1 };
  // The last five are the 3D stage's light-DOM attributes and the loading
  // veil's text source: shadow-root strings are unreachable to any walker,
  // so the Hebrew lives on host attributes this list CAN see, and
  // three-d-stage forwards changes inward via observedAttributes.
  // data-alt: the gallery buttons' caption source — the desktop hover chip
  // renders it via CSS content AND openLightbox composes the caption from
  // it, so an untranslated data-alt leaks Hebrew into both on an EN page.
  var ATTRS = ['alt', 'title', 'placeholder', 'aria-label', 'data-alt',
               'note', 'obj-label', 'glb-label', 'fallback-alt', 'data-loading-text'];

  /* ------------------------------------------------------------ helpers -- */

  function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }

  /* Worth translating? Skip pure punctuation, digits and Latin-only runs —
     "2026", "·" and "Amora Studio" cost a cache row and gain nothing. */
  function worth(s) {
    var n = norm(s);
    if (n.length < 2) return false;
    return /[֐-׿]/.test(n);        // contains Hebrew
  }

  function sha256(str) {
    var bytes = new TextEncoder().encode(str);
    return crypto.subtle.digest('SHA-256', bytes).then(function (buf) {
      var out = '', view = new Uint8Array(buf);
      for (var i = 0; i < view.length; i++) {
        out += view[i].toString(16).padStart(2, '0');
      }
      return out;
    });
  }

  /* ------------------------------------------------------------ collect -- */

  /* Each target remembers its Hebrew so switching back needs no network.
     The collector is INCREMENTAL, not memoized-once: this page rewrites
     itself constantly — live regions announce filters, the lightbox writes
     captions, the assistant builds its whole panel after load — and the old
     `if (targets) return targets` meant every one of those spoke Hebrew
     into a translated page forever. collect() now appends only what it has
     not seen, and prune() drops targets whose nodes have left the document —
     the ARRAY is what pins memory, not the WeakSet, and live regions replace
     their text node on every announcement. */
  var targets = [];
  var seenText = ('WeakSet' in window) ? new WeakSet() : null;
  var seenAttr = ('WeakMap' in window) ? new WeakMap() : null;

  function collect() {
    if (!seenText) { return targets; }   // ancient browser: first pass only

    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var p = node.parentNode;
        if (!p || SKIP_TAGS[p.nodeName]) return NodeFilter.FILTER_REJECT;
        if (p.closest('[data-no-translate]')) return NodeFilter.FILTER_REJECT;
        if (!worth(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = walker.nextNode())) {
      if (seenText.has(n)) continue;
      seenText.add(n);
      targets.push({ node: n, attr: null, he: n.nodeValue });
    }

    ATTRS.forEach(function (attr) {
      var nodes = document.body.querySelectorAll('[' + attr + ']');
      Array.prototype.forEach.call(nodes, function (el) {
        if (el.closest('[data-no-translate]')) return;
        var done = seenAttr.get(el);
        if (done && done[attr]) return;
        var v = el.getAttribute(attr);
        if (!worth(v)) return;
        if (!done) { done = {}; seenAttr.set(el, done); }
        done[attr] = 1;
        targets.push({ node: el, attr: attr, he: v });
      });
    });

    return targets;
  }

  /* ------------------------------------------------------------- apply --- */

  /* Every write this file makes goes through here: the MutationObserver
     below must not see our own writes as fresh content, or apply() feeds
     collect() feeds apply() forever. takeRecords() drains synchronously,
     while the flag covers the same tick. */
  var writing = false;

  function guarded(fn) {
    writing = true;
    try { fn(); } finally {
      if (observer) observer.takeRecords();
      writing = false;
    }
  }

  function toHebrew() {
    guarded(function () {
      collect().forEach(function (t) {
        if (t.attr) t.node.setAttribute(t.attr, t.he);
        else t.node.nodeValue = t.he;
      });
    });
  }

  function applyTo(list, map) {
    guarded(function () {
      list.forEach(function (t) {
        var hit = map[t.hash];
        if (!hit) return;                     // untranslated stays Hebrew
        /* Restore the original leading/trailing whitespace: the walker sees
           indentation, and dropping it would collapse the layout. */
        var lead = /^\s*/.exec(t.he)[0];
        var tail = /\s*$/.exec(t.he)[0];
        if (t.attr) t.node.setAttribute(t.attr, hit);
        else t.node.nodeValue = lead + hit + tail;
      });
    });
  }

  /* -------------------------------------------------------- translate --- */

  var inflight = false;
  var current = 'he';
  /* dict[lang][hash] = translated. New nodes whose strings were already
     translated once are served from here with NO network — the strip
     counter, a repeated live-region sentence, a reopened assistant. */
  var dict = {};

  /** Hash, split cached-vs-new, apply cache instantly, fetch only the rest.
   *  Both the full pass (a language click) and the observer's incremental
   *  flushes come through this one function. */
  function translateList(code, list, done) {
    Promise.all(list.map(function (t) {
      if (t.hash) return Promise.resolve(t);
      return sha256(norm(t.he)).then(function (h) { t.hash = h; return t; });
    })).then(function (all) {
      var cache = dict[code] || (dict[code] = {});
      var fromCache = {}, cachedAny = false;
      var seen = {}, misses = [];
      all.forEach(function (t) {
        if (cache[t.hash] !== undefined) {
          fromCache[t.hash] = cache[t.hash];
          cachedAny = true;
          return;
        }
        if (seen[t.hash]) return;
        seen[t.hash] = 1;
        misses.push({ h: t.hash, s: norm(t.he) });
      });
      /* Same guard as the network path below: hashing is async, and a batch
         resolving after the visitor switched back must not write foreign
         strings onto the restored page. */
      if (cachedAny && current === code) applyTo(all, fromCache);
      /* done(applied): whether at least one string in this batch was ever
         written in the requested language. The full pass uses it to decide
         a failed switch must be UNDONE, not merely un-announced. */
      if (!misses.length) { if (done) done(true); return; }
      var applied = cachedAny;
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: code, items: misses })
      }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function (data) {
        var t = data && data.t ? data.t : {};
        var keys = Object.keys(t);
        keys.forEach(function (h) { cache[h] = t[h]; });
        /* A visitor can switch languages while a batch is in flight; only
           the CURRENT language may write, the rest just warmed the cache. */
        if (current === code && keys.length) { applyTo(all, t); applied = true; }
      })['catch'](function () {
        /* Deliberately silent to the visitor. The page is still the Hebrew
           they could already read; an error banner would be noise. */
      }).then(function () { if (done) done(applied); });
    });
  }

  function translate(code) {
    var lang = ENABLED.filter(function (l) { return l.code === code; })[0];
    if (!lang || inflight) return;

    document.documentElement.setAttribute('lang', code);
    document.documentElement.setAttribute('dir', lang.dir);
    document.documentElement.removeAttribute('data-lang-boot');
    try { localStorage.setItem(STORE, code); } catch (e) { /* private mode */ }
    paint(code);
    current = code;

    if (code === 'he') { toHebrew(); return; }
    if (NO_TRANSLATE_PAGE.test(location.pathname)) return;

    var list = collect();
    if (!list.length) return;

    inflight = true;
    document.documentElement.setAttribute('data-translating', '');
    translateList(code, list, function (applied) {
      inflight = false;
      document.documentElement.removeAttribute('data-translating');
      /* A switch that produced NOTHING is undone entirely, still silently.
         The click committed four statements before the network answered —
         lang, dir, the pressed button, and localStorage — and on failure
         the visitor was left on a document claiming lang="en" over Hebrew
         glyphs (a screen reader speaks Hebrew in an English voice), with
         the failure PERSISTED so every next load repeated it. Guards, in
         order: only the initiating full pass reverts (the observer's late
         incremental flushes must never yank a translated page back);
         only when no string of this language has ever applied (the dict
         stays empty on total failure); and only if the visitor has not
         switched again mid-flight. */
      if (!applied
          && Object.keys(dict[code] || {}).length === 0
          && current === code) {
        current = 'he';
        document.documentElement.setAttribute('lang', 'he');
        document.documentElement.setAttribute('dir', 'rtl');
        paint('he');
        toHebrew();
        try { localStorage.removeItem(STORE); } catch (e) { /* private mode */ }
      }
    });
    startObserver();
  }

  /* ------------------------------------------------- the DOM keeps moving -- */

  /* Everything injected AFTER the switch — announceCount's sentences, the
     lightbox caption, the assistant's entire panel — used to stay Hebrew on
     a translated page. The observer waits out a 120ms lull, collects only
     what is new, and runs it through the same translateList: repeats come
     from the cache with no network, and only genuinely new strings travel. */
  var observer = null, flushTimer = null;

  function startObserver() {
    if (observer || !('MutationObserver' in window) || !seenText) return;
    observer = new MutationObserver(function () {
      if (writing || current === 'he') return;
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, 120);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS
    });
  }

  function prune() {
    targets = targets.filter(function (t) {
      return t.node.isConnected !== false;   // attr targets are elements too
    });
  }

  function flush() {
    flushTimer = null;
    if (current === 'he') return;
    prune();
    var before = targets.length;
    collect();
    var fresh = targets.slice(before);
    if (fresh.length) translateList(current, fresh);
  }

  /* ---------------------------------------------------------- the UI ---- */

  var buttons = [];

  function paint(active) {
    buttons.forEach(function (b) {
      var on = b.getAttribute('data-lang') === active;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function build() {
    var group = document.createElement('div');
    group.className = 'lang';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'שפת התצוגה');
    group.setAttribute('data-no-translate', '');

    ENABLED.forEach(function (l) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'lang__btn';
      b.setAttribute('data-lang', l.code);
      b.setAttribute('lang', l.code);
      b.setAttribute('aria-label', l.label);
      b.setAttribute('aria-pressed', 'false');
      b.title = l.label;
      b.textContent = l.short;
      b.addEventListener('click', function () { translate(l.code); });
      buttons.push(b);
      group.appendChild(b);
    });
    return group;
  }

  function mount() {
    // Disarms the head boot script's 4s watchdog: i18n is alive and now owns
    // dir/lang. The boot pre-set dir for a stored LTR language so the page
    // did not paint RTL and then mirror; from here translate() decides.
    document.documentElement.setAttribute('data-i18n-ready', '');
    var nav = document.querySelector('.nav');
    var cta = nav && nav.querySelector('.nav__cta');
    if (cta) nav.insertBefore(build(), cta);

    /* Mobile: the burger menu, where the desktop nav is hidden. Placed before
       the phone link so the last thing in the sheet stays the way to call. */
    var menu = document.getElementById('mobile-menu');
    if (menu) {
      var wrap = document.createElement('div');
      wrap.className = 'lang-mobile';
      wrap.appendChild(build());
      var phone = menu.querySelector('.menu__phone');
      if (phone) menu.insertBefore(wrap, phone);
      else menu.appendChild(wrap);
    }

    var saved;
    try { saved = localStorage.getItem(STORE); } catch (e) { saved = null; }
    var start = saved && ENABLED.some(function (l) { return l.code === saved; }) ? saved : 'he';
    paint(start);
    if (start !== 'he') translate(start);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();

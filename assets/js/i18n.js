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
  var ATTRS = ['alt', 'title', 'placeholder', 'aria-label'];

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

  /* Each target remembers its Hebrew so switching back needs no network. */
  var targets = null;

  function collect() {
    if (targets) return targets;
    targets = [];

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
      targets.push({ node: n, attr: null, he: n.nodeValue });
    }

    ATTRS.forEach(function (attr) {
      var nodes = document.body.querySelectorAll('[' + attr + ']');
      Array.prototype.forEach.call(nodes, function (el) {
        if (el.closest('[data-no-translate]')) return;
        var v = el.getAttribute(attr);
        if (!worth(v)) return;
        targets.push({ node: el, attr: attr, he: v });
      });
    });

    return targets;
  }

  /* ------------------------------------------------------------- apply --- */

  function toHebrew() {
    collect().forEach(function (t) {
      if (t.attr) t.node.setAttribute(t.attr, t.he);
      else t.node.nodeValue = t.he;
    });
  }

  function apply(map) {
    collect().forEach(function (t) {
      var hit = map[t.hash];
      if (!hit) return;                       // untranslated stays Hebrew
      /* Restore the original leading/trailing whitespace: the walker sees
         indentation, and dropping it would collapse the layout. */
      var lead = /^\s*/.exec(t.he)[0];
      var tail = /\s*$/.exec(t.he)[0];
      if (t.attr) t.node.setAttribute(t.attr, hit);
      else t.node.nodeValue = lead + hit + tail;
    });
  }

  /* -------------------------------------------------------- translate --- */

  var inflight = false;

  function translate(code) {
    var lang = ENABLED.filter(function (l) { return l.code === code; })[0];
    if (!lang || inflight) return;

    document.documentElement.setAttribute('lang', code);
    document.documentElement.setAttribute('dir', lang.dir);
    try { localStorage.setItem(STORE, code); } catch (e) { /* private mode */ }
    paint(code);

    if (code === 'he') { toHebrew(); return; }
    if (NO_TRANSLATE_PAGE.test(location.pathname)) return;

    var list = collect();
    if (!list.length) return;

    inflight = true;
    document.documentElement.setAttribute('data-translating', '');

    Promise.all(list.map(function (t) {
      return sha256(norm(t.he)).then(function (h) { t.hash = h; return t; });
    })).then(function (all) {
      var seen = {}, items = [];
      all.forEach(function (t) {
        if (seen[t.hash]) return;
        seen[t.hash] = 1;
        items.push({ h: t.hash, s: norm(t.he) });
      });
      return fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: code, items: items })
      });
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      apply(data && data.t ? data.t : {});
    })['catch'](function () {
      /* Deliberately silent to the visitor. The page is still the Hebrew they
         could already read; an error banner would be noise, not help. */
    }).then(function () {
      inflight = false;
      document.documentElement.removeAttribute('data-translating');
    });
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

    /* ?lang=en|ru|ar is the deep link: it lets an ad, an Instagram bio or a
       Business Profile land a visitor directly in their language — without
       it the only route to a translation is two taps into the menu. The
       parameter outranks the saved choice (a shared link should show what
       the sender saw), is persisted like a manual pick, and is then removed
       from the address bar so copying the URL onward shares the page, not
       the sender's language. No history entry is added. */
    var fromUrl = null;
    try {
      var q = new URLSearchParams(location.search).get('lang');
      if (q && ENABLED.some(function (l) { return l.code === q; })) {
        fromUrl = q;
        /* Persist here, not only inside translate(): ?lang=he must also win
           over a previously saved language, and translate() is never called
           for Hebrew. */
        try { localStorage.setItem(STORE, q); } catch (e2) { /* private mode */ }
        var clean = new URL(location.href);
        clean.searchParams.delete('lang');
        history.replaceState(history.state, '', clean);
      }
    } catch (e) { /* old browser: the menu still works */ }

    var saved;
    try { saved = localStorage.getItem(STORE); } catch (e) { saved = null; }
    var start = fromUrl ||
      (saved && ENABLED.some(function (l) { return l.code === saved; }) ? saved : 'he');
    paint(start);
    if (start !== 'he') translate(start);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();

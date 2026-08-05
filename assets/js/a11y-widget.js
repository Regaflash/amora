/* ==========================================================================
   Amora Studio — תפריט נגישות (accessibility widget)
   Pairs with assets/css/a11y-widget.css. No dependencies, no build step.

   Load it from <head>, before the page renders:
     <link rel="stylesheet" href="assets/css/a11y-widget.css" />
     <script src="assets/js/a11y-widget.js"></script>
   The stored modes are written onto <html> the moment this file runs, so a
   visitor who chose high contrast never sees a flash of the cream palette
   first. Everything that needs the DOM waits for DOMContentLoaded, so the
   script is also safe at the end of <body> — it just costs that flash.
   ========================================================================== */

(function () {
  'use strict';

  if (document.querySelector('.a11y-ui')) return;   // already loaded on this page

  var STORE_KEY = 'amora-a11y-v1';

  /** Root-absolute, not a bare filename. Every page of this site does live at
   *  the root — but 404.html is served AT the address that was not found, so on
   *  /old/link/that/died a relative href resolved to
   *  /old/link/that/accessibility.html and the statement link died with it.
   *  The accessibility statement is the one link on this site that must never
   *  404. */
  var STATEMENT_URL = '/accessibility.html';

  /** Steps, not a slider: a slider is hard to hit with a tremor or a
   *  keyboard, and 5 stops cover -10% to +50%. */
  var SIZES = [0.9, 1, 1.15, 1.3, 1.5];
  var SIZE_DEFAULT = 1;

  var HTML_NS = 'http://www.w3.org/1999/xhtml';
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), ' +
    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  /** The hero's background footage is a cross-origin YouTube frame, not a
   *  <video>. Nothing in this document can pause it directly, and no CSS rule
   *  can reach inside it: display:none stops it being painted, it does not stop
   *  it playing. The only channel into a frame we do not own is postMessage,
   *  and the message below is the one the player itself listens for.
   *
   *  Only the hero. The showreel further down the page is an iframe too, but a
   *  visitor put it there by pressing play and it carries its own controls;
   *  WCAG 2.2.2 is about motion that starts on its own. */
  var HERO_FRAME_SEL = '.hero__yt-frame';

  // Where a message from the hero's player may legitimately come from. The
  // embed is requested from nocookie and is free to redirect to youtube.com.
  var YT_ORIGINS = ['https://www.youtube-nocookie.com', 'https://www.youtube.com'];

  /** A player that is playing narrates itself several times a second, and a
   *  command sent back on every one of those is a message storm — worse, if a
   *  player ever answers a command with a message, an unbounded loop. Measured:
   *  without these two limits a stub that echoes its commands took 23,638
   *  messages in four seconds. So: no more than one command per gap, and only
   *  a handful per request. The budget is refilled whenever a mode changes, and
   *  it is spent only when the player actually speaks — so a player that is
   *  slow to load does not burn it while we wait. */
  var HERO_STOP_GAP = 700;      // ms between commands
  var HERO_STOP_TRIES = 8;      // commands per "stop it" request
  var heroStopAt = 0;
  var heroStopLeft = 0;

  /* ------------------------------------------------------------- icons --- */

  var ICONS = {
    // The international access symbol, drawn as strokes so it inherits colour.
    person: '<circle cx="12" cy="4.2" r="2.1"/><path d="M4.6 8.4h14.8"/>' +
            '<path d="M12 6.6v7.2"/><path d="M12 13.8l-3.4 6"/><path d="M12 13.8l3.4 6"/>',
    contrast: '<circle cx="12" cy="12" r="8.5"/>' +
              '<path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>',
    invert: '<path d="M20 14.2A8.4 8.4 0 0 1 9.8 4a8.5 8.5 0 1 0 10.2 10.2z"/>',
    links: '<path d="M10.2 13.4a3.9 3.9 0 0 0 5.9.4l2-2a3.9 3.9 0 0 0-5.5-5.5l-1.1 1.1"/>' +
           '<path d="M13.8 10.6a3.9 3.9 0 0 0-5.9-.4l-2 2a3.9 3.9 0 0 0 5.5 5.5l1.1-1.1"/>',
    motion: '<rect x="5" y="4.5" width="5" height="15" rx="1.2"/>' +
            '<rect x="14" y="4.5" width="5" height="15" rx="1.2"/>',
    font: '<text x="12" y="17.5" text-anchor="middle" font-size="15" font-family="Georgia, serif"' +
          ' fill="currentColor" stroke="none">Aa</text>',
    spacing: '<path d="M3.5 5.5h17"/><path d="M3.5 12h17"/><path d="M3.5 18.5h17"/>',
    cursor: '<path d="M6.5 3.2v14.4l3.6-3.6 2.3 5.1 2.4-1.1-2.3-5h4.6z"/>'
  };

  function svg(inner, size, cls) {
    return '<svg class="' + cls + '" width="' + size + '" height="' + size + '"' +
      ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"' +
      ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      inner + '</svg>';
  }

  /* ------------------------------------------------------------- modes --- */

  /** key      — what is stored and what data-a11y-mode carries
   *  cls      — the class dropped on <html>; all the work happens in CSS
   *  exclude  — a mode that cannot be on at the same time */
  var MODES = [
    { key: 'contrast', cls: 'a11y-contrast', icon: 'contrast', exclude: 'invert',
      label: 'ניגודיות גבוהה' },
    { key: 'invert', cls: 'a11y-invert', icon: 'invert', exclude: 'contrast',
      label: 'מצב כהה / היפוך צבעים' },
    { key: 'links', cls: 'a11y-links', icon: 'links', label: 'הדגשת קישורים' },
    { key: 'motion', cls: 'a11y-no-motion', icon: 'motion', label: 'עצירת אנימציות' },
    { key: 'font', cls: 'a11y-font', icon: 'font', label: 'גופן קריא' },
    { key: 'spacing', cls: 'a11y-spacing', icon: 'spacing', label: 'ריווח טקסט מוגדל' },
    { key: 'cursor', cls: 'a11y-cursor', icon: 'cursor', label: 'סמן עכבר גדול' }
  ];

  function defaults() {
    var s = { size: SIZE_DEFAULT };
    for (var i = 0; i < MODES.length; i++) s[MODES[i].key] = false;
    return s;
  }

  /* ----------------------------------------------------------- storage --- */

  // localStorage throws in Safari's private mode and on some file:// setups.
  // A visitor who cannot persist a choice should still get the choice.
  function readState() {
    var state = defaults();
    var raw;
    try { raw = window.localStorage.getItem(STORE_KEY); } catch (e) { return state; }
    if (!raw) return state;
    var saved;
    try { saved = JSON.parse(raw); } catch (e) { return state; }
    if (!saved || typeof saved !== 'object') return state;
    if (typeof saved.size === 'number' && SIZES[saved.size] !== undefined) {
      state.size = saved.size;
    }
    for (var i = 0; i < MODES.length; i++) {
      state[MODES[i].key] = saved[MODES[i].key] === true;
    }
    return state;
  }

  function saveState() {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  var state = readState();

  /* ------------------------------------------------------ reduced motion --- */

  var motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  /** Someone who has already asked their operating system for less motion has
   *  answered this question once. The toggle shows as on and locked rather
   *  than offering to switch their own setting back off underneath them. */
  function motionLocked() { return motionQuery.matches; }
  function motionOff() { return state.motion || motionLocked(); }

  /** Two modes want the hero's footage stopped, for two different reasons.
   *  "עצירת אנימציות" is the obligation: continuously moving footage behind the
   *  main heading is precisely what that control exists for. High contrast is
   *  housekeeping: the CSS repaints the scrim opaque and takes .hero__yt out of
   *  the paint tree, so the player is left spending someone's battery and data
   *  on pictures nobody can see. */
  function heroOff() { return motionOff() || state.contrast; }

  /* ------------------------------------------------------- apply modes --- */

  var root = document.documentElement;

  function applyModes() {
    for (var i = 0; i < MODES.length; i++) {
      var m = MODES[i];
      var on = m.key === 'motion' ? motionOff() : state[m.key];
      root.classList.toggle(m.cls, on);
    }
    enforceStopped();
  }

  /** Called after every change of mode, and again once the DOM exists. Both
   *  halves are cheap and idempotent, so it is safe to run on any doubt. */
  function enforceStopped() {
    heroStopLeft = heroOff() ? HERO_STOP_TRIES : 0;
    if (motionOff()) pauseMedia();     // pauseMedia covers the hero as well
    else if (heroOff()) pauseHeroFrames();
  }

  function pauseMedia() {
    if (!document.body) return;
    var vids = document.getElementsByTagName('video');
    for (var i = 0; i < vids.length; i++) {
      try { vids[i].pause(); } catch (e) {}
    }
    pauseHeroFrames();
  }

  function heroFrames() {
    if (!document.body || !document.querySelectorAll) return [];
    return document.querySelectorAll(HERO_FRAME_SEL);
  }

  /** The literal below is the player's own vocabulary and carries nothing about
   *  the visitor. '*' as the target origin rather than a fixed one: the embed
   *  may sit on either YouTube origin, and postMessage silently drops a message
   *  whose target does not match — a fixed guess would fail closed and leave
   *  the footage playing. The message can still only reach this one frame. */
  function pauseFrame(frame) {
    var win = frame && frame.contentWindow;
    if (!win) return;
    try {
      win.postMessage(JSON.stringify(
        { event: 'command', func: 'pauseVideo', args: [], id: 1, channel: 'widget' }), '*');
    } catch (e) {}
  }

  function pauseHeroFrames() {
    var frames = heroFrames();
    for (var i = 0; i < frames.length; i++) pauseFrame(frames[i]);
  }

  // main.js re-plays the hero loop whenever it scrolls back into view or the
  // tab regains focus. Without this, "stop animations" would last until the
  // next scroll. Capture phase so it lands before the loop actually starts.
  document.addEventListener('play', function (e) {
    if (!motionOff()) return;
    var t = e.target;
    if (t && t.tagName === 'VIDEO' && t.pause) t.pause();
  }, true);

  // The same defence, for the frame. A <video> can be paused the instant it
  // dares to play; a player inside a frame cannot, because a command sent
  // before it has finished loading is dropped on the floor and it then starts
  // by itself anyway. The only reliable moment is when it speaks to us — which
  // it does as soon as it is ready, and again on every state change. So each
  // time it does, while a mode that wants it stopped is on, it is told again.
  //
  // That closes the one window main.js cannot: a visitor who presses "stop
  // animations" while the frame is still loading. main.js pauses a player that
  // does not exist yet, and its reveal path only decides whether to show the
  // frame, not whether to re-stop it. Without this the footage would play on,
  // invisible, for as long as the page stayed open.
  window.addEventListener('message', function (e) {
    if (!e || !heroOff() || heroStopLeft <= 0) return;
    if (YT_ORIGINS.indexOf(e.origin) < 0) return;   // never trust a stray sender
    var now = +new Date();
    if (now - heroStopAt < HERO_STOP_GAP) return;
    var frames = heroFrames();
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === e.source) {
        heroStopAt = now;
        heroStopLeft--;
        pauseFrame(frames[i]);
        return;
      }
    }
  });

  // Modes are on <html> before the first paint; the text pass needs layout.
  applyModes();

  /* --------------------------------------------------------- text size ---
     The site sizes type with clamp(px, vw, px). Those never look at the root
     font-size, so `html { font-size: 125% }` — the usual widget trick — moves
     almost nothing here. Instead each text-bearing element is measured after
     clamp has already resolved, and its computed size is multiplied. Every
     element ends at exactly factor x its natural size, so nothing compounds
     through inheritance and the layout keeps its proportions. Line heights in
     styles.css are all unitless, so they scale with the text instead of
     clipping it. */

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, IFRAME: 1,
                    VIDEO: 1, IMG: 1, SOURCE: 1, PICTURE: 1, BR: 1, HR: 1,
                    HEAD: 1, LINK: 1, META: 1, CANVAS: 1 };
  var scaled = [];   // elements currently carrying a font-size we wrote

  function clearTextScale() {
    for (var i = 0; i < scaled.length; i++) scaled[i].style.removeProperty('font-size');
    scaled = [];
    root.classList.remove('a11y-text-scaled');
  }

  function applyTextScale() {
    if (!document.body) return;
    var factor = SIZES[state.size] || 1;
    clearTextScale();                       // always measure the page unscaled
    if (factor === 1) return;

    var all = document.body.getElementsByTagName('*');
    var targets = [document.body];
    var i, node;
    for (i = 0; i < all.length; i++) {
      node = all[i];
      if (node.namespaceURI !== HTML_NS) continue;      // skips <svg> subtrees
      if (SKIP_TAGS[node.tagName]) continue;
      if (ui && (node === ui || ui.contains(node))) continue;   // never the widget
      // Every element, not only the ones holding text right now: the form's
      // error messages and the lightbox counter are empty until something
      // happens, and they must not appear at 100% on a page set to 150%.
      targets.push(node);
    }

    // Read every size first, then write: one layout pass instead of one per
    // element, which is the difference between instant and visibly janky on a
    // page with several hundred nodes.
    var bases = [];
    for (i = 0; i < targets.length; i++) {
      bases.push(parseFloat(window.getComputedStyle(targets[i]).fontSize));
    }
    for (i = 0; i < targets.length; i++) {
      if (!bases[i]) continue;
      targets[i].style.setProperty(
        'font-size', Math.round(bases[i] * factor * 100) / 100 + 'px', 'important');
      scaled.push(targets[i]);
    }
    root.classList.add('a11y-text-scaled');
  }

  // clamp() re-resolves on resize, so the measured baselines go stale.
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (state.size === SIZE_DEFAULT) return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyTextScale, 250);
  }, { passive: true });

  // Elements built after the pass — main.js appends a WhatsApp fallback link
  // when a lead fails to send, and swaps the film poster for an iframe — would
  // otherwise appear at 100% on a page set to 150%. A whole re-run is 2ms and
  // is correct by construction; scaling the new subtree on its own would have
  // to unpick its already-scaled ancestors first to find its natural size.
  // The pass only writes style attributes, so it cannot retrigger this.
  var domTimer = null;
  if ('MutationObserver' in window) {
    new MutationObserver(function (records) {
      if (state.size === SIZE_DEFAULT) return;
      var interesting = false;
      for (var i = 0; i < records.length && !interesting; i++) {
        for (var j = 0; j < records[i].addedNodes.length; j++) {
          var n = records[i].addedNodes[j];
          if (n.nodeType === 1 && !(ui && ui.contains(n))) { interesting = true; break; }
        }
      }
      if (!interesting) return;
      if (domTimer) clearTimeout(domTimer);
      domTimer = setTimeout(applyTextScale, 300);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  /* ----------------------------------------------------------- the UI --- */

  var ui = null, fab = null, panel = null, sizeValue = null;
  var lastFocused = null;

  function buildUI() {
    ui = document.createElement('div');
    ui.className = 'a11y-ui';
    ui.setAttribute('dir', 'rtl');
    ui.setAttribute('lang', 'he');

    var rows = '';
    for (var i = 0; i < MODES.length; i++) {
      rows +=
        '<button class="a11y-item" type="button" aria-pressed="false" data-a11y-mode="' +
          MODES[i].key + '">' +
          svg(ICONS[MODES[i].icon], 22, 'a11y-item__icon') +
          '<span class="a11y-item__label">' + MODES[i].label +
            '<span class="a11y-item__hint" data-a11y-hint="' + MODES[i].key + '"></span>' +
          '</span>' +
          '<span class="a11y-item__state" aria-hidden="true">כבוי</span>' +
        '</button>';
    }

    ui.innerHTML =
      '<button class="a11y-fab" type="button" aria-expanded="false"' +
        ' aria-controls="a11y-panel" title="תפריט נגישות">' +
        svg(ICONS.person, 28, 'a11y-fab__icon') +
        '<span class="a11y-sr">תפריט נגישות</span>' +
      '</button>' +
      '<div class="a11y-panel" id="a11y-panel" role="dialog" aria-modal="true"' +
        ' aria-labelledby="a11y-panel-title" hidden>' +
        '<div class="a11y-panel__head">' +
          '<h2 class="a11y-panel__title" id="a11y-panel-title">תפריט נגישות</h2>' +
          '<button class="a11y-close" type="button" data-a11y-close>' +
            '<span aria-hidden="true">✕</span>' +
            '<span class="a11y-sr">סגירת תפריט הנגישות</span>' +
          '</button>' +
        '</div>' +
        '<div class="a11y-panel__body">' +
          '<div class="a11y-group" role="group" aria-labelledby="a11y-size-label">' +
            '<span class="a11y-group__label" id="a11y-size-label">גודל הטקסט</span>' +
            // RTL: the first child sits on the right, so "+" — the reason
            // anyone opens this menu — is the first thing under the reading
            // eye and the first stop for Tab.
            '<div class="a11y-size">' +
              '<button class="a11y-step" type="button" data-a11y-size="1"' +
                ' aria-label="הגדלת הטקסט">+</button>' +
              '<span class="a11y-size__value" data-a11y-size-value' +
                ' role="status" aria-live="polite">100%</span>' +
              '<button class="a11y-step" type="button" data-a11y-size="-1"' +
                ' aria-label="הקטנת הטקסט">−</button>' +
            '</div>' +
          '</div>' +
          rows +
        '</div>' +
        '<div class="a11y-panel__foot">' +
          '<button class="a11y-reset" type="button" data-a11y-reset>איפוס כל ההגדרות</button>' +
          '<a class="a11y-link" href="' + STATEMENT_URL + '">להצהרת הנגישות המלאה ←</a>' +
        '</div>' +
      '</div>';

    // Inserted at the top of <body>, not appended at the end. Appended last,
    // the trigger was the final stop in the tab order — 82 Tab presses from the
    // top of index.html — and the people it exists for are exactly the people
    // who arrive by keyboard. It goes immediately after the skip link so
    // "דילוג לתוכן" keeps first place. Nothing moves on screen: both of its
    // children are position:fixed, and every layer on this site carries an
    // explicit z-index, so paint order does not depend on DOM order.
    var skip = document.body.querySelector('.skip-link');
    var anchor = (skip && skip.parentNode === document.body) ? skip.nextSibling
                                                            : document.body.firstChild;
    if (anchor) document.body.insertBefore(ui, anchor);
    else document.body.appendChild(ui);

    fab = ui.querySelector('.a11y-fab');
    panel = ui.querySelector('.a11y-panel');

    // The trigger belongs with the other site controls, in the mobile header
    // bar. Only the BUTTON moves: the panel stays inside `ui` on body, because
    // a fixed modal nested in the header would inherit its stacking context and
    // its overflow. Tab order survives the move — the header is the first thing
    // after the skip link either way, which is the property the placement above
    // was chosen for. The four legal pages have no such bar and keep the
    // free-floating trigger.
    var bar = document.querySelector('.nav-mobile');
    if (bar) {
      fab.classList.add('a11y-fab--header');
      bar.appendChild(fab);
    }
    sizeValue = ui.querySelector('[data-a11y-size-value]');

    fab.addEventListener('click', function () { setOpen(panel.hidden); });
    ui.querySelector('[data-a11y-close]').addEventListener('click', function () {
      setOpen(false);
    });
    ui.querySelector('[data-a11y-reset]').addEventListener('click', resetAll);

    var steps = ui.querySelectorAll('[data-a11y-size]');
    for (var i = 0; i < steps.length; i++) {
      steps[i].addEventListener('click', function (e) {
        stepSize(Number(e.currentTarget.getAttribute('data-a11y-size')));
      });
    }

    var items = ui.querySelectorAll('[data-a11y-mode]');
    for (var j = 0; j < items.length; j++) {
      items[j].addEventListener('click', function (e) {
        toggleMode(e.currentTarget.getAttribute('data-a11y-mode'));
      });
    }

    syncUI();
  }

  /** Mirrors the state onto the controls. aria-pressed is the machine-readable
   *  half; the פועל/כבוי pill is the same fact for anyone reading the screen,
   *  and is aria-hidden so it is not announced twice. */
  function syncUI() {
    if (!ui) return;
    var i, on, item, locked;

    for (i = 0; i < MODES.length; i++) {
      item = ui.querySelector('[data-a11y-mode="' + MODES[i].key + '"]');
      if (!item) continue;
      locked = MODES[i].key === 'motion' && motionLocked();
      on = MODES[i].key === 'motion' ? motionOff() : state[MODES[i].key];
      item.setAttribute('aria-pressed', String(on));
      item.querySelector('.a11y-item__state').textContent = on ? 'פועל' : 'כבוי';
      var hint = item.querySelector('[data-a11y-hint="' + MODES[i].key + '"]');
      if (hint) hint.textContent = locked ? 'מופעל לפי הגדרת מערכת ההפעלה' : '';
      if (locked) item.setAttribute('aria-disabled', 'true');
      else item.removeAttribute('aria-disabled');
    }

    if (sizeValue) sizeValue.textContent = Math.round(SIZES[state.size] * 100) + '%';
    var minus = ui.querySelector('[data-a11y-size="-1"]');
    var plus = ui.querySelector('[data-a11y-size="1"]');
    // aria-disabled rather than disabled: the button stays in the tab order,
    // so nobody's focus silently disappears when they reach the end of the
    // scale. The handler simply does nothing.
    if (minus) minus.setAttribute('aria-disabled', String(state.size === 0));
    if (plus) plus.setAttribute('aria-disabled', String(state.size === SIZES.length - 1));

    fab.setAttribute('data-a11y-active', String(isTouched()));
  }

  function isTouched() {
    if (state.size !== SIZE_DEFAULT) return true;
    for (var i = 0; i < MODES.length; i++) {
      if (state[MODES[i].key]) return true;
    }
    return false;
  }

  /* -------------------------------------------------------- the actions --- */

  function toggleMode(key) {
    var mode = null, i;
    for (i = 0; i < MODES.length; i++) if (MODES[i].key === key) mode = MODES[i];
    if (!mode) return;
    if (key === 'motion' && motionLocked()) return;   // the OS already said so

    state[key] = !state[key];
    // High contrast and inversion repaint the same pixels in different
    // directions; running both leaves the page unreadable.
    if (state[key] && mode.exclude) state[mode.exclude] = false;

    applyModes();
    saveState();
    syncUI();
  }

  function stepSize(delta) {
    var next = state.size + delta;
    if (next < 0 || next > SIZES.length - 1) return;
    state.size = next;
    applyTextScale();
    saveState();
    syncUI();
  }

  function resetAll() {
    state = defaults();
    applyModes();
    applyTextScale();
    saveState();
    syncUI();
  }

  /* -------------------------------------------------- open / close / trap --- */

  function panelFocusables() {
    var list = panel.querySelectorAll(FOCUSABLE);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].offsetParent !== null) out.push(list[i]);
    }
    return out;
  }

  function setOpen(open) {
    if (!panel || panel.hidden === !open) return;
    if (open) lastFocused = document.activeElement;
    panel.hidden = !open;
    fab.setAttribute('aria-expanded', String(open));
    if (open) {
      var close = panel.querySelector('[data-a11y-close]');
      if (close) close.focus();
    } else if (lastFocused && lastFocused.focus) {
      lastFocused.focus();
      lastFocused = null;
    }
  }

  // Escape closes, Tab stays inside. Without the trap, Tab walks out of the
  // dialog and into the page behind it, which reads to a screen-reader user as
  // the dialog having closed on its own.
  document.addEventListener('keydown', function (e) {
    if (!panel || panel.hidden) return;
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key !== 'Tab') return;
    var items = panelFocusables();
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (!panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // A press anywhere outside closes, the way every other panel on the web
  // does. Presses on the widget itself are handled by their own listeners.
  document.addEventListener('pointerdown', function (e) {
    if (!panel || panel.hidden) return;
    if (ui && ui.contains(e.target)) return;
    setOpen(false);
  });

  /* ------------------------------------------------------------- start --- */

  /** camera-3d.html is both a page of its own and the thing index.html puts in
   *  an iframe. Inside a frame the modes still apply — the visitor's contrast
   *  choice should not stop at the edge of an embed — but the floating button
   *  does not, or the homepage would carry two of them. */
  function embedded() {
    try { return window.top !== window.self; } catch (e) { return true; }
  }

  function start() {
    if (!embedded()) buildUI();
    applyTextScale();
    // applyModes() ran during head parse, before <body> existed, so its own
    // call to this could not reach anything. This is the one that lands.
    enforceStopped();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Someone can turn reduced-motion on in the OS while the page is open.
  if (motionQuery.addEventListener) {
    motionQuery.addEventListener('change', function () {
      applyModes();
      syncUI();
    });
  }
})();

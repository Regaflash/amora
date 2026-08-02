/* ==========================================================================
   Amora Studio — interactions
   Ported from the Claude Design prototype's Component class
   (project/Amora Studio.dc.html). No dependencies, no build step.
   ========================================================================== */

(function () {
  'use strict';

  /** The prototype exposed these as editor props. Same defaults, same effect. */
  var CONFIG = {
    accent: null,   // e.g. '#B99B77' — overrides --champagne (and --line at 30%)
    showFilm: true, // false hides the "חתונה אחת, שלוש דקות" section
    reveal: true,   // false disables the scroll-in animation

    // --- Where the lead form delivers -------------------------------------
    // Option A · Supabase (recommended — the account is already connected).
    //   1. Run docs/supabase-leads.sql in the SQL editor.
    //   2. Settings → API → paste the project URL and the anon/publishable key.
    // The anon key is public by design; the RLS policy in that file allows
    // INSERT only, so nobody can read the leads with it.
    supabaseUrl: 'https://dkejuaildigikufrdiru.supabase.co',
    supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrZWp1YWlsZGlnaWt1ZnJkaXJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0ODkxODgsImV4cCI6MjEwMTA2NTE4OH0.rN244HfLzw7iI2J9uF9lmRoW96aMAN117fVWvlCDWLE',

    // Option B · any generic form service (Web3Forms, Formspree, Netlify).
    //   Web3Forms: https://api.web3forms.com/submit + the access key below.
    formEndpoint: '',
    formKey: '',

    // Until an endpoint is configured the form does NOT pretend to send. It
    // hands the completed details to WhatsApp and says so plainly — the
    // thank-you panel is reserved for a delivery we actually confirmed.
    whatsapp: '972503662699'
  };

  var MOBILE_QUERY = '(max-width: 760px)';
  var SCROLL_THRESHOLD = 80;   // px before the header goes opaque
  var WA_THRESHOLD = 0.3;      // scroll fraction before the WhatsApp button shows
  var SLIDE_INTERVAL = 7000;
  var SWIPE_MIN = 40;
  var SEND_DELAY = 1200;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var mq = window.matchMedia(MOBILE_QUERY);

  /* ------------------------------------------------------------- accent --- */

  if (CONFIG.accent) {
    document.documentElement.style.setProperty('--champagne', CONFIG.accent);
    document.documentElement.style.setProperty('--line', CONFIG.accent + '4d');
  }

  if (!CONFIG.showFilm) {
    var film = $('[data-section="film"]');
    if (film) film.remove();
  }

  /* ------------------------------------------------------------ whatsapp --- */

  function waLink(text) {
    return 'https://wa.me/' + CONFIG.whatsapp +
      (text ? '?text=' + encodeURIComponent(text) : '');
  }

  // Every wa.me link on the page opens with a sentence already written, so a
  // lead arrives with context instead of a bare "היי".
  $$('a[href^="https://wa.me/"]').forEach(function (a) {
    a.href = waLink(a.dataset.waText || 'היי, הגעתי מהאתר של Amora Studio ואשמח לבדוק זמינות לתאריך שלנו.');
  });

  /* ------------------------------------- broken images fall back to stripes -- */

  document.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && !t.dataset.fb) {
      t.dataset.fb = '1';
      t.removeAttribute('src');
      t.style.background = 'repeating-linear-gradient(135deg,#E8DCC8 0 6px,#F7F2EA 6px 14px)';
      t.style.minHeight = '180px';
    }
  }, true);

  /* ------------------------------------------------- header + progress bar --- */

  var header = $('[data-header]');
  var progress = $('[data-progress]');
  var waFloat = $('[data-wa]');

  // Cached: reading scrollHeight in the scroll handler forces a layout on
  // every frame, which is what makes scrolling stutter on cheap Androids.
  var scrollable = 1;
  function measure() {
    scrollable = Math.max(1, document.body.scrollHeight - window.innerHeight);
  }
  measure();
  window.addEventListener('resize', measure, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(measure).observe(document.body);

  function onScroll() {
    var y = window.scrollY;
    if (header) header.classList.toggle('is-scrolled', y > SCROLL_THRESHOLD);

    var pct = y / scrollable;
    if (progress) {
      progress.style.width = Math.min(100, Math.max(0, pct * 100)) + '%';
    }
    // Shown on every screen, not just mobile: couples compare vendors together
    // at a desktop, and that is exactly when they want to ask one question.
    if (waFloat) {
      waFloat.classList.toggle('is-visible', pct > WA_THRESHOLD);
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  onScroll();

  /* ---------------------------------------------------------- mobile menu --- */

  var menu = $('#mobile-menu');
  var burger = $('[data-menu-toggle]');

  function setMenu(open) {
    if (!menu || !burger) return;
    var wasOpen = !menu.hidden;
    if (wasOpen === open) return;
    menu.hidden = !open;
    burger.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) {
      var first = $('.menu__close', menu);
      if (first) first.focus();
    } else {
      burger.focus();
    }
  }

  if (burger) {
    burger.addEventListener('click', function () {
      setMenu(menu.hidden);
    });
  }
  var menuClose = $('[data-menu-close]');
  if (menuClose) menuClose.addEventListener('click', function () { setMenu(false); });
  $$('[data-menu-link]').forEach(function (a) {
    a.addEventListener('click', function () { setMenu(false); });
  });

  // Leaving mobile width closes the menu — matches the prototype's mq handler.
  mq.addEventListener('change', function () {
    setMenu(false);
    onScroll();
  });

  /* --------------------------------------------------------------- hero --- */

  // The hero plays the studio's own footage from YouTube. Two cuts, picked by
  // the viewport's orientation so neither is a centre-crop of the other: the
  // 16:9 showreel on landscape screens, the 9:16 Short on a phone held upright.
  //
  // What this costs, decided by the owner with the trade-offs on the table:
  // every visitor's browser now contacts Google the moment the page settles,
  // where the film section further down still asks first. privacy.html says so
  // in as many words — keep the two in step if this ever changes back.
  var HERO_YT = { wide: '2DHdORDXVmo', vertical: '3O13FGO_f08' };

  // Origins the embed may legitimately speak from. frame-src in vercel.json
  // already allows both; nocookie is what we ask for, youtube.com is where it
  // is free to redirect.
  var YT_ORIGINS = ['https://www.youtube-nocookie.com', 'https://www.youtube.com'];

  var YT_PROOF_TIMEOUT = 12000;  // ms a frame gets to prove it is alive
  var YT_SWAP_DELAY = 400;       // debounce across the orientation crossover
  var YT_PING_EVERY = 500;
  var YT_PING_MAX = 12;
  var YT_MAX_FAILS = 2;          // give up asking after this many silent frames

  /** Everything the player needs, in the URL. Loading YouTube's IFrame API
   *  script would put a third-party bundle on the critical path of a page that
   *  has none, and widen a CSP that currently names no external script at all.
   *  Every parameter below is doing a job — the player's defaults are all
   *  wrong for a background: controls, keyboard, related videos, annotations. */
  function heroSrc(id) {
    var params = [
      'autoplay=1',
      'mute=1',           // no browser autoplays with sound. Muted is the price.
      'loop=1',
      'playlist=' + id,   // loop is a playlist feature: a video must be its own
      'controls=0',
      'disablekb=1',
      'fs=0',
      'rel=0',            // since 2018 this only restricts suggestions to this
                          // channel, it does not remove them. What actually
                          // keeps the end-of-video grid off the hero is
                          // loop=1 + playlist above: the film never ends.
      'iv_load_policy=3', // no annotation cards over the headline
      'cc_load_policy=0', // and no captions either
      'modestbranding=1', // YouTube cut most of this parameter's effect in 2023;
                          // controls=0 is what actually removes the chrome
      'playsinline=1',    // iOS: play in place, do not take over the screen
      'enablejsapi=1',    // the postMessage channel only — no API script
      'widgetid=1',
      'hl=he'
    ];
    // The player uses this to address its messages back to us. location.origin
    // is absent on older browsers and meaningless off http(s).
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      params.push('origin=' + encodeURIComponent(
        location.origin || (location.protocol + '//' + location.host)));
    }
    return 'https://www.youtube-nocookie.com/embed/' + id + '?' + params.join('&');
  }

  function initHero() {
    var media = $('[data-hero]');
    if (!media) return;

    // Never spend someone's data plan on decoration. What is gone from this
    // guard is the phone-width skip: a phone now gets the vertical cut, which
    // is the entire reason a vertical cut exists, and YouTube hands it a stream
    // sized for the screen instead of the 1MB file we used to ship.
    var conn = navigator.connection || {};
    if (conn.saveData === true || /^(slow-2g|2g)$/.test(conn.effectiveType || '')) return;

    var portrait = window.matchMedia('(max-aspect-ratio: 1/1)');
    var root = document.documentElement;

    var wrap = null;      // .hero__yt — the clipping box
    var frame = null;     // the iframe inside it
    var current = null;   // 'wide' | 'vertical' — which cut is loaded
    var proven = false;   // has this frame ever spoken to us?
    var started = false;  // has the page finished loading?
    var visible = true;   // is the hero on screen?
    var fails = 0;
    var proofTimer = null, pingTimer = null, pings = 0, swapTimer = null;

    /** Three ways a visitor can say "not this". The OS setting; the floating
     *  widget's "stop animations"; the widget's high-contrast mode, which
     *  repaints the scrim opaque black over the hero anyway. The widget stops
     *  moving pictures by pausing <video> elements, and there is no longer a
     *  <video> here for it to reach — so the hero watches the class the widget
     *  writes on <html> instead. WCAG 2.2.2 asks that the stop actually stop. */
    function suppressed() {
      return reducedMotion ||
        root.classList.contains('a11y-no-motion') ||
        root.classList.contains('a11y-contrast');
    }

    function shouldPlay() { return started && visible && !document.hidden && !suppressed(); }

    function want() { return portrait.matches ? 'vertical' : 'wide'; }

    /** Nothing private travels in these: they are the two words the player
     *  itself listens for. '*' rather than a fixed origin because the embed may
     *  redirect between nocookie and youtube.com, and a mismatched target
     *  origin is silently dropped. The message can only reach the frame we
     *  hand it to. */
    function post(message) {
      if (!frame || !frame.contentWindow) return;
      try { frame.contentWindow.postMessage(JSON.stringify(message), '*'); } catch (e) {}
    }

    function command(func) {
      post({ event: 'command', func: func, args: [], id: 1, channel: 'widget' });
    }

    function stopTimers() {
      if (proofTimer) { clearTimeout(proofTimer); proofTimer = null; }
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    }

    function destroy() {
      stopTimers();
      if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
      wrap = null; frame = null; current = null; proven = false;
    }

    /** The one thing that must never happen is a black or empty hero, so the
     *  frame is faded in only on positive proof that the player is alive behind
     *  it. The iframe's `load` event is no such proof — measured, not assumed:
     *  a cross-origin iframe fires `load` for the browser's own error page too,
     *  63ms after a refused connection. A message from a YouTube origin can
     *  only have come from YouTube's own player code running in that frame. */
    function reveal() {
      if (proven || !wrap) return;
      proven = true;
      fails = 0;
      stopTimers();
      wrap.setAttribute('data-hero-yt', 'playing');
      if (shouldPlay()) wrap.classList.add('is-ready');
    }

    window.addEventListener('message', function (e) {
      if (!frame || !e || YT_ORIGINS.indexOf(e.origin) < 0) return;
      if (frame.contentWindow && e.source !== frame.contentWindow) return;
      reveal();
    });

    function build(which) {
      destroy();
      current = which;

      wrap = document.createElement('div');
      wrap.className = 'hero__yt hero__yt--' + which;
      wrap.setAttribute('aria-hidden', 'true');
      wrap.setAttribute('data-hero-yt', 'loading');
      // inert keeps focus out of the frame's *document*, not merely off the
      // frame element. Both, plus pointer-events:none, plus the scrim on top.
      if ('inert' in wrap) wrap.inert = true;

      frame = document.createElement('iframe');
      frame.className = 'hero__yt-frame';
      frame.title = 'רקע וידאו — Amora Studio';
      frame.setAttribute('tabindex', '-1');
      frame.setAttribute('aria-hidden', 'true');
      // Only what the player needs. Note picture-in-picture defaults to * and
      // reaches the frame regardless; it is unreachable here anyway because the
      // frame is inert, controls-free and pointer-events:none. No fullscreen, no
      // motion sensors — a decorative background has no business asking.
      frame.setAttribute('allow', 'autoplay; encrypted-media');
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.src = heroSrc(HERO_YT[which]);

      wrap.appendChild(frame);
      media.appendChild(wrap);

      // The IFrame API pings the player until it answers. This is that ping and
      // nothing else — if the player announces itself unprompted, the first
      // message wins and the pinging stops.
      pings = 0;
      pingTimer = setInterval(function () {
        pings++;
        // Only the pinging stops here. The proof timeout below is what decides
        // the frame's fate and must outlive it.
        if (proven || pings > YT_PING_MAX) {
          clearInterval(pingTimer); pingTimer = null; return;
        }
        post({ event: 'listening', id: 1, channel: 'widget' });
      }, YT_PING_EVERY);

      proofTimer = setTimeout(function () {
        // Silence. Either YouTube never arrived — a blocker, a corporate proxy,
        // a country that restricts it — or it arrived and never said so. Both
        // are better served by dropping the frame than by leaving an unseen
        // player spending someone's data, and the poster is a complete hero.
        fails++;
        destroy();
      }, YT_PROOF_TIMEOUT);
    }

    function suspend() {
      if (!wrap) return;
      // The poster is underneath, untouched, so the hero simply stops moving.
      // The frame is kept rather than removed: rebuilding it on every scroll
      // past would restart the film from the top and re-fetch it.
      wrap.classList.remove('is-ready');
      command('pauseVideo');
    }

    function resume() {
      if (!wrap) return;
      if (proven) wrap.classList.add('is-ready');
      command('playVideo');
    }

    function sync() {
      if (!shouldPlay()) { suspend(); return; }
      if (wrap && current === want()) { resume(); return; }
      if (fails >= YT_MAX_FAILS) return;   // YouTube is not coming. Stop asking.
      build(want());
    }

    // A MediaQueryList fires on the crossing, not on every resized pixel; the
    // debounce covers a slow window drag that wobbles over the square.
    function onCross() {
      if (swapTimer) clearTimeout(swapTimer);
      swapTimer = setTimeout(sync, YT_SWAP_DELAY);
    }
    if (portrait.addEventListener) portrait.addEventListener('change', onCross);
    else if (portrait.addListener) portrait.addListener(onCross);   // Safari < 14

    // The accessibility widget writes its modes onto <html>. Only a change in
    // the answer is acted on — <html> also picks up reveal-ready and the text
    // scaler's class, and neither is any business of the hero's.
    if ('MutationObserver' in window) {
      var wasSuppressed = suppressed();
      new MutationObserver(function () {
        var now = suppressed();
        if (now === wasSuppressed) return;
        wasSuppressed = now;
        sync();
      }).observe(root, { attributes: true, attributeFilter: ['class'] });
    }

    document.addEventListener('visibilitychange', sync);

    // Nothing loads for a hero nobody is looking at — a deep link to #contact
    // lands the visitor well past it — and playback stops once it scrolls away.
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) visible = entries[i].isIntersecting;
        sync();
      }, { threshold: 0.01 }).observe(media);
    }

    // Hold off until the page has settled: the poster is the key above-the-fold
    // paint (Chromium reports the <h1> as LCP) and
    // must not compete with a third-party player for bandwidth or main thread.
    var start = function () {
      setTimeout(function () { started = true; sync(); }, 200);
    };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
  }

  // A hero is decoration. Whatever it does, the gallery, the lightbox and the
  // lead form below it still have to work.
  try { initHero(); } catch (e) {}

  /* -------------------------------------------------- gallery + lightbox --- */

  var items = $$('[data-masonry] .masonry__item');
  var chips = $$('[data-filter]');
  var lightbox = $('[data-lightbox]');
  var lbFigure = $('[data-lightbox-figure]');
  var lbLabel = $('[data-lightbox-label]');
  var lbImage = $('[data-lightbox-img]');
  var lbCount = $('[data-lightbox-count]');
  var galleryStatus = $('[data-gallery-status]');

  var filter = 'all';
  var lbIndex = -1;
  var lastFocused = null;

  function visibleItems() {
    return items.filter(function (li) {
      return filter === 'all' || li.dataset.cat === filter;
    });
  }

  function applyFilter(next) {
    filter = next;
    items.forEach(function (li) {
      li.hidden = !(filter === 'all' || li.dataset.cat === filter);
    });
    chips.forEach(function (c) {
      c.setAttribute('aria-pressed', String(c.dataset.filter === filter));
    });
    closeLightbox();
    announceCount();
  }

  // A chip press silently rewrites the grid from 18 tiles to 3 or 4. aria-pressed
  // says which chip is on; nothing said how much of the gallery survived it.
  function announceCount() {
    if (!galleryStatus) return;
    var shown = visibleItems().length;
    galleryStatus.textContent = shown === 1
      ? 'מוצגת תמונה אחת מתוך ' + items.length
      : 'מוצגות ' + shown + ' תמונות מתוך ' + items.length;
  }

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () { applyFilter(chip.dataset.filter); });
  });

  /** Widest candidate in the picture, preferring WebP. The thumbnail's own
   *  currentSrc is the ~500px variant sized for the masonry column — far too
   *  soft for a lightbox that renders up to 1100px wide. */
  function largestSource(btn) {
    var webp = $('source[type="image/webp"]', btn);
    var img = $('img', btn);
    var best = null, bestW = -1;
    [webp && webp.getAttribute('srcset'), img && img.getAttribute('srcset')].forEach(function (set) {
      if (!set || best && webp && set !== webp.getAttribute('srcset')) return;
      set.split(',').forEach(function (part) {
        var m = part.trim().match(/^(\S+)\s+(\d+)w$/);
        if (m && Number(m[2]) > bestW) { bestW = Number(m[2]); best = m[1]; }
      });
    });
    return best || (img && (img.currentSrc || img.src)) || '';
  }

  function openLightbox(index) {
    var list = visibleItems();
    if (!list.length || !lightbox) return;
    lbIndex = (index + list.length) % list.length;

    var btn = $('.masonry__btn', list[lbIndex]);
    var alt = btn.dataset.alt;

    lbImage.src = largestSource(btn);
    lbImage.alt = alt;
    lbFigure.style.setProperty('--ratio', btn.dataset.ratio);
    lbCount.textContent = (lbIndex + 1) + ' / ' + list.length;

    if (lightbox.hidden) {
      lastFocused = document.activeElement;
      lightbox.hidden = false;
      document.body.style.overflow = 'hidden';
      $('[data-lightbox-close]').focus();
    }

    // Written last, and deliberately after the dialog is on screen: a live
    // region inside a hidden subtree is not announced. Stepping keeps focus on
    // the arrow button, so without this the photo changes in silence.
    lbLabel.textContent = alt + ' · תמונה ' + (lbIndex + 1) + ' מתוך ' + list.length;
  }

  function step(delta) {
    if (lbIndex < 0) return;
    openLightbox(lbIndex + delta);
  }

  function closeLightbox() {
    if (!lightbox || lightbox.hidden) return;
    lightbox.hidden = true;
    lbIndex = -1;
    // Cleared so that reopening the same photo is still a change the live
    // region can announce.
    if (lbLabel) lbLabel.textContent = '';
    if (menu && menu.hidden) document.body.style.overflow = '';
    // The opener can be filtered out from under us, and focusing a hidden
    // element silently drops focus to <body>.
    if (lastFocused && lastFocused.focus && lastFocused.offsetParent !== null) {
      lastFocused.focus();
    } else {
      var first = $('.masonry__item:not([hidden]) .masonry__btn');
      if (first) first.focus();
    }
    lastFocused = null;
  }

  items.forEach(function (li) {
    var btn = $('.masonry__btn', li);
    btn.addEventListener('click', function () {
      openLightbox(visibleItems().indexOf(li));
    });
  });

  var lbClose = $('[data-lightbox-close]');
  if (lbClose) lbClose.addEventListener('click', closeLightbox);
  var lbPrev = $('[data-lightbox-prev]');
  if (lbPrev) lbPrev.addEventListener('click', function () { step(-1); });
  var lbNext = $('[data-lightbox-next]');
  if (lbNext) lbNext.addEventListener('click', function () { step(1); });

  // RTL: ArrowRight walks back through the list, ArrowLeft walks forward.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && menu && !menu.hidden) setMenu(false);
    if (lbIndex < 0) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowRight') step(-1);
    if (e.key === 'ArrowLeft') step(1);
  });

  /* --------------------------------------------------- showreel (YouTube) --- */

  // The poster is a local image and the button is inert until clicked, so the
  // page costs nothing in third-party JS or cookies unless someone presses play.
  // youtube-nocookie defers YouTube's tracking cookie until playback starts.
  var filmBtn = $('[data-yt]');
  if (filmBtn) {
    filmBtn.addEventListener('click', function () {
      var id = filmBtn.dataset.yt;
      var frame = document.createElement('iframe');
      frame.src = 'https://www.youtube-nocookie.com/embed/' + id +
        '?autoplay=1&rel=0&modestbranding=1&playsinline=1&hl=he';
      frame.title = 'סרטון תדמית — Amora Studio';
      frame.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      filmBtn.replaceWith(frame);
      frame.focus();
    });
  }

  /* ---------------------------------------------------------- focus trap --- */

  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), ' +
    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  // Without this, Tab walks straight out of an open dialog and into the page
  // behind it, which for a screen-reader or keyboard user reads as the dialog
  // having closed.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    var modal = (menu && !menu.hidden) ? menu : (lightbox && !lightbox.hidden) ? lightbox : null;
    if (!modal) return;
    var items = $$(FOCUSABLE, modal).filter(function (el) { return el.offsetParent !== null; });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!modal.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  });

  /* ------------------------------------------------------- FAQ accordion --- */

  $$('details.faq__item').forEach(function (d) {
    var sign = $('.faq__sign', d);
    d.addEventListener('toggle', function () {
      if (sign) sign.textContent = d.open ? '–' : '+';
    });
  });

  /* --------------------------------------------------- testimonial slider --- */

  var track = $('[data-quotes-track]');
  var viewport = $('[data-quotes-viewport]');
  var dots = $$('[data-quotes-go]');
  // Derived from the DOM, not hardcoded: a testimonial can be removed by
  // deleting its .quotes__slide and its matching [data-quotes-go] button,
  // with no JS edit and no blank slide left behind.
  var SLIDES = track ? track.children.length : 0;
  var slide = 0;
  var touched = false;
  var autoTimer = null;

  function renderSlide() {
    if (!track) return;
    // RTL flex row: slide N sits to the left, so a positive X brings it in.
    track.style.transform = 'translateX(' + (slide * 100) + '%)';
    dots.forEach(function (d, i) {
      d.setAttribute('aria-current', String(i === slide));
    });
  }

  function goTo(index, byUser) {
    if (!SLIDES) return;
    slide = (index + SLIDES) % SLIDES;
    if (byUser) touched = true;
    renderSlide();
  }

  if (track) {
    var prev = $('[data-quotes-prev]');
    var next = $('[data-quotes-next]');
    if (prev) prev.addEventListener('click', function () { goTo(slide - 1, true); });
    if (next) next.addEventListener('click', function () { goTo(slide + 1, true); });
    dots.forEach(function (d) {
      d.addEventListener('click', function () { goTo(Number(d.dataset.quotesGo), true); });
    });

    if (viewport) {
      var startX = null;
      viewport.addEventListener('pointerdown', function (e) {
        startX = e.clientX;
        touched = true;
      });
      viewport.addEventListener('pointerup', function (e) {
        if (startX === null) return;
        var dx = e.clientX - startX;
        startX = null;
        if (Math.abs(dx) < SWIPE_MIN) return;
        // Dragging left in RTL means "back to the previous quote".
        goTo(slide + (dx < 0 ? -1 : 1), true);
      });
      viewport.addEventListener('pointercancel', function () { startX = null; });
    }

    // WCAG 2.2.2: anything that moves for more than 5s needs a way to stop it.
    // Quotes run 20-30 words — without this most visitors never finish one.
    var pauseBtn = $('[data-quotes-pause]');
    var paused = reducedMotion;

    function setPaused(next) {
      paused = next;
      if (pauseBtn) {
        pauseBtn.setAttribute('aria-pressed', String(paused));
        pauseBtn.setAttribute('aria-label', paused ? 'הפעלת החלפה אוטומטית' : 'עצירת החלפה אוטומטית');
        pauseBtn.classList.toggle('is-paused', paused);
      }
    }
    if (pauseBtn) pauseBtn.addEventListener('click', function () { setPaused(!paused); });
    setPaused(paused);

    autoTimer = setInterval(function () {
      if (paused || touched || document.hidden) return;
      goTo(slide + 1, false);
    }, SLIDE_INTERVAL);

    renderSlide();
  }

  /* ---------------------------------------------------------- lead form --- */

  var TYPE_LABEL = { wedding: 'חתונה', std: 'Save the Date', henna: 'חינה / אירוסין',
                     mitzvah: 'בר / בת מצווה', other: 'אירוע אחר' };
  var COVERAGE_LABEL = { both: 'סטילס + וידאו', stills: 'סטילס בלבד',
                         video: 'וידאו בלבד', unsure: 'עוד לא בטוחים' };

  var form = $('[data-form]');

  if (form) {
    var dateInput = $('[data-field="date"]', form);
    if (dateInput) dateInput.min = new Date().toISOString().slice(0, 10);

    // "בדיקת זמינות" is exactly the question a couple asks before the venue is
    // booked, and the coverage select already lets them say "עוד לא בטוחים".
    // Without this the date is a required field they have no honest way to fill.
    var dateTbd = $('[data-date-tbd]', form);
    function syncDateTbd() {
      if (!dateTbd || !dateInput) return;
      var tbd = dateTbd.checked;
      dateInput.disabled = tbd;
      dateInput.setAttribute('aria-required', String(!tbd));
      if (tbd) {
        dateInput.value = '';
        showError('date', '');
      }
    }
    if (dateTbd) {
      dateTbd.addEventListener('change', syncDateTbd);
      syncDateTbd();   // a reload can restore a checked box
    }

    var submitBtn = $('[data-submit]', form);
    var failure = $('[data-form-failure]', form);
    var fields = $('[data-form-fields]', form);
    var done = $('[data-form-done]', form);
    var sending = false;

    function showError(name, message) {
      var box = $('[data-error="' + name + '"]', form);
      var input = $('[data-field="' + name + '"]', form);
      if (box) {
        box.textContent = message || '';
        box.classList.toggle('is-shown', Boolean(message));
      }
      if (input) {
        if (message) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
      }
    }

    // Every field, not just the four validated ones: any edit must also drop the
    // failure panel, whose WhatsApp link was built once from the old values and
    // would otherwise keep sending details the visitor has already corrected.
    $$('[data-field]', form).forEach(function (input) {
      var name = input.getAttribute('data-field');
      function clear() {
        showError(name, '');
        if (failure) { failure.hidden = true; failure.textContent = ''; }
      }
      input.addEventListener('input', clear);
      input.addEventListener('change', clear);
    });

    function validate(values) {
      var errors = {};
      if (!values.name.trim() || values.name.trim().length < 2) {
        errors.name = 'נעים להכיר — איך קוראים לכם?';
      }
      // Strip the separators people actually type. Only spaces and hyphens were
      // stripped before, so a perfectly valid "(050) 366-2699" was rejected and
      // the lead bounced off its own contact form.
      if (!values.phone.trim()) {
        errors.phone = 'צריך מספר טלפון כדי לחזור אליכם';
      } else if (!/^0\d{1,2}\d{7}$|^\+?\d{9,15}$/.test(values.phone.replace(/[\s\-().]/g, ''))) {
        errors.phone = 'מספר טלפון לא תקין';
      }
      // The min attribute is decorative while the form carries novalidate, so a
      // past date sailed through to the studio. ISO yyyy-mm-dd compares exactly.
      if (values.dateTbd) {
        // Nothing to check — they have told us there is no date yet.
      } else if (!values.date) {
        errors.date = 'איזה תאריך אנחנו בודקים?';
      } else if (dateInput && dateInput.min && values.date < dateInput.min) {
        errors.date = 'התאריך כבר עבר — בחרו תאריך עתידי';
      }
      if (!values.type) errors.type = 'בחרו סוג אירוע';
      return errors;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (sending) return;

      var values = {
        name: $('[data-field="name"]', form).value,
        phone: $('[data-field="phone"]', form).value,
        date: $('[data-field="date"]', form).value,
        type: $('[data-field="type"]', form).value,
        message: $('[data-field="message"]', form).value,
        area: $('[data-field="area"]', form).value,
        coverage: $('[data-field="coverage"]', form).value,
        company: $('[data-field="company"]', form).value,
        dateTbd: Boolean(dateTbd && dateTbd.checked)
      };

      // Honeypot: a filled hidden field means a bot — drop it silently.
      if (values.company) return;

      var errors = validate(values);
      ['name', 'phone', 'date', 'type'].forEach(function (k) {
        showError(k, errors[k]);
      });
      if (Object.keys(errors).length) {
        var firstBad = $('[aria-invalid="true"]', form);
        if (firstBad) firstBad.focus();
        return;
      }

      var summary = [
        'פנייה חדשה מהאתר — Amora Studio',
        'שם: ' + values.name,
        'טלפון: ' + values.phone,
        'תאריך: ' + (values.dateTbd ? 'עוד לא נקבע' : values.date),
        'סוג אירוע: ' + (TYPE_LABEL[values.type] || values.type),
        values.coverage ? 'מה מצלמים: ' + (COVERAGE_LABEL[values.coverage] || values.coverage) : '',
        values.area ? 'אזור: ' + values.area : '',
        values.message ? 'הודעה: ' + values.message : ''
      ].filter(Boolean).join('\n');

      failure.hidden = true;
      sending = true;
      submitBtn.classList.add('is-sending');
      submitBtn.textContent = 'שולחים…';

      function succeed() {
        sending = false;
        submitBtn.classList.remove('is-sending');
        submitBtn.textContent = 'שלחו — נחזור אליכם היום';
        fields.hidden = true;
        done.hidden = false;
        done.setAttribute('tabindex', '-1');
        done.focus();
      }

      function fail(reason) {
        sending = false;
        submitBtn.classList.remove('is-sending');
        submitBtn.textContent = 'שלחו — נחזור אליכם היום';
        failure.hidden = false;
        failure.textContent = reason;
      }

      var endpoint = CONFIG.formEndpoint;
      var headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      var payload;

      if (CONFIG.supabaseUrl && CONFIG.supabaseKey) {
        endpoint = CONFIG.supabaseUrl.replace(/\/+$/, '') + '/rest/v1/leads';
        headers.apikey = CONFIG.supabaseKey;
        headers.Authorization = 'Bearer ' + CONFIG.supabaseKey;
        headers.Prefer = 'return=minimal';
        payload = {
          name: values.name.trim(),
          phone: values.phone.trim(),
          event_date: values.date || null,
          event_type: values.type || null,
          area: values.area || null,
          coverage: values.coverage || null,
          message: values.message || null
        };
      }

      // Nothing configured yet: hand the details to WhatsApp. The send is not
      // ours to confirm — the visitor still has to press send over there — so
      // succeed() must NOT run. Saying "קיבלנו" here would be a lie, and a
      // visitor who closes that tab becomes a lead the studio never hears about.
      if (!endpoint) {
        window.open(waLink(summary), '_blank', 'noopener');
        sending = false;
        submitBtn.classList.remove('is-sending');
        submitBtn.textContent = 'שלחו — נחזור אליכם היום';
        failure.hidden = false;
        // Assigning textContent also clears the anchor appended by a previous
        // submit, so repeated attempts do not stack links.
        failure.textContent = 'הפרטים מוכנים בוואטסאפ — נותר ללחוץ שם על שליחה, ' +
                              'ונחזור אליכם היום. אם החלון לא נפתח:';
        var hand = document.createElement('a');
        hand.href = waLink(summary);
        hand.target = '_blank';
        hand.rel = 'noopener';
        hand.className = 'form__done-cta';
        hand.style.marginTop = '12px';
        hand.textContent = 'פתיחת וואטסאפ עם הפרטים ←';
        failure.appendChild(document.createElement('br'));
        failure.appendChild(hand);
        return;
      }

      if (!payload) {
        payload = Object.assign({}, values);
        delete payload.company;
        if (CONFIG.formKey) payload.access_key = CONFIG.formKey;
        payload.subject = 'פנייה מהאתר — ' + values.name;
      }

      var abort = new AbortController();
      var timer = setTimeout(function () { abort.abort(); }, 12000);

      fetch(endpoint, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload),
        signal: abort.signal
      }).then(function (res) {
        clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        succeed();
      }).catch(function () {
        clearTimeout(timer);
        // Never lose the lead to a network blip — offer the WhatsApp route.
        fail('לא הצלחנו לשלוח כרגע. אפשר לנסות שוב, או לפנות ישירות בוואטסאפ ' +
             'ונחזור אליכם היום.');
        var alt = document.createElement('a');
        alt.href = waLink(summary);
        alt.target = '_blank';
        alt.rel = 'noopener';
        alt.className = 'form__done-cta';
        alt.style.marginTop = '12px';
        alt.textContent = 'שליחה בוואטסאפ ←';
        failure.appendChild(document.createElement('br'));
        failure.appendChild(alt);
      });
    });
  }

  /* ------------------------------------------------------ scroll reveal --- */

  var revealables = $$('[data-reveal]');

  // The CSS hides [data-reveal] only once this class is set, and a watchdog
  // reveals everything regardless after 3s. A JS error further up can no
  // longer take 7 of the 11 sections off the page.
  document.documentElement.classList.add('reveal-ready');
  setTimeout(function () {
    revealables.forEach(function (n) { n.classList.add('is-revealed'); });
  }, 3000);

  if (!CONFIG.reveal || reducedMotion || !('IntersectionObserver' in window)) {
    revealables.forEach(function (n) { n.classList.add('is-revealed'); });
  } else {
    var io = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          obs.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.05 });
    revealables.forEach(function (n) { io.observe(n); });
  }

  window.addEventListener('pagehide', function () {
    if (autoTimer) clearInterval(autoTimer);
  });
})();

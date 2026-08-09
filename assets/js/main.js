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
    showFilm: true, // false hides the "חתונה אחת, סרט אחד" section
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

  /* --------------------------------------- campaign tags across page hops --- */

  // leadSource() reads utm_* off location.search at submit and deliberately
  // refuses a same-origin referrer — so a campaign tag survives exactly as
  // long as it stays in the address bar. Within a page that is guarded (the
  // chips and the lightbox close both keep location.search); across pages it
  // was not: the cost.html glimpse links, .faq__more and the nav are bare
  // hrefs, and the hop from the money page to the homepage form erased the
  // tag. Measured: land on /cost.html?utm_source=instagram, tap a glimpse
  // frame, submit the form — source recorded "/". This rewrites same-origin
  // cross-page links to carry the tags. The URL API places the query before
  // the fragment on its own — string concatenation would have buried it
  // inside the hash and broken filterFromHash's exact match.
  //
  // Skipped on purpose: bare-fragment hrefs (same-document, search already
  // survives), cross-origin (wa.me, regaflash, Instagram must not inherit
  // our tags), same-pathname (covered by the fragment rule's logic), and any
  // link carrying its own query (it knows better). Links assistant.js builds
  // later are not covered here — its goTo() carries the search itself.
  // Nothing is stored or sent; a non-submitting visitor is still unmeasured.
  (function carryCampaign() {
    var params = new URLSearchParams(location.search);
    var tags = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']
      .filter(function (k) { return params.get(k); });
    if (!tags.length) return;
    $$('a[href]').forEach(function (a) {
      var raw = a.getAttribute('href');
      if (!raw || raw.charAt(0) === '#') return;
      var u;
      try { u = new URL(a.href, location.href); } catch (e) { return; }
      if (u.origin !== location.origin) return;
      if (u.pathname === location.pathname) return;
      if (u.search) return;
      tags.forEach(function (k) { u.searchParams.set(k, params.get(k)); });
      a.href = u.href;
    });
  })();

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
  // Set by the #gallery-<cat> / #photo-<n> load paths: a visitor who was SENT
  // here has already been vouched for, and measured at 390×844 they land at
  // 29.8% — fifteen pixels under WA_THRESHOLD, with the only always-on CTA
  // switched off. For #photo-<n> it is worse: body overflow is hidden behind
  // the lightbox, so they cannot even scroll to earn it. ORed into the
  // threshold term ONLY — never past !formOnScreen, which owns its own test.
  var waEngaged = false;

  // Cached: reading scrollHeight in the scroll handler forces a layout on
  // every frame, which is what makes scrolling stutter on cheap Androids.
  var scrollable = 1;
  function measure() {
    scrollable = Math.max(1, document.body.scrollHeight - window.innerHeight);
  }
  measure();
  window.addEventListener('resize', measure, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(measure).observe(document.body);

  // The header is transparent with ivory text until it scrolls, because on the
  // home page it sits over the hero film. A page with no hero starts on the
  // sand background, where ivory text on ivory is invisible — so such a page
  // marks itself [data-header-solid] and keeps the scrolled treatment
  // throughout. Checked once: the attribute cannot change under us.
  var headerAlwaysSolid = Boolean(header && header.hasAttribute('data-header-solid'));

  function onScroll() {
    var y = window.scrollY;
    if (header && !headerAlwaysSolid) {
      header.classList.toggle('is-scrolled', y > SCROLL_THRESHOLD);
    }

    var pct = y / scrollable;
    if (progress) {
      progress.style.width = Math.min(100, Math.max(0, pct * 100)) + '%';
    }
    // Shown on every screen, not just mobile: couples compare vendors together
    // at a desktop, and that is exactly when they want to ask one question.
    // ...but not while the lead form is on screen — see formOnScreen below.
    if (waFloat) {
      waFloat.classList.toggle('is-visible', (pct > WA_THRESHOLD || waEngaged) && !formOnScreen);
    }
  }

  /* ------------------------------------------ floats vs. the lead form --- */

  // Measured at 390px: the WhatsApp button (bottom-left, 96x50) and the
  // assistant launcher stacked above it (113x48) are painted OVER the form's
  // own inputs as those scroll through the bottom band. Not merely adjacent —
  // elementFromPoint at the intersection returned the float, so a tap aimed at
  // "שם מלא", "טלפון" or "אימייל" opened WhatsApp or the assistant instead.
  // That is the one form the whole site exists to get filled in.
  //
  // Both floats are redundant exactly where they do this damage: the form
  // carries its own WhatsApp line (.form__alt) and the assistant's job is to
  // answer the questions that lead here. So they stand down while the form is
  // on screen and come back when it is not.
  //
  // The WhatsApp button is gated by removing .is-visible rather than by a
  // competing CSS rule, deliberately: the reduced-motion override in
  // a11y-widget.css is keyed on .wa-float.is-visible, so this cannot
  // reintroduce the visible-but-dead state that override already caused once.
  // The accessibility FAB is NOT touched — it is the accessibility control and
  // stays reachable at all times; it also sits on the opposite edge and covers
  // only the trailing ~54px of a field.
  var formOnScreen = false;
  var leadForm = $('[data-form]');
  if (leadForm && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      formOnScreen = entries[0].isIntersecting;
      // The launcher belongs to assistant.js; a root class keeps that file's
      // ownership intact instead of reaching across into its DOM.
      document.documentElement.classList.toggle('form-in-view', formOnScreen);
      onScroll();
    }, { rootMargin: '0px 0px -8% 0px' }).observe(leadForm);
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
  var YT_RETRY_DELAY = 1500;     // before the second attempt, so a blip is not
                                 // retried into the same failing second

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

    // Warm the connection while the rest of the page is still loading. The
    // frame is not built until load + 200ms — deliberately, so it never
    // competes with the LCP paint — which means DNS, TCP and TLS to YouTube are
    // all still cold at the moment the src is finally set. On a phone that is
    // routinely 200-500ms before a single byte of video moves.
    //
    // Gated behind the same test as the build itself, and that gating is the
    // point: this opens a socket, and it must not open one for a visitor the
    // hero is going to skip anyway. Someone who asked for reduced motion, or
    // turned motion off in the accessibility menu, still never contacts
    // YouTube. A preconnect carries no request, no path and no cookie.
    if (!suppressed()) {
      var warm = document.createElement('link');
      warm.rel = 'preconnect';
      warm.href = 'https://www.youtube-nocookie.com';
      warm.crossOrigin = '';
      document.head.appendChild(warm);
    }

    var wrap = null;      // .hero__yt — the clipping box
    var frame = null;     // the iframe inside it
    var current = null;   // 'wide' | 'vertical' — which cut is loaded
    var proven = false;   // has this frame ever spoken to us?
    var started = false;  // has the page finished loading?
    var visible = true;   // is the hero on screen?
    var fails = 0;
    var proofTimer = null, pingTimer = null, pings = 0, swapTimer = null;
    var retryTimer = null;
    // Set once, when the vertical cut has burned both its attempts: a Short
    // can be embeddable on one surface and refused on another, and that
    // failure is per-VIDEO, not per-network — the wide cut was playing fine
    // on the desktop through the same code. Wide on a portrait screen is a
    // centre crop (the CSS already covers either box with either cut), and a
    // moving hero in the wrong aspect beats a still poster.
    var fallbackTo = null;
    // Autoplay bookkeeping: how many times this frame has been re-asked to
    // play after settling without playing. Reset per build.
    var nudges = 0, nudgeTimer = null;

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

    function want() { return fallbackTo || (portrait.matches ? 'vertical' : 'wide'); }

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
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (nudgeTimer) { clearTimeout(nudgeTimer); nudgeTimer = null; }
    }

    function destroy() {
      stopTimers();
      if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
      wrap = null; frame = null; current = null; proven = false;
    }

    /** Two different facts, deliberately kept apart.
     *
     *  "The frame loaded" is proved by any message from a YouTube origin — the
     *  iframe's own `load` event is not proof, measured rather than assumed: a
     *  cross-origin iframe fires `load` for the browser's own error page too,
     *  63ms after a refused connection. That fact stops the ping timers.
     *
     *  "The video is PLAYING" is a stricter fact and it is the one that decides
     *  whether the frame may be seen. Revealing on mere aliveness shipped a
     *  real defect: on an iPhone in Low Power Mode, autoplay is refused, the
     *  player answers anyway, and the hero faded in showing YouTube's unstarted
     *  UI — the film's title, the uploading channel's name and a row of
     *  transport controls, straight across the headline. controls=0 does not
     *  remove any of that; it only removes the bar during playback. And the
     *  centre controls cannot be cropped away by overscan the way a corner
     *  watermark can, because they sit in the middle of the frame.
     *
     *  So: only state 1 shows the frame, and anything else hides it again and
     *  leaves the poster — which is a still from the film — on screen. A hero
     *  that quietly does not move is a design; a hero wearing someone else's
     *  branding is a mistake. */
    var PLAYING = 1;

    function markLoaded() {
      if (proven) return;
      proven = true;
      fails = 0;
      stopTimers();
    }

    function reveal() {
      if (!wrap) return;
      wrap.setAttribute('data-hero-yt', 'playing');
      if (shouldPlay()) wrap.classList.add('is-ready');
    }

    function conceal() {
      if (!wrap) return;
      wrap.setAttribute('data-hero-yt', 'idle');
      wrap.classList.remove('is-ready');
    }

    /** The player reports its state in more than one message shape depending on
     *  version: {info:{playerState:n}} and {info:n} have both been observed.
     *  Read whichever is present and ignore anything that carries neither. */
    function stateOf(data) {
      var d = data;
      if (typeof d === 'string') {
        if (d.charAt(0) !== '{') return null;      // "null" and bare pings
        try { d = JSON.parse(d); } catch (err) { return null; }
      }
      if (!d || typeof d !== 'object') return null;
      var info = d.info;
      if (typeof info === 'number') return info;
      if (info && typeof info.playerState === 'number') return info.playerState;
      return null;
    }

    window.addEventListener('message', function (e) {
      if (!frame || !e || YT_ORIGINS.indexOf(e.origin) < 0) return;
      if (frame.contentWindow && e.source !== frame.contentWindow) return;
      markLoaded();
      var state = stateOf(e.data);
      if (state === null) return;                  // not a state message
      if (state === PLAYING) { reveal(); return; }
      conceal();
      // A player that loaded and then SETTLED without playing — unstarted
      // (-1), cued (5), or paused by nobody here (2) — was asked to play
      // exactly once, by the autoplay=1 in the URL, and mobile Safari is
      // free to refuse that ask. Nobody was asking again; the frame sat
      // proven-and-idle behind the poster forever. So ask again, bounded:
      // a muted programmatic play is precisely what the autoplay policies
      // permit without a gesture, and the mute command right before it is
      // the belt that keeps that true. Buffering (3) is the player already
      // trying — nudging it would only reset its work.
      if ((state === -1 || state === 5 || state === 2)
          && shouldPlay() && nudges < 3 && !nudgeTimer) {
        nudgeTimer = setTimeout(function () {
          nudgeTimer = null;
          nudges++;
          command('mute');
          command('playVideo');
        }, 1200);
      }
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
      nudges = 0;
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
        // YT_MAX_FAILS is 2, i.e. the frame is meant to get a second chance.
        // Nothing was ever scheduling it. After the first silence the hero sat
        // on its poster until the visitor happened to scroll away and back,
        // which is what fires sync() again — measured as one request, destroy
        // at 12s, then nothing at all for the next 21 seconds.
        //
        // That is the whole of "it works sometimes". A warm connection answers
        // inside the window and a cold mobile one does not, and the difference
        // between those two outcomes was a retry the code already believed it
        // was making. Note what this rules out: a rights or embedding block
        // would fail every single time, not intermittently.
        if (fails < YT_MAX_FAILS) {
          retryTimer = setTimeout(function () {
            retryTimer = null;
            if (shouldPlay() && !wrap) build(want());
          }, YT_RETRY_DELAY);
        } else if (!fallbackTo && which === 'vertical') {
          // The vertical cut is not coming. Before the hero resigns itself
          // to the poster, try the other film once: want() answers
          // `fallbackTo` from here on, so the orientation observer and
          // sync() stop steering back to the cut that just burned both its
          // chances. The wide cut gets its own fresh pair of attempts.
          fallbackTo = 'wide';
          fails = 0;
          retryTimer = setTimeout(function () {
            retryTimer = null;
            if (shouldPlay() && !wrap) build(want());
          }, YT_RETRY_DELAY);
        }
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
      // Deliberately does NOT add is-ready here. Ask the player to start; the
      // message handler shows the frame if and when it reports PLAYING. Showing
      // it on `proven` alone was the same defect in a second place — scrolling
      // back to a player that never started flashed its chrome over the hero.
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
  var lbCaption = $('[data-lightbox-caption]');
  var galleryStatus = $('[data-gallery-status]');

  var filter = 'all';
  var lbIndex = -1;
  var lastFocused = null;

  function visibleItems() {
    return items.filter(function (li) {
      return filter === 'all' || li.dataset.cat === filter;
    });
  }

  function applyFilterCore(next) {
    filter = next;
    items.forEach(function (li) {
      li.hidden = !(filter === 'all' || li.dataset.cat === filter);
    });
    chips.forEach(function (c) {
      c.setAttribute('aria-pressed', String(c.dataset.filter === filter));
    });
    closeLightbox();
    announceCount();
    stripAfterFilter();
  }

  // Where the engine has View Transitions, filtering FLIPs the wall: every
  // frame carries a view-transition-name (assigned below), so the survivors
  // GLIDE to their new positions and the filtered-out fade — instead of
  // eighteen photographs teleporting. Everywhere else the same core runs
  // with no animation, and both motion switches turn it off. The callback
  // runs a frame later — anything that needs the filter applied
  // SYNCHRONOUSLY (photoFromHash, which opens a photo right after unhiding
  // it) must call applyFilterCore directly.
  function applyFilter(next) {
    var animate = typeof document.startViewTransition === 'function'
      && !reducedMotion
      && !document.documentElement.classList.contains('a11y-no-motion');
    if (animate) document.startViewTransition(function () { applyFilterCore(next); });
    else applyFilterCore(next);
  }

  items.forEach(function (li, i) {
    li.style.viewTransitionName = 'photo-' + (i + 1);
  });

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
    chip.addEventListener('click', function () {
      applyFilter(chip.dataset.filter);
      // The address bar mirrors the filter, so any filtered view can be
      // copied and sent. replaceState, not location.hash: no history entry
      // per chip press, and no native anchor scroll for a fragment that is
      // not an element id. Clearing keeps pathname AND search — the form's
      // `source` field reads utm_* tags at submit, and "הכל" must not eat
      // the campaign tag that brought the visitor here.
      if (history.replaceState) {
        history.replaceState(null, '', chip.dataset.filter === 'all'
          ? location.pathname + location.search
          : '#gallery-' + chip.dataset.filter);
      }
    });
  });

  // "חתונות · 8": the size of each category, on the control that chooses it.
  // The count is already this gallery's vocabulary — announceCount speaks it,
  // the strip counter shows it — everywhere except the chip itself. Derived
  // from data-cat at init, never typed: a hand-edited gallery can desync a
  // typed number but not a derived one. aria-hidden, because a bare trailing
  // digit is noise to a screen reader and announceCount already says the real
  // sentence the moment the chip is pressed — same rule as .gallery__count.
  // JS off: the chips read exactly as before. Strictly additive.
  chips.forEach(function (chip) {
    var cat = chip.dataset.filter;
    var n = cat === 'all' ? items.length : items.filter(function (li) {
      return li.dataset.cat === cat;
    }).length;
    if (!n) return;
    var mark = document.createElement('span');
    mark.className = 'chip__n';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = ' · ' + n;
    chip.appendChild(mark);
  });

  // The chips filter for whoever is standing in front of them; a link could
  // not. #gallery-<cat> lands filtered and scrolled — "תראי את גלריית ההכנות"
  // becomes /#gallery-prep in a WhatsApp message. Unknown categories (and
  // #gallery itself, a real anchor) fall through untouched; the browser never
  // scrolls to these fragments on its own precisely because they are not
  // element ids, so the load path scrolls the section into view itself — no
  // `behavior` key, the stylesheet keeps answering html.a11y-no-motion and
  // the OS preference. announceCount speaks on this load path, and should:
  // the visitor asked for a filtered gallery and the live region says so.
  function filterFromHash() {
    var m = /^#gallery-([a-z]+)$/.exec(location.hash);
    if (!m || m[1] === 'all') return false;
    var known = chips.some(function (c) { return c.dataset.filter === m[1]; });
    if (!known) return false;
    applyFilter(m[1]);
    return true;
  }

  // And one photograph deeper: #photo-<n> (the number openLightbox writes to
  // the address) opens the lightbox on that exact photo. A pasted photo link
  // wins over whatever filter happens to be active — a hidden photo cannot
  // be opened, so the filter falls back to הכל first.
  function photoFromHash() {
    var m = /^#photo-(\d+)$/.exec(location.hash);
    if (!m) return false;
    var li = items[Number(m[1]) - 1];
    if (!li) return false;
    // Core, not the animated wrapper: openLightbox on the next line needs the
    // photo unhidden NOW, and startViewTransition applies a frame later —
    // the wrapped call would open visibleItems()[-1], the last photograph.
    if (li.hidden) applyFilterCore('all');
    openLightbox(visibleItems().indexOf(li));
    return true;
  }

  // NOT invoked here: photoFromHash → openLightbox → ++lbGen, and lbGen's
  // declaration is hoisted but its `= 0` is not — calling above it paints
  // nothing, forever (gen NaN !== lbGen NaN). The load-path call sits after
  // the lightbox wiring below.

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

  var lbGen = 0;   // guards against preloads resolving out of order

  function openLightbox(index) {
    var list = visibleItems();
    if (!list.length || !lightbox) return;
    lbIndex = (index + list.length) % list.length;

    var btn = $('.masonry__btn', list[lbIndex]);
    var alt = btn.dataset.alt;
    var url = largestSource(btn);
    var ratio = btn.dataset.ratio;
    var count = (lbIndex + 1) + ' / ' + list.length;
    var label = alt + ' · תמונה ' + (lbIndex + 1) + ' מתוך ' + list.length;
    var gen = ++lbGen;

    // The pixels and the words have to arrive together. An <img> keeps painting
    // the photograph it already holds until the next one has decoded, so
    // assigning .src and then writing the caption left the PREVIOUS wedding on
    // screen underneath the next one's alt text, counter and live-region
    // announcement. Measured on a throttled 900w variant: 400ms after pressing
    // next, the figure was 0.00% different from the previous photograph and
    // 96.85% different from the one it claimed to be showing. So the swap is
    // atomic — decode first, then change everything at once.
    function paint() {
      if (gen !== lbGen || lbIndex < 0) return;   // stepped past, or closed
      lbImage.src = url;
      lbImage.alt = alt;
      lbFigure.style.setProperty('--ratio', ratio);
      lbCount.textContent = count;
      if (lbCaption) lbCaption.textContent = alt;
      lbFigure.removeAttribute('data-loading');
      // Written last, and deliberately after the dialog is on screen: a live
      // region inside a hidden subtree is not announced. Stepping keeps focus on
      // the arrow button, so without this the photo changes in silence.
      lbLabel.textContent = label;
    }

    if (lightbox.hidden) {
      lastFocused = document.activeElement;
      lightbox.hidden = false;
      document.body.style.overflow = 'hidden';
      $('[data-lightbox-close]').focus();
    }

    // The address mirrors the open photograph the way it mirrors the filter:
    // #photo-<n> numbers the FULL set, not the filtered one, so the link
    // means the same photo whatever filter its sender had on.
    if (history.replaceState) {
      history.replaceState(null, '', '#photo-' + (items.indexOf(list[lbIndex]) + 1));
    }

    var pre = new Image();
    pre.onload = paint;
    pre.onerror = paint;    // a broken URL must still swap — alt text and all
    pre.src = url;
    // Cached, which is the common case: no wait, no flicker, no loading state.
    if (pre.complete) paint();
    else lbFigure.setAttribute('data-loading', '');

    // Warm both neighbours once the current request is on the wire, so a step
    // in either direction is the cached no-flicker path rather than a dimmed
    // wait. The cache dedupes repeats, and on a one-photo filter both
    // neighbours are this photo — harmless either way.
    [1, -1].forEach(function (d) {
      var n = list[(lbIndex + d + list.length) % list.length];
      if (n) new Image().src = largestSource($('.masonry__btn', n));
    });
  }

  function step(delta) {
    if (lbIndex < 0) return;
    openLightbox(lbIndex + delta);
  }

  function closeLightbox() {
    if (!lightbox || lightbox.hidden) return;
    lightbox.hidden = true;
    lbIndex = -1;
    // Hand the address back to the filter, or clear it. pathname AND search
    // survive — same reasoning as the chips: closing a photo must not eat
    // the utm_* tag the form's `source` field reads at submit.
    if (history.replaceState) {
      history.replaceState(null, '', filter === 'all'
        ? location.pathname + location.search
        : '#gallery-' + filter);
    }
    // Cleared so that reopening the same photo is still a change the live
    // region can announce. The caption follows: :empty is what hides its bar.
    if (lbLabel) lbLabel.textContent = '';
    if (lbCaption) lbCaption.textContent = '';
    if (menu && menu.hidden) document.body.style.overflow = '';
    // The opener can be filtered out from under us, and focusing a hidden
    // element silently drops focus to <body>.
    // The #photo-<n> visitor sees the strip for the first time NOW — retry
    // the one-shot hint that would otherwise have burned behind the overlay.
    // BEFORE the focus restoration below: focusing a button inside the strip
    // scrolls it (measured: two scroll events), which trips stripTouched and
    // would veto the very hint this call exists to rescue.
    playHint();
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

  // Web Share, where it exists — in practice the phones this viewer was
  // rebuilt for. Created here rather than in the markup so a browser without
  // navigator.share carries no dead control (the strip counter's rule). It
  // shares location.href, which openLightbox keeps pointed at the exact
  // photograph on screen; the focus trap queries FOCUSABLE per keypress, so
  // an appended button is trapped like the built-in three.
  var lbNav = $('.lightbox__nav');
  if (lbNav && navigator.share) {
    var lbShare = document.createElement('button');
    lbShare.type = 'button';
    lbShare.className = 'lightbox__step lightbox__share';
    lbShare.setAttribute('aria-label', 'שיתוף קישור לתמונה');
    lbShare.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="6.2" cy="12" r="2.5"/><circle cx="17.2" cy="5.6" r="2.5"/><circle cx="17.2" cy="18.4" r="2.5"/><path d="M8.4 10.8l6.6-4M8.4 13.2l6.6 4"/></svg>';
    lbShare.addEventListener('click', function () {
      // The query is stripped before the URL leaves the phone: a shared photo
      // goes to a DIFFERENT person, and the sender's utm_* tags must not
      // become that person's `source` — a word-of-mouth lead recorded as an
      // ad conversion is worse than an unattributed one. #photo-<n> numbers
      // the full set and photoFromHash never reads the query, so the link
      // still opens the same photograph.
      var u = new URL(location.href);
      u.search = '';
      // A rejected promise here is the visitor closing the share sheet.
      navigator.share({ title: document.title, url: u.href }).catch(function () {});
    });
    lbNav.appendChild(lbShare);
  }

  // The deferred load-path call (see the note above filterFromHash's group):
  // safe now that lbGen and the lightbox wiring exist.
  if (filterFromHash() || photoFromHash()) {
    var gallerySection = $('#gallery');
    if (gallerySection) gallerySection.scrollIntoView();
    waEngaged = true;
    onScroll();
  }
  window.addEventListener('hashchange', function () {
    if (photoFromHash() || filterFromHash()) {
      waEngaged = true;
      onScroll();
      return;
    }
    // Back out of a PUSHED #gallery-<cat> entry (the assistant's gallery
    // action pushes; the chips replace) lands on an empty hash. The address
    // no longer claims a filter, so the wall stops holding one — otherwise
    // the visitor sees three photos under a clean URL, copies a link that
    // lies, and the next lightbox close resurrects the abandoned fragment.
    // Empty hash ONLY: #faq or #about in the address is a section jump, not
    // a statement about the gallery, and resetting a filter because someone
    // used the nav would be destruction, not honesty.
    if (location.hash === '' && filter !== 'all') applyFilter('all');
  });

  // RTL: ArrowRight walks back through the list, ArrowLeft walks forward.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && menu && !menu.hidden) setMenu(false);
    if (lbIndex < 0) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowRight') step(-1);
    if (e.key === 'ArrowLeft') step(1);
  });

  // The figure is a swipe surface: sideways steps through the photographs
  // with the quotes viewport's exact sign convention — dragging left in RTL
  // means "back" — and a firm downward drag closes, the way every phone
  // photo viewer dismisses. The vertical threshold is doubled so a sloppy
  // sideways swipe with some droop does not throw the visitor out.
  if (lbFigure) {
    if (lbImage) lbImage.draggable = false;
    var lbStartX = null, lbStartY = null;
    lbFigure.addEventListener('pointerdown', function (e) {
      lbStartX = e.clientX;
      lbStartY = e.clientY;
    });
    lbFigure.addEventListener('pointerup', function (e) {
      if (lbStartX === null || lbIndex < 0) { lbStartX = lbStartY = null; return; }
      var dx = e.clientX - lbStartX;
      var dy = e.clientY - lbStartY;
      lbStartX = lbStartY = null;
      if (Math.abs(dy) > Math.abs(dx)) {
        if (dy > SWIPE_MIN * 2) closeLightbox();
        return;
      }
      if (Math.abs(dx) < SWIPE_MIN) return;
      step(dx < 0 ? -1 : 1);
    });
    lbFigure.addEventListener('pointercancel', function () { lbStartX = lbStartY = null; });
  }

  // Clicking the dark surround closes — the desktop counterpart of the
  // phone's downward swipe. The guard is the point, not a detail: a click is
  // dispatched on the nearest common ANCESTOR of pointerdown and pointerup
  // targets, so a horizontal swipe that starts on the figure and lifts over
  // the surround fires click with target === lightbox — and a naive check
  // would dismiss the viewer on every overshooting swipe instead of stepping
  // it. Only a press that both began and ended on the backdrop closes.
  if (lightbox) {
    var lbDownOnBackdrop = false;
    lightbox.addEventListener('pointerdown', function (e) {
      lbDownOnBackdrop = e.target === lightbox;
    });
    lightbox.addEventListener('click', function (e) {
      if (e.target === lightbox && lbDownOnBackdrop) closeLightbox();
    });
  }

  /* ---------------------------------------------- gallery strip (phone) --- */

  // Below 560px styles.css turns the wall into a scroll-snap strip; like the
  // services strip it is pure CSS and works with this file deleted. This adds
  // only what CSS cannot do: un-lazying frames that are off-screen sideways
  // (the same defect and the same fix as the services plates), a "3 / 18"
  // counter in the lightbox's vocabulary (eighteen dots is not an indicator),
  // and a scroll home when a filter collapses the strip under the visitor.
  var strip = $('[data-masonry]');
  var stripCount = null;
  var stripRatios = items.map(function () { return 0; });
  var stripBest = 0;

  // Swipe-hint state, at this scope because closeLightbox retries the hint.
  // playHint is a hoisted declaration and closeLightbox genuinely runs before
  // this line (applyFilter calls it on the #photo-<n> load path), so the
  // !strip guard is load-bearing, not paranoia — `var strip` above is
  // undefined at that moment. lbGen's comment tells the same story.
  var stripTouched = false, stripInView = false, hintSpent = false;

  function playHint() {
    if (hintSpent || reducedMotion || !strip || stripTouched || !stripInView) return;
    // The widget's motion toggle, not just the OS preference: under
    // html.a11y-no-motion the CSS blanks the animation, so the class would
    // never get its animationend, stick forever, and abruptly play whenever
    // the visitor re-enables motion. Refusing WITHOUT spending means the
    // hint stays available for a session where motion returns — the same
    // deal a fresh arrival gets.
    if (document.documentElement.classList.contains('a11y-no-motion')) return;
    if (lightbox && !lightbox.hidden) return;
    if (strip.scrollWidth <= strip.clientWidth + 1) return;
    hintSpent = true;
    strip.classList.add('is-hinting');
    // animationend bubbles up from the items; the first one ends them all.
    // animationcancel too: toggling no-motion ON mid-hint kills the
    // animation without an end event, and the class must not outlive it.
    var onHintDone = function () {
      strip.classList.remove('is-hinting');
      strip.removeEventListener('animationend', onHintDone);
      strip.removeEventListener('animationcancel', onHintDone);
    };
    strip.addEventListener('animationend', onHintDone);
    strip.addEventListener('animationcancel', onHintDone);
  }

  function paintStripCount() {
    if (!stripCount) return;
    var vis = visibleItems();
    var idx = vis.indexOf(items[stripBest]);
    // -1 means the best-covered frame was just filtered out; the strip has
    // just been scrolled home by stripAfterFilter, so "1 / N" is the truth.
    stripCount.textContent = (idx < 0 ? 1 : idx + 1) + ' / ' + vis.length;
  }

  function stripAfterFilter() {
    // Behaviour-based, not a media query: on the desktop wall the list does
    // not scroll and this is a no-op. scrollIntoView, not scrollLeft (its
    // sign and origin in an RTL scroller differ between engines); no
    // `behavior` key, so the stylesheet keeps answering html.a11y-no-motion
    // and the OS preference; block:'nearest' so the page itself stays put —
    // the filter chips sit directly above the strip.
    if (strip && strip.scrollWidth > strip.clientWidth + 1) {
      var first = $('.masonry__item:not([hidden]) .masonry__btn', strip);
      if (first) first.scrollIntoView({ inline: 'start', block: 'nearest' });
    }
    paintStripCount();
  }

  if (strip && 'IntersectionObserver' in window) {
    // Same reasoning as the services plates: loading="lazy" measures vertical
    // distance, and no amount of vertical scrolling approaches a frame that
    // is only off-screen sideways. On the wall all eighteen loaded during the
    // scroll-past anyway — this restores that budget, it does not add to it.
    new IntersectionObserver(function (entries, obs) {
      if (!entries[0].isIntersecting) return;
      $$('.masonry__photo', strip).forEach(function (img) {
        if (img.getAttribute('loading') === 'lazy') img.loading = 'eager';
      });
      obs.disconnect();
    }, { rootMargin: '800px 0px' }).observe(strip);

    // A first-time visitor sees 86% of one frame and a sliver of the next.
    // The peek says "more exists"; only motion proves the strip moves. Once,
    // the first time the strip fills half the viewport and nobody has swiped
    // it, the frames lean one gesture's worth into the reading direction and
    // settle back (@keyframes masonry-hint). CSS owns the motion and
    // html.a11y-no-motion already collapses it; the OS preference is checked
    // in playHint so the class never even lands. Behaviour-based desktop
    // guard, same as stripAfterFilter: a wall that does not scroll gets none.
    //
    // The observer used to disconnect on first intersection, and that burned
    // the one shot behind the #photo-<n> load path: the lightbox is an opaque
    // fixed overlay, the strip intersected UNDER it, the hint played to
    // nobody and was spent — for precisely the visitor a shared link brings,
    // the one the hint was written for. So the observer only tracks
    // visibility now; playHint is idempotent via hintSpent, refuses while the
    // lightbox is open, and closeLightbox retries it — the first moment that
    // visitor can actually see the strip.
    strip.addEventListener('scroll', function () { stripTouched = true; },
      { once: true, passive: true });
    new IntersectionObserver(function (entries) {
      stripInView = entries[0].isIntersecting;
      playHint();
    }, { threshold: 0.5 }).observe(strip);

    if (items.length > 1) {
      stripCount = document.createElement('p');
      stripCount.className = 'gallery__count';
      // The <ul> already announces "item N of 18", and the gallery has a live
      // region of its own — a second announcement here would talk over both.
      stripCount.setAttribute('aria-hidden', 'true');

      // root is the strip's own scrollport, so this is correct wherever the
      // page is scrolled — and tracks a half-finished swipe instead of
      // jumping only once the snap lands. Hidden frames are skipped so the
      // numerator is a position within the filtered set.
      var stripIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          stripRatios[items.indexOf(e.target)] = e.intersectionRatio;
        });
        var best = -1, bestR = -1;
        items.forEach(function (li, i) {
          if (li.hidden) return;
          if (stripRatios[i] > bestR) { bestR = stripRatios[i]; best = i; }
        });
        if (best >= 0) stripBest = best;
        paintStripCount();
      }, { root: strip, threshold: [0, 0.25, 0.5, 0.75, 1] });
      items.forEach(function (li) { stripIO.observe(li); });

      strip.parentNode.insertBefore(stripCount, strip.nextSibling);
      paintStripCount();
    }
  }

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

      // The poster is hidden, never destroyed. replaceWith() took the poster
      // <img> out of the document along with the button wrapping it, so a
      // visitor behind a corporate proxy, a national block or a content blocker
      // with a YouTube filter was left with a 1078x606 grey browser error page,
      // keyboard focus parked inside a dead cross-origin document, and no way
      // back short of guessing that a reload would help. The hero above already
      // refuses to trust a cross-origin iframe for exactly this reason.
      filmBtn.hidden = true;
      filmBtn.parentNode.insertBefore(frame, filmBtn.nextSibling);
      frame.focus();

      // Deliberately not a timeout that removes the frame on silence: this
      // embed has no enablejsapi handshake, so silence is not proof of failure
      // and a false negative would kill a film someone is watching. A control
      // the visitor presses cannot be wrong.
      var back = document.createElement('button');
      back.type = 'button';
      back.className = 'film__back';
      back.textContent = 'סגירת הסרטון';
      back.addEventListener('click', function () {
        if (frame.parentNode) frame.parentNode.removeChild(frame);
        if (back.parentNode) back.parentNode.removeChild(back);
        filmBtn.hidden = false;
        filmBtn.focus();
      });
      frame.parentNode.insertBefore(back, frame.nextSibling);
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
      // Only a recognised swipe claims control, and the goTo(…, true) in the
      // pointerup handler below already sets `touched` for it. Setting the flag
      // here, before any distance is known, meant an ordinary tap — or a
      // vertical page scroll whose finger merely landed on the quote block,
      // which touch-action: pan-y turns into a pointercancel that never reaches
      // pointerup — permanently stopped the 7s auto-advance for the rest of the
      // visit. Measured: a pan starting on the viewport froze the track at 0%;
      // the identical pan starting 30px higher advanced to 100%.
      viewport.addEventListener('pointerdown', function (e) {
        startX = e.clientX;
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

  /* ---------------------------------------- gallery glimpse (cost page) --- */

  // The cost page's six-frame glimpse is the same sideways strip on a phone,
  // with the same lazy defect as the services plates and the gallery strip:
  // loading="lazy" measures vertical distance, and frames that are only
  // off-screen sideways never load. Same one-shot fix.
  var glimpse = $('.glimpse');
  if (glimpse && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries, obs) {
      if (!entries[0].isIntersecting) return;
      $$('img', glimpse).forEach(function (img) {
        if (img.getAttribute('loading') === 'lazy') img.loading = 'eager';
      });
      obs.disconnect();
    }, { rootMargin: '800px 0px' }).observe(glimpse);

    // The one strip on the site with no position indicator: the services
    // strip has dots, the gallery strip has "3 / 18", and the glimpse — on
    // the highest-intent page — showed 1.3 of 6 frames and never said there
    // were six. Same vocabulary as the services dots (JS-built, so no dead
    // control with scripting off; aria-label from the frame's own photograph,
    // not a count to six; aria-current tracks the best-covered frame mid-
    // swipe). Display-gated in CSS at 560px, the glimpse's OWN breakpoint —
    // at 699px, the services gate, these would paint over the desktop grid.
    var frames = $$('.glimpse__item', glimpse);
    if (frames.length > 1) {
      var glDots = document.createElement('div');
      glDots.className = 'glimpse__dots';
      glDots.setAttribute('role', 'group');
      glDots.setAttribute('aria-label', 'מיקום ברצועת הגלריה');

      var glRatios = frames.map(function () { return 0; });
      var glButtons = frames.map(function (frame, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'glimpse__dot';
        b.setAttribute('aria-current', String(i === 0));
        var img = $('img', frame);
        b.setAttribute('aria-label', img && img.alt ? img.alt : 'תמונה ' + (i + 1));
        b.addEventListener('click', function () {
          // scrollIntoView, never scrollLeft; no `behavior` key — the same
          // two RTL/a11y reasons the services dots document at length.
          frame.scrollIntoView({ inline: 'start', block: 'nearest' });
        });
        glDots.appendChild(b);
        return b;
      });

      var glIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          glRatios[frames.indexOf(e.target)] = e.intersectionRatio;
        });
        var best = 0;
        for (var i = 1; i < glRatios.length; i++) if (glRatios[i] > glRatios[best]) best = i;
        glButtons.forEach(function (b, i) { b.setAttribute('aria-current', String(i === best)); });
      }, { root: glimpse, threshold: [0, 0.25, 0.5, 0.75, 1] });
      frames.forEach(function (f) { glIO.observe(f); });

      glimpse.parentNode.insertBefore(glDots, glimpse.nextSibling);
    }
  }

  /* ------------------------------------------------- services carousel --- */

  // The strip itself is pure CSS scroll-snap and works with this file deleted.
  // This adds only the position indicator: five plates swiping past with no
  // marker leaves no way to tell how many there are or where you are among
  // them. The dots are built here rather than sitting in index.html so they
  // cannot outlive the script that keeps them in sync — markup for a control
  // nothing is driving is exactly the visible-but-dead trap the WhatsApp
  // button already fell into once.
  var svcGrid = $('.services__grid');
  if (svcGrid && 'IntersectionObserver' in window) {
    var plates = [].slice.call(svcGrid.children);

    // Priming the strip's photographs, which the strip itself broke.
    //
    // The plates carry loading="lazy", which was right when they were a
    // vertical stack: scrolling past the section brought each one into the
    // viewport and the browser fetched it in time. Laid out sideways, the
    // fifth plate sits ~1122px beyond the right edge and NO amount of vertical
    // scrolling ever brings it near — so it stayed unfetched until the swipe
    // that revealed it. Measured at 390px on a throttled link (1.6Mbps,
    // 150ms): four plates loaded, the fifth blank, and after a swipe it stayed
    // blank ~500ms while the snap itself finishes in ~300. The visitor lands on
    // an empty card and watches the photograph turn up.
    //
    // So: once the section is within a screen of the viewport, stop being lazy
    // about the plates that are only off-screen sideways. Nothing is fetched
    // earlier than before on first paint — the section is far below the fold,
    // and this fires no sooner than the old lazy trigger would have. It just
    // counts distance the way the layout actually runs.
    new IntersectionObserver(function (entries, obs) {
      if (!entries[0].isIntersecting) return;
      plates.forEach(function (plate) {
        var img = $('img', plate);
        if (img && img.getAttribute('loading') === 'lazy') img.loading = 'eager';
      });
      obs.disconnect();
    }, { rootMargin: '800px 0px' }).observe(svcGrid);

    if (plates.length > 1) {
      var svcDots = document.createElement('div');
      svcDots.className = 'services__dots';
      // Not a tablist: these scroll a region, they do not swap panels. A plain
      // group with aria-current is what that actually is.
      svcDots.setAttribute('role', 'group');
      svcDots.setAttribute('aria-label', 'מיקום ברצועת השירותים');

      var ratios = plates.map(function () { return 0; });
      var svcButtons = plates.map(function (plate, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'services__dot';
        b.setAttribute('aria-current', String(i === 0));
        // The plate's own title, so the control says where it goes rather
        // than counting to five.
        var title = $('.card__title', plate);
        b.setAttribute('aria-label', title ? title.textContent.trim() : 'שירות ' + (i + 1));
        b.addEventListener('click', function () {
          // scrollIntoView, not scrollLeft: scrollLeft's sign and origin in a
          // right-to-left scroller still differ between engines, and this
          // page is RTL everywhere. block:'nearest' keeps the strip from
          // dragging the page up or down while it moves sideways.
          //
          // `behavior` is deliberately absent. Naming it 'smooth' would
          // override the CSS scroll-behavior property rather than read it,
          // and a11y-widget.css sets `scroll-behavior: auto !important` under
          // html.a11y-no-motion — so a visitor who had switched animations off
          // in the widget would have got an animated scroll anyway. Omitting
          // the key defers to the stylesheet, which already answers both the
          // widget toggle and the OS preference.
          plate.scrollIntoView({ inline: 'start', block: 'nearest' });
        });
        svcDots.appendChild(b);
        return b;
      });

      // Which plate is showing is whichever covers most of the strip, so the
      // marker tracks a half-finished swipe instead of jumping only once the
      // snap has landed.
      var svcIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          ratios[plates.indexOf(e.target)] = e.intersectionRatio;
        });
        var best = 0;
        for (var i = 1; i < ratios.length; i++) if (ratios[i] > ratios[best]) best = i;
        svcButtons.forEach(function (b, i) { b.setAttribute('aria-current', String(i === best)); });
      }, { root: svcGrid, threshold: [0, 0.25, 0.5, 0.75, 1] });
      plates.forEach(function (p) { svcIO.observe(p); });

      svcGrid.parentNode.insertBefore(svcDots, svcGrid.nextSibling);
    }
  }

  /* ---------------------------------------------------------- lead form --- */

  var TYPE_LABEL = { wedding: 'חתונה', std: 'Save the Date', henna: 'חינה / אירוסין',
                     mitzvah: 'בר / בת מצווה', other: 'אירוע אחר' };
  var COVERAGE_LABEL = { both: 'סטילס + וידאו', stills: 'סטילס בלבד',
                         video: 'וידאו בלבד', unsure: 'עוד לא בטוחים' };

  // Where this enquiry came from, written onto the lead's own row.
  //
  // The `source` column has existed since the table was created, the CRM even
  // selects it, and nothing ever set it — so every row read 'website' and the
  // studio had no way to tell an Instagram enquiry from a Google one, or to
  // know whether cost.html earns its keep.
  //
  // This is not analytics and deliberately does not behave like it. It runs
  // once, at submit, on a visitor who is already handing over their name and
  // phone; it reads only the referrer's HOST (never the full URL, which can
  // carry someone else's search terms) and any utm_* tags on the address they
  // arrived at. Nothing is stored in the browser, nothing is sent for visitors
  // who do not submit, and no third party is contacted. privacy.html lists it
  // with the rest of the form fields, because that is what it is.
  function leadSource() {
    var parts = [];
    try {
      var q = new URLSearchParams(window.location.search);
      ['utm_source', 'utm_medium', 'utm_campaign'].forEach(function (k) {
        var v = q.get(k);
        if (v) parts.push(k.slice(4) + '=' + v.slice(0, 40));
      });
    } catch (err) { /* no URLSearchParams: fall through to the referrer */ }

    if (!parts.length && document.referrer) {
      try {
        var ref = new URL(document.referrer);
        // A same-origin referrer is just our own navigation and says nothing
        // about where the couple came from. Leave it out rather than record
        // the site as its own source.
        if (ref.host && ref.host !== window.location.host) parts.push(ref.host);
      } catch (err) { /* opaque or malformed referrer: nothing to record */ }
    }

    // Which page the form was submitted from — the one thing always knowable,
    // and the answer to "is cost.html actually converting anyone".
    parts.push(window.location.pathname);
    return parts.join(' · ').slice(0, 200);
  }

  var form = $('[data-form]');

  if (form) {
    var dateInput = $('[data-field="date"]', form);
    // Local calendar date, not the UTC instant. In Israel (UTC+3 summer, +2
    // winter) toISOString() still says yesterday between local midnight and the
    // offset, so the picker offered a past date, validate() below — which
    // compares against this same .min — accepted it, and it was POSTed as
    // event_date. Measured at 01:30 Jerusalem, summer and winter alike.
    if (dateInput) {
      var today = new Date();
      dateInput.min = today.getFullYear() + '-' +
        ('0' + (today.getMonth() + 1)).slice(-2) + '-' +
        ('0' + today.getDate()).slice(-2);
    }

    // "בדיקת זמינות" is exactly the question a couple asks before the venue is
    // booked, and the coverage select already lets them say "עוד לא בטוחים".
    // Without this the date is a required field they have no honest way to fill.
    var dateTbd = $('[data-date-tbd]', form);
    function syncDateTbd() {
      if (!dateTbd || !dateInput) return;
      var tbd = dateTbd.checked;
      dateInput.disabled = tbd;
      dateInput.setAttribute('aria-required', String(!tbd));
      // The visible "(חובה)" moves with the requirement. It used to stay: the
      // greyed, disabled field kept telling the eye "mandatory" while AT was
      // told optional — the same two-audiences split the aria-required line
      // above exists to prevent, running in the opposite direction. The
      // marker is aria-hidden, so this is purely visual and cannot
      // double-announce.
      var reqMark = dateInput.closest('.field');
      reqMark = reqMark && reqMark.querySelector('.field__req');
      if (reqMark) reqMark.hidden = tbd;
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
      // Optional — the studio works by phone and WhatsApp, and making this
      // required would cost submissions. But the column carries a shape check
      // in Postgres, so a typo'd address does not arrive as a slightly-wrong
      // lead: it fails the whole INSERT and the couple gets the generic failure
      // panel. Catch it here, where we can say which field is wrong.
      if (values.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(values.email.trim())) {
        errors.email = 'כתובת האימייל לא נראית תקינה';
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

    // Read through a helper. Every one of these eight reads dereferenced a
    // node with no null guard, after preventDefault() had already suppressed
    // the native submit — so deleting any one question from the contact
    // section turned שלחו into a silently dead button: no error text, no
    // failure panel, no navigation, and the label never even reaching
    // "שולחים…". Hoisted out of the submit handler so blur-time validation
    // below reads through the SAME code — one source of truth, no second
    // rule set to drift.
    function readValues() {
      function val(name) {
        var el = $('[data-field="' + name + '"]', form);
        return el ? el.value : '';
      }
      return {
        name: val('name'),
        phone: val('phone'),
        email: val('email'),
        date: val('date'),
        type: val('type'),
        message: val('message'),
        area: val('area'),
        coverage: val('coverage'),
        // Honeypot. If the field is ever removed this reads '' and the bot
        // filter simply stops filtering, which is the safe direction: it
        // must never block a real submission.
        company: val('company'),
        dateTbd: Boolean(dateTbd && dateTbd.checked)
      };
    }

    // A malformed phone number used to be reported only after all six
    // controls were filled and שלחו was pressed — and that regex has already
    // bounced a real lead once. Validate on leaving a field, but ONLY a
    // field the visitor actually filled: an empty field they merely tabbed
    // through is never blamed, and only the blurred field lights up — a blur
    // must not shame the questions ahead of it. focusout, because blur does
    // not bubble. The select and the checkbox stay out: an unopened select
    // has no typed state to judge.
    var EAGER_FIELDS = ['name', 'phone', 'email', 'date'];
    form.addEventListener('focusout', function (e) {
      var name = e.target && e.target.dataset ? e.target.dataset.field : null;
      if (!name || EAGER_FIELDS.indexOf(name) < 0) return;
      if (!e.target.value || !e.target.value.trim()) return;
      var errors = validate(readValues());
      showError(name, errors[name] || '');
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (sending) return;

      var values = readValues();

      // Honeypot: a filled hidden field means a bot — drop it silently.
      if (values.company) return;

      var errors = validate(values);
      ['name', 'phone', 'email', 'date', 'type'].forEach(function (k) {
        showError(k, errors[k]);
      });
      var badKeys = Object.keys(errors);
      if (badKeys.length) {
        // Announce the failure once, through the panel that is already
        // role="alert". The per-field spans are not live regions, so errors
        // 2..N were silent until each field was visited — and focusing an
        // ALREADY-focused control (Enter with the caret still sitting in the
        // bad field) announced nothing at all. The spans keep the detail;
        // this is the headline. textContent assignment also discards any
        // WhatsApp anchor a previous network failure appended, and any
        // keystroke hides the panel again via the clearing handlers above.
        // This unconditional write also covers the older degenerate case —
        // a failing field whose [data-error] span was removed from the
        // markup — which used to be the only time this panel spoke here.
        if (failure) {
          failure.hidden = false;
          failure.textContent = badKeys.length === 1
            ? 'יש שדה אחד שצריך תיקון — ' + errors[badKeys[0]]
            : 'יש ' + badKeys.length + ' שדות שצריכים תיקון לפני השליחה';
        }
        var firstBad = $('[aria-invalid="true"]', form);
        if (firstBad) firstBad.focus();
        return;
      }

      var summary = [
        'פנייה חדשה מהאתר — Amora Studio',
        'שם: ' + values.name,
        'טלפון: ' + values.phone,
        values.email ? 'אימייל: ' + values.email : '',
        'תאריך: ' + (values.dateTbd ? 'עוד לא נקבע' : values.date),
        'סוג אירוע: ' + (TYPE_LABEL[values.type] || values.type),
        values.coverage ? 'מה מצלמים: ' + (COVERAGE_LABEL[values.coverage] || values.coverage) : '',
        values.area ? 'אזור: ' + values.area : '',
        values.message ? 'הודעה: ' + values.message : ''
      ].filter(Boolean).join('\n');

      if (failure) failure.hidden = true;
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
          email: values.email.trim() || null,
          event_date: values.dateTbd ? null : (values.date || null),
          // The checkbox has always existed and its answer has always been
          // thrown away: the row said event_date: null either way, so a couple
          // who has not booked a venue yet was indistinguishable from a blank
          // field. They are not the same lead.
          date_tbd: values.dateTbd,
          event_type: values.type || null,
          area: values.area || null,
          coverage: values.coverage || null,
          message: values.message || null,
          source: leadSource()
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

  // The wall and the plate grid are revealables too — their ENTRANCES are
  // triggered by the container the photographs live in, not the section:
  // measured, .gallery earns .is-revealed while the wall is still 184-294px
  // below the fold, so a stagger hung on the section would animate to
  // nobody. Joining this list buys the observer, the 3s watchdog and the
  // reduced-motion bypass in one line; the generic [data-reveal] hide rule
  // deliberately does not match them (no attribute), so only their inner
  // pictures ever carry a hidden state.
  var revealables = $$('[data-reveal], .masonry, .services__grid');

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

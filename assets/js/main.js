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
    supabaseUrl: '',
    supabaseKey: '',

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

  // Two encodes: a 16:9 loop for landscape viewports and a 9:16 one for phones
  // held upright, so neither orientation is a centre-crop of the other.
  // <source media> is only evaluated when the element loads, never on resize —
  // so the choice is made here in JS and redone if the viewport crosses over.
  var HERO = {
    wide:     { webm: 'assets/video/hero-wide.webm',     mp4: 'assets/video/hero-wide.mp4' },
    vertical: { webm: 'assets/video/hero-vertical.webm', mp4: 'assets/video/hero-vertical.mp4' }
  };

  function initHero() {
    var video = $('[data-hero-video]');
    if (!video) return;

    // Never spend someone's data plan on decoration, and honour the OS
    // reduced-motion setting — the poster alone is a complete hero.
    var conn = navigator.connection || {};
    if (reducedMotion || conn.saveData === true ||
        /^(slow-2g|2g)$/.test(conn.effectiveType || '')) return;

    var portrait = window.matchMedia('(max-aspect-ratio: 1/1)');
    var current = null;

    function load() {
      var want = portrait.matches ? 'vertical' : 'wide';
      if (want === current) return;
      current = want;
      video.classList.remove('is-ready');
      video.innerHTML = '';
      [['video/webm', HERO[want].webm], ['video/mp4', HERO[want].mp4]].forEach(function (pair) {
        var srcEl = document.createElement('source');
        srcEl.type = pair[0];
        srcEl.src = pair[1];
        video.appendChild(srcEl);
      });
      video.load();
      var p = video.play();
      // Autoplay can still be refused (iOS Low Power Mode); the poster stays.
      if (p && p.catch) p.catch(function () {});
    }

    video.addEventListener('canplay', function () { video.classList.add('is-ready'); });
    portrait.addEventListener('change', load);

    // Hold off until the page has settled so the loop never competes with the
    // poster for LCP.
    var start = function () { setTimeout(load, 200); };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });

    // Stop decoding when it cannot be seen — saves battery on phones.
    document.addEventListener('visibilitychange', function () {
      if (!current) return;
      if (document.hidden) video.pause();
      else video.play().catch(function () {});
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!current) return;
          if (en.isIntersecting) video.play().catch(function () {});
          else video.pause();
        });
      }, { threshold: 0.01 }).observe(video);
    }
  }

  initHero();

  /* -------------------------------------------------- gallery + lightbox --- */

  var items = $$('[data-masonry] .masonry__item');
  var chips = $$('[data-filter]');
  var lightbox = $('[data-lightbox]');
  var lbFigure = $('[data-lightbox-figure]');
  var lbLabel = $('[data-lightbox-label]');
  var lbImage = $('[data-lightbox-img]');
  var lbCount = $('[data-lightbox-count]');

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
    lbFigure.setAttribute('aria-label', alt);
    lbLabel.textContent = alt;
    lbCount.textContent = (lbIndex + 1) + ' / ' + list.length;

    if (lightbox.hidden) {
      lastFocused = document.activeElement;
      lightbox.hidden = false;
      document.body.style.overflow = 'hidden';
      $('[data-lightbox-close]').focus();
    }
  }

  function step(delta) {
    if (lbIndex < 0) return;
    openLightbox(lbIndex + delta);
  }

  function closeLightbox() {
    if (!lightbox || lightbox.hidden) return;
    lightbox.hidden = true;
    lbIndex = -1;
    if (menu && menu.hidden) document.body.style.overflow = '';
    if (lastFocused && lastFocused.focus) lastFocused.focus();
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
  var SLIDES = 3;
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

    ['name', 'phone', 'date', 'type'].forEach(function (name) {
      var input = $('[data-field="' + name + '"]', form);
      if (input) {
        input.addEventListener('input', function () { showError(name, ''); });
        input.addEventListener('change', function () { showError(name, ''); });
      }
    });

    function validate(values) {
      var errors = {};
      if (!values.name.trim() || values.name.trim().length < 2) {
        errors.name = 'נעים להכיר — איך קוראים לכם?';
      }
      // Strip the separators people actually type. Only spaces and hyphens were
      // stripped before, so a perfectly valid "(050) 366-2699" was rejected and
      // the lead bounced off its own contact form.
      if (!/^0\d{1,2}\d{7}$|^\+?\d{9,15}$/.test(values.phone.replace(/[\s\-().]/g, ''))) {
        errors.phone = 'מספר טלפון לא תקין';
      }
      if (!values.date) errors.date = 'איזה תאריך אנחנו בודקים?';
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
        company: $('[data-field="company"]', form).value
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
        'תאריך: ' + values.date,
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
        hand.textContent = 'פתיחת וואטסאפ עם הפרטים →';
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
        alt.textContent = 'שליחה בוואטסאפ →';
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

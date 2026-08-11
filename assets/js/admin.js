/* ==========================================================================
   Amora Studio — ניהול פניות (private lead CRM)
   Same rules as main.js: one IIFE, no build step, no dependencies, no CDN.
   Talks to Supabase over plain fetch — GoTrue for the session, PostgREST for
   the rows. No supabase-js.
   ========================================================================== */

(function () {
  'use strict';

  var CONFIG = {
    // The anon key is public by design and is only used here to reach the API
    // gateway. It grants nothing on its own: RLS lets anon INSERT a lead and
    // nothing else. Reading and updating happen with the signed-in owner's
    // JWT ('authenticated' role), which is what the policies in
    // docs/supabase-crm.sql actually allow. A service_role key must NEVER
    // appear in this file — it bypasses RLS entirely.
    supabaseUrl: 'https://dkejuaildigikufrdiru.supabase.co',
    supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrZWp1YWlsZGlnaWt1ZnJkaXJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0ODkxODgsImV4cCI6MjEwMTA2NTE4OH0.rN244HfLzw7iI2J9uF9lmRoW96aMAN117fVWvlCDWLE',

    // Signature used by the WhatsApp greeting.
    studioName: 'Amora Studio',

    // The couple-facing contract page (the `contract` Edge Function). The
    // token appended to this URL is the whole authentication — treat a
    // contract link like a signed cheque.
    contractBase: 'https://dkejuaildigikufrdiru.supabase.co/functions/v1/contract?t='
  };

  var STORE_KEY = 'amora.crm.session';
  var PAGE_LIMIT = 500;      // newest N leads; the header tells us the true total
  var REQUEST_TIMEOUT = 15000;
  var REFRESH_MARGIN = 90;   // seconds before expiry that we renew the token
  var POLL_INTERVAL = 120000;
  var SOON_DAYS = 30;        // an event this close is "approaching"
  var HORIZON_DAYS = 90;     // beyond this an event is not yet pressing
  var STALE_DAYS = 2;        // a live lead silent this long wears an alarm —
                             // the site promises a same-day reply in six places

  // Unsaved note drafts and open/closed <details> state, keyed by lead id.
  // render() tears the whole list down and rebuilds it — on every keystroke,
  // chip press and background poll — and before these existed that rebuild
  // DESTROYED the note the owner was typing, mid-call, on a phone.
  var dirtyNotes = {};
  var openBoxes = {};

  var TYPE_LABEL = { wedding: 'חתונה', std: 'Save the Date', henna: 'חינה / אירוסין',
                     mitzvah: 'בר / בת מצווה', other: 'אירוע אחר' };
  var COVERAGE_LABEL = { both: 'סטילס + וידאו', stills: 'סטילס בלבד',
                         video: 'וידאו בלבד', unsure: 'עוד לא בטוחים' };
  // The sales pipeline. Order matters: it is the order in the select control.
  var STATUS_ORDER = ['new', 'contacted', 'proposal', 'contract_sent', 'signed', 'lost'];
  var STATUS_LABEL = { new: 'חדש', contacted: 'נוצר קשר', proposal: 'הצעה נשלחה',
                       contract_sent: 'חוזה נשלח', signed: 'נחתם ✓', lost: 'לא נסגר' };
  var CONTRACT_LABEL = { draft: 'חוזה — טיוטה', sent: 'חוזה נשלח, ממתין לחתימה',
                         signed: 'חוזה חתום ✓', cancelled: 'חוזה בוטל' };
  // source values written by the intake channels; anything else is the
  // site form's ' · '-joined attribution string: `source=instagram ·
  // medium=cpc · campaign=spring · /cost.html`, or `l.instagram.com · /`,
  // or a bare landing path. The badge used to classify ALL of that as
  // "האתר" — a paid-Instagram lead and a direct visitor looked identical
  // at a glance, with the difference buried in a key=value string the
  // owner had to parse by eye on a phone.
  //
  // Two safety rules, because `source` is attacker-influenced free text:
  // the badge class comes from a FIXED key set (never from lead data), and
  // host matching is suffix-anchored — `instagram.com.evil.example` must
  // not wear the Instagram badge.
  var CHANNEL_LABEL = {
    google_ads: 'Google Ads', meta_ads: 'Meta',
    instagram: 'Instagram', facebook: 'Facebook', google: 'Google',
    whatsapp: 'WhatsApp', tiktok: 'TikTok', direct: 'ישיר', other: 'אחר'
  };
  function hostChannel(host) {
    var h = String(host).toLowerCase();
    var test = function (domain) {
      return h === domain || h.slice(-(domain.length + 1)) === '.' + domain;
    };
    if (test('instagram.com')) return 'instagram';
    if (test('facebook.com') || test('fb.com')) return 'facebook';
    if (test('whatsapp.com') || test('wa.me')) return 'whatsapp';
    if (test('tiktok.com')) return 'tiktok';
    // Fully anchored, unlike the prefix regex this replaces: google.evil.example
    // began with "google." and earned the badge, bypassing the suffix rule the
    // comment above promises. ccTLD forms (google.co.il) are end-anchored too.
    if (test('google.com') || /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h)) return 'google';
    return null;
  }
  function parseSource(source) {
    var s = String(source || '');
    if (s.indexOf('google-ads') === 0) return { key: 'google_ads', label: 'Google Ads' };
    if (s.indexOf('meta-ads') === 0) return { key: 'meta_ads', label: 'Meta' };
    var out = { key: 'direct', label: CHANNEL_LABEL.direct, campaign: '', landing: '' };
    var known = false;
    s.split(' · ').forEach(function (part) {
      var p = part.trim();
      if (!p) return;
      if (p.indexOf('source=') === 0) {
        var v = p.slice(7).toLowerCase();
        var key = (v === 'ig' || v === 'instagram') ? 'instagram'
          : (v === 'fb' || v === 'facebook') ? 'facebook'
          : (v === 'google') ? 'google'
          : (v === 'whatsapp') ? 'whatsapp'
          : (v === 'tiktok') ? 'tiktok' : 'other';
        out.key = key;
        out.label = key === 'other' ? p.slice(7) : CHANNEL_LABEL[key];
        known = true;
      } else if (p.indexOf('campaign=') === 0) {
        out.campaign = p.slice(9);
      } else if (p.indexOf('medium=') === 0 || p.indexOf('term=') === 0
                 || p.indexOf('content=') === 0) {
        // recorded in the raw string; not badge material
      } else if (p.charAt(0) === '/') {
        out.landing = p;
      } else if (!known && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(p)) {
        var ch = hostChannel(p);
        if (ch) { out.key = ch; out.label = CHANNEL_LABEL[ch]; }
        else { out.key = 'other'; out.label = p; }
      }
    });
    return out;
  }
  // The two call sites that predate parseSource keep their contract.
  function sourceChannel(source) {
    var c = parseSource(source);
    // greetingFor's question is "did they come through our own site" —
    // anything that is not an ad-platform intake did.
    c.site = c.key !== 'google_ads' && c.key !== 'meta_ads';
    return c;
  }
  var WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  var base = CONFIG.supabaseUrl.replace(/\/+$/, '');

  /* ------------------------------------------------------------- helpers --- */

  /** Build an element. Text always goes in via textContent — lead fields are
   *  attacker-controllable input and must never be parsed as HTML. */
  /** Unicode bidi controls a lead can type into any free-text field. The
   *  overrides and isolates (U+202A-202E, U+2066-2069) reverse how a name or a
   *  message reads in the card and ride along into whatever the owner pastes
   *  the details into. Written as \u escapes on purpose: the literal
   *  characters are invisible in a diff, which is the same problem this
   *  function exists to solve. */
  function stripBidi(s) {
    return String(s).replace(/[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g, '');
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null && text !== '') node.textContent = stripBidi(text);
    return node;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** 'YYYY-MM-DD' → local midnight. Date parsing of a bare ISO date is UTC in
   *  the spec, which in Israel shifts the day back by three hours. */
  function parseDay(value) {
    if (!value) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function todayMidnight() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function dayDiff(date) {
    return Math.round((date.getTime() - todayMidnight().getTime()) / 86400000);
  }

  function formatDay(date) {
    return pad2(date.getDate()) + '.' + pad2(date.getMonth() + 1) + '.' + date.getFullYear();
  }

  // Hebrew does not take a bare numeral for one or two of anything: "לפני 1
  // שעות" and "לפני 2 ימים" are both wrong. Every count below routes through a
  // singular/dual form first.
  function relativeEvent(days) {
    var past = Math.abs(days);
    if (days < -1) {
      return 'האירוע עבר לפני ' + (past === 2 ? 'יומיים' : past + ' ימים');
    }
    if (days === -1) return 'האירוע היה אתמול';
    if (days === 0) return 'האירוע היום';
    if (days === 1) return 'האירוע מחר';
    if (days === 2) return 'האירוע מחרתיים';
    if (days <= 30) return 'בעוד ' + days + ' ימים';
    if (days <= 45) return 'בעוד כחודש';
    if (days <= 75) return 'בעוד כחודשיים';
    return 'בעוד כ־' + Math.round(days / 30) + ' חודשים';
  }

  /* One clock, two sentences: the singular/dual forms live HERE and only
     here — hand-rolling a second copy is how a "לפני 2 ימים" bug ships. */
  function relativeCore(iso) {
    var when = new Date(iso);
    if (isNaN(when.getTime())) return null;
    var mins = Math.round((Date.now() - when.getTime()) / 60000);
    if (mins < 1) return { now: true };
    if (mins === 1) return { t: 'לפני דקה' };
    if (mins === 2) return { t: 'לפני שתי דקות' };
    if (mins < 60) return { t: 'לפני ' + mins + ' דקות' };
    var hours = Math.round(mins / 60);
    if (hours === 1) return { t: 'לפני שעה' };
    if (hours === 2) return { t: 'לפני שעתיים' };
    if (hours < 24) return { t: 'לפני ' + hours + ' שעות' };
    var days = Math.round(hours / 24);
    if (days === 1) return { t: 'אתמול' };
    if (days === 2) return { t: 'לפני יומיים' };
    if (days < 30) return { t: 'לפני ' + days + ' ימים' };
    return { t: 'ב־' + formatDay(when) };
  }
  function relativeArrival(iso) {
    var r = relativeCore(iso);
    if (!r) return '';
    return r.now ? 'התקבלה עכשיו' : 'התקבלה ' + r.t;
  }
  function relativeUpdated(iso) {
    var r = relativeCore(iso);
    if (!r) return '';
    return r.now ? 'עודכן עכשיו' : 'עודכן ' + r.t;
  }

  /** Digits only, in international form, for tel: and wa.me. Never pass the
   *  raw field through — it is free text the visitor typed. */
  function phoneDigits(raw) {
    var digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.indexOf('972') === 0) return digits;
    if (digits.charAt(0) === '0') return '972' + digits.slice(1);
    return digits;
  }

  function typeLabel(value) {
    if (!value) return '';
    // Own-property test: a lead posted straight to the REST API can set
    // event_type to 'constructor' or 'toString', and a bare TYPE_LABEL[value]
    // would then return an inherited function that renders as
    // "function Object() { [native code] }" in the card and the filter menu.
    return Object.prototype.hasOwnProperty.call(TYPE_LABEL, value) ? TYPE_LABEL[value] : value;
  }

  function coverageLabel(value) {
    if (!value) return '';
    return Object.prototype.hasOwnProperty.call(COVERAGE_LABEL, value) ? COVERAGE_LABEL[value] : value;
  }

  /* ------------------------------------------------------------ elements --- */

  var gate = $('[data-gate]');
  var app = $('[data-app]');
  var loginForm = $('[data-login]');
  var loginEmail = $('[data-login-email]');
  var loginPassword = $('[data-login-password]');
  var loginSubmit = $('[data-login-submit]');
  var loginError = $('[data-login-error]');
  var signoutBtn = $('[data-signout]');
  var refreshBtn = $('[data-refresh]');
  var listEl = $('[data-list]');
  var loadingEl = $('[data-loading]');
  var errorEl = $('[data-error]');
  var errorText = $('[data-error-text]');
  var retryBtn = $('[data-retry]');
  var emptyEl = $('[data-empty]');
  var metaEl = $('[data-meta]');
  var searchEl = $('[data-search]');
  var typeEl = $('[data-filter-type]');
  var sortEl = $('[data-sort]');
  var chips = $$('[data-filter-handled]');
  var toastEl = $('[data-toast]');

  var state = {
    leads: [],
    total: null,      // exact count from Content-Range, when the header is exposed
    contracts: {},    // lead_id → its newest contract row
    events: {},       // lead_id → its newest lead_events rows, newest first
    pipelineReady: true,  // false while the DB migration has not run yet
    handled: 'open',
    type: 'all',
    sort: 'newest',
    query: '',
    loadedAt: 0
  };

  /* ------------------------------------------------------------- session --- */

  var session = null;      // { access_token, refresh_token, expires_at }
  var refreshing = null;   // in-flight refresh, so parallel calls share one

  function readStored() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.access_token && parsed.refresh_token) return parsed;
    } catch (e) {
      // Private mode, disabled storage, or corrupt JSON — treat as signed out.
    }
    return null;
  }

  function storeSession(data) {
    var now = Math.floor(Date.now() / 1000);
    session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      // GoTrue sends expires_at, but older projects only send expires_in.
      expires_at: data.expires_at || (now + (Number(data.expires_in) || 3600)),
      email: (data.user && data.user.email) || (session && session.email) || ''
    };
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(session));
    } catch (e) {
      // Storage refused: the session still works until this tab is closed.
    }
  }

  function clearSession() {
    session = null;
    refreshing = null;
    try { window.localStorage.removeItem(STORE_KEY); } catch (e) {}
  }

  function fetchWithTimeout(url, options) {
    var opts = options || {};
    var abort = new AbortController();
    var timer = setTimeout(function () { abort.abort(); }, REQUEST_TIMEOUT);
    opts.signal = abort.signal;
    return fetch(url, opts).then(function (res) {
      clearTimeout(timer);
      return res;
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  function authCall(grant, body) {
    return fetchWithTimeout(base + '/auth/v1/token?grant_type=' + grant, {
      method: 'POST',
      headers: {
        apikey: CONFIG.supabaseKey,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (data) {
        return { ok: res.ok, status: res.status, data: data || {} };
      }, function () {
        return { ok: false, status: res.status, data: {} };
      });
    });
  }

  function signIn(email, password) {
    return authCall('password', { email: email, password: password })
      .then(function (result) {
        if (!result.ok || !result.data.access_token) {
          var err = new Error(result.data.error_description || result.data.msg || 'sign-in failed');
          err.status = result.status;
          throw err;
        }
        storeSession(result.data);
        return session;
      });
  }

  function doRefresh() {
    if (refreshing) return refreshing;
    if (!session || !session.refresh_token) return Promise.reject(new Error('no-session'));

    refreshing = authCall('refresh_token', { refresh_token: session.refresh_token })
      .then(function (result) {
        refreshing = null;
        if (!result.ok || !result.data.access_token) {
          var err = new Error('refresh failed');
          err.status = result.status;
          err.expired = true;
          throw err;
        }
        storeSession(result.data);
        return session.access_token;
      }, function (err) {
        refreshing = null;
        throw err;
      });

    return refreshing;
  }

  /** A valid access token, refreshed first if it is about to lapse. */
  function ensureToken() {
    if (!session || !session.access_token) return Promise.reject(new Error('no-session'));
    var now = Math.floor(Date.now() / 1000);
    if (session.expires_at - now > REFRESH_MARGIN) return Promise.resolve(session.access_token);
    return doRefresh();
  }

  /** REST call carrying the signed-in owner's JWT. On a 401 the token is
   *  refreshed once and the call is replayed — a stale token should not look
   *  like a network failure to the person holding the phone. */
  function api(path, options, retried) {
    var opts = options || {};
    return ensureToken().then(function (token) {
      var headers = {
        apikey: CONFIG.supabaseKey,
        Authorization: 'Bearer ' + token,
        Accept: 'application/json'
      };
      var extra = opts.headers || {};
      Object.keys(extra).forEach(function (k) { headers[k] = extra[k]; });

      return fetchWithTimeout(base + path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body
      });
    }).then(function (res) {
      if (res.status === 401 && !retried) {
        return doRefresh().then(function () {
          return api(path, options, true);
        });
      }
      return res;
    });
  }

  /* ---------------------------------------------------------------- view --- */

  function show(node, visible) {
    if (node) node.hidden = !visible;
  }

  var toastTimer = null;
  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.hidden = false;
    toastEl.classList.add('is-shown');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('is-shown');
      toastEl.hidden = true;
    }, 2600);
  }

  function showGate(message) {
    show(gate, true);
    show(app, false);
    show(signoutBtn, false);
    show(refreshBtn, false);
    if (loginError) {
      loginError.textContent = message || '';
      loginError.hidden = !message;
    }
    if (loginPassword) loginPassword.value = '';
    if (loginEmail && !loginEmail.value && session && session.email) {
      loginEmail.value = session.email;
    }
  }

  function showApp() {
    show(gate, false);
    show(app, true);
    show(signoutBtn, true);
    show(refreshBtn, true);
  }

  function showError(message) {
    show(loadingEl, false);
    show(emptyEl, false);
    if (errorText) errorText.textContent = message;
    show(errorEl, true);
  }

  /* --------------------------------------------------------------- cards --- */

  function greetingFor(lead) {
    var parts = ['היי ' + (lead.name || '') + ', כאן ' + CONFIG.studioName + '.'];
    var day = parseDay(lead.event_date);
    var subject = typeLabel(lead.event_type);
    // An ad lead never saw the website; "מהאתר" would read as a mistake.
    var line = sourceChannel(lead.source).site
      ? 'קיבלנו את הפנייה שלכם מהאתר'
      : 'קיבלנו את הפנייה שלכם';
    if (subject) line += ' לגבי ' + subject;
    if (day) line += ' בתאריך ' + formatDay(day);
    parts.push(line + '.');
    parts.push('נשמח לבדוק זמינות ולחזור אליכם עם כל הפרטים — מתי נוח לכם לדבר?');
    return stripBidi(parts.join(' '));
  }

  function detailsFor(lead) {
    var day = parseDay(lead.event_date);
    var rows = [
      'שם: ' + (lead.name || ''),
      'טלפון: ' + (lead.phone || ''),
      lead.email ? 'אימייל: ' + lead.email : '',
      day ? 'תאריך האירוע: ' + formatDay(day) + ' (יום ' + WEEKDAYS[day.getDay()] + ')'
          : lead.date_tbd ? 'תאריך האירוע: עוד לא קבעו' : '',
      lead.event_type ? 'סוג אירוע: ' + typeLabel(lead.event_type) : '',
      lead.area ? 'אזור: ' + lead.area : '',
      lead.coverage ? 'מה מצלמים: ' + coverageLabel(lead.coverage) : '',
      lead.message ? 'הודעה: ' + lead.message : '',
      lead.source ? 'הגיעו מ: ' + parseSource(lead.source).label + ' (' + lead.source + ')' : '',
      'התקבלה: ' + formatDay(new Date(lead.created_at))
    ];
    return stripBidi(rows.filter(Boolean).join('\n'));
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast('הפרטים הועתקו');
      }, function () {
        legacyCopy(text);
      });
      return;
    }
    legacyCopy(text);
  }

  /** clipboard.writeText needs a secure context; opened from disk or over
   *  plain http it rejects, and this is the only route left. */
  function legacyCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(area);
    toast(ok ? 'הפרטים הועתקו' : 'ההעתקה נחסמה — אפשר לסמן ולהעתיק ידנית');
  }

  function addRow(dl, label, value) {
    if (!value) return;
    dl.appendChild(el('dt', 'crm-card__dt', label));
    dl.appendChild(el('dd', 'crm-card__dd', value));
  }

  function buildCard(lead) {
    var day = parseDay(lead.event_date);
    var days = day ? dayDiff(day) : null;
    var digits = phoneDigits(lead.phone);

    var li = el('li', 'crm-card');
    if (lead.handled) li.classList.add('is-handled');
    if (days !== null && days >= 0 && days <= SOON_DAYS) li.classList.add('is-urgent');
    else if (days !== null && days > SOON_DAYS && days <= HORIZON_DAYS) li.classList.add('is-soon');
    else if (days !== null && days < 0) li.classList.add('is-past');

    var head = el('div', 'crm-card__head');
    head.appendChild(el('h2', 'crm-card__name', lead.name || 'ללא שם'));

    var badges = el('div', 'crm-card__badges');
    if (days !== null) {
      var badge = el('span', 'crm-card__badge', relativeEvent(days));
      if (days >= 0 && days <= SOON_DAYS) badge.classList.add('crm-card__badge--urgent');
      else if (days < 0) badge.classList.add('crm-card__badge--past');
      badges.appendChild(badge);
    }
    var channel = parseSource(lead.source);
    badges.appendChild(el('span',
      'crm-card__badge crm-card__badge--src crm-card__badge--src-' + channel.key,
      channel.label));
    badges.appendChild(el('span', 'crm-card__badge crm-card__badge--status',
      STATUS_LABEL[lead.status] || (lead.handled ? 'טופל' : 'ממתין')));
    var silent = silenceDays(lead);
    if (silent !== null) {
      badges.appendChild(el('span', 'crm-card__badge crm-card__badge--stale',
        'ללא מענה ' + silent + ' ימים'));
      li.classList.add('is-stale');
    }
    head.appendChild(badges);
    li.appendChild(head);

    var dl = el('dl', 'crm-card__grid');
    if (digits) {
      dl.appendChild(el('dt', 'crm-card__dt', 'טלפון'));
      var dd = el('dd', 'crm-card__dd');
      var tel = el('a', 'crm-card__tel crm-num', lead.phone);
      tel.href = 'tel:+' + digits;
      dd.appendChild(tel);
      dl.appendChild(dd);
    }
    if (lead.email) {
      dl.appendChild(el('dt', 'crm-card__dt', 'אימייל'));
      var ddMail = el('dd', 'crm-card__dd');
      var mail = el('a', 'crm-card__tel', lead.email);
      // Every field here was typed by a stranger. The column's shape check
      // bars whitespace but not '?', which in a mailto: is the start of the
      // header list — so an address could pre-fill a subject or a body on a
      // mail the studio is about to send. Keep the address, drop the headers.
      mail.href = 'mailto:' + String(lead.email).split('?')[0];
      ddMail.appendChild(mail);
      dl.appendChild(ddMail);
    }
    if (day) {
      addRow(dl, 'תאריך האירוע',
        formatDay(day) + ' · יום ' + WEEKDAYS[day.getDay()]);
    } else if (lead.date_tbd) {
      // Not the same as a blank date. This couple has told us they have not
      // set one yet, which is a different — and earlier — conversation.
      addRow(dl, 'תאריך האירוע', 'עוד לא קבעו');
    }
    addRow(dl, 'סוג אירוע', typeLabel(lead.event_type));
    addRow(dl, 'אזור', lead.area);
    addRow(dl, 'מה מצלמים', coverageLabel(lead.coverage));
    // Human first, raw second: the badge's label answers "from where" at a
    // glance; the raw attribution string stays available in the copy text
    // (detailsFor) so nothing the form recorded is lost.
    addRow(dl, 'הגיעו מ', channel.label + (channel.landing ? ' · ' + channel.landing : ''));
    addRow(dl, 'קמפיין', lead.campaign || channel.campaign);
    if (dl.childNodes.length) li.appendChild(dl);

    if (lead.message) {
      var quote = el('p', 'crm-card__message', lead.message);
      li.appendChild(quote);
    }

    /* Last touch + history, from lead_events. Leads with no events show
       nothing extra — no empty timeline shell. detail is admin-written free
       text and still goes through el()/textContent like every other field. */
    var evs = state.events[lead.id];
    if (evs && evs.length) {
      li.appendChild(el('p', 'crm-card__stamp crm-card__stamp--touch',
        relativeUpdated(evs[0].created_at)
          + ' · ' + (EVENT_LABEL[evs[0].type] || evs[0].type)));
      if (evs.length > 1) {
        var hist = document.createElement('details');
        hist.className = 'crm-note crm-history';
        if (openBoxes['h' + lead.id]) hist.open = true;
        hist.addEventListener('toggle', function () {
          openBoxes['h' + lead.id] = hist.open;
        });
        var histSum = el('summary', 'crm-note__summary', 'היסטוריה (' + evs.length + ')');
        hist.appendChild(histSum);
        var histList = el('ul', 'crm-history__list');
        evs.forEach(function (ev) {
          histList.appendChild(el('li', 'crm-history__item',
            (EVENT_LABEL[ev.type] || ev.type)
              + (ev.detail ? ' — ' + ev.detail : '')
              + ' · ' + relativeUpdated(ev.created_at)));
        });
        hist.appendChild(histList);
        li.appendChild(hist);
      }
    }

    // Pipeline: the status select, when the migration has added the column.
    if (state.pipelineReady && 'status' in lead) {
      var statusWrap = el('div', 'crm-card__pipeline');
      var statusLabelEl = el('label', 'crm-card__pipeline-label', 'סטטוס');
      var statusSel = document.createElement('select');
      statusSel.className = 'crm-card__status';
      STATUS_ORDER.forEach(function (value) {
        var opt = el('option', null, STATUS_LABEL[value]);
        opt.value = value;
        statusSel.appendChild(opt);
      });
      statusSel.value = STATUS_ORDER.indexOf(lead.status) === -1 ? 'new' : lead.status;
      statusSel.addEventListener('change', function () {
        setStatus(lead, statusSel.value, statusSel);
      });
      statusLabelEl.appendChild(statusSel);
      statusWrap.appendChild(statusLabelEl);
      li.appendChild(statusWrap);

      // The note. Opens closed unless there already is one — a card is a
      // phone-screen object and most leads never need a note. An unsaved
      // draft survives the rebuild through dirtyNotes, and a hand-toggled
      // open state through openBoxes — keyed by lead id, never by index.
      var noteBox = document.createElement('details');
      noteBox.className = 'crm-note';
      var hasDraft = dirtyNotes[lead.id] !== undefined;
      var noteOpenKey = 'n' + lead.id;
      noteBox.open = openBoxes[noteOpenKey] !== undefined
        ? openBoxes[noteOpenKey]
        : Boolean(lead.notes || hasDraft);
      noteBox.addEventListener('toggle', function () {
        openBoxes[noteOpenKey] = noteBox.open;
      });
      var noteSummary = el('summary', 'crm-note__summary',
        lead.notes || hasDraft ? 'פתק' : 'הוספת פתק');
      noteBox.appendChild(noteSummary);
      var noteArea = document.createElement('textarea');
      noteArea.className = 'crm-note__area';
      noteArea.rows = 3;
      noteArea.maxLength = 4000;
      noteArea.value = hasDraft ? dirtyNotes[lead.id] : (lead.notes || '');
      noteArea.dataset.lead = lead.id;
      noteArea.addEventListener('input', function () {
        if (noteArea.value !== (lead.notes || '')) dirtyNotes[lead.id] = noteArea.value;
        else delete dirtyNotes[lead.id];
      });
      noteBox.appendChild(noteArea);
      var noteSave = el('button', 'crm-act', 'שמירת פתק');
      noteSave.type = 'button';
      noteSave.addEventListener('click', function () {
        saveNotes(lead, noteArea.value.trim(), noteSave);
      });
      noteBox.appendChild(noteSave);
      li.appendChild(noteBox);

      // The contract block: create → send over WhatsApp → watch it get signed.
      var contract = state.contracts[lead.id];
      var cWrap = el('div', 'crm-contract');
      if (!contract) {
        var createBtn = el('button', 'crm-act crm-act--contract', 'יצירת חוזה');
        createBtn.type = 'button';
        createBtn.addEventListener('click', function () { openContractDialog(lead); });
        cWrap.appendChild(createBtn);
      } else {
        var stateLine = el('p', 'crm-contract__state',
          (CONTRACT_LABEL[contract.status] || contract.status) +
          (contract.signed_at ? ' · ' + formatDay(new Date(contract.signed_at)) : '') +
          (contract.status === 'sent' && contract.viewed_at ? ' · נצפה' : ''));
        if (contract.status === 'signed') stateLine.classList.add('is-signed');
        cWrap.appendChild(stateLine);

        var cActions = el('div', 'crm-card__actions crm-contract__actions');

        var openLink = el('a', 'crm-act', 'צפייה בחוזה');
        openLink.href = contractLink(contract);
        openLink.target = '_blank';
        openLink.rel = 'noopener noreferrer';
        cActions.appendChild(openLink);

        var copyLink = el('button', 'crm-act', 'העתקת קישור');
        copyLink.type = 'button';
        copyLink.addEventListener('click', function () { copyText(contractLink(contract)); });
        cActions.appendChild(copyLink);

        if (contract.status !== 'signed' && contract.status !== 'cancelled') {
          if (digits) {
            var waSend = el('a', 'crm-act crm-act--wa', 'שליחה בוואטסאפ');
            waSend.href = 'https://wa.me/' + digits + '?text=' +
              encodeURIComponent(contractWaText(lead, contract));
            waSend.target = '_blank';
            waSend.rel = 'noopener noreferrer';
            cActions.appendChild(waSend);
          }
          if (contract.status === 'draft') {
            var sentBtn = el('button', 'crm-act crm-act--mark', 'סימון כנשלח');
            sentBtn.type = 'button';
            sentBtn.addEventListener('click', function () {
              markContractSent(lead, contract, sentBtn);
            });
            cActions.appendChild(sentBtn);
          }
        }
        cWrap.appendChild(cActions);
      }
      li.appendChild(cWrap);
    }

    li.appendChild(el('p', 'crm-card__stamp', relativeArrival(lead.created_at)));

    var actions = el('div', 'crm-card__actions');

    if (digits) {
      var call = el('a', 'crm-act', 'חיוג');
      call.href = 'tel:+' + digits;
      actions.appendChild(call);

      var wa = el('a', 'crm-act crm-act--wa', 'וואטסאפ');
      wa.href = 'https://wa.me/' + digits + '?text=' + encodeURIComponent(greetingFor(lead));
      wa.target = '_blank';
      wa.rel = 'noopener noreferrer';
      actions.appendChild(wa);

      // Tapping either one IS working the lead — before this listener, the
      // owner called, wrote the greeting, and then had to scroll back and
      // pick "נוצר קשר" as a second, unrelated act. Nobody did, so the
      // default shelf filled with leads that only LOOKED neglected while
      // hiding the truly neglected ones. The whole handler is deferred a
      // tick: setStatus re-renders synchronously, and tearing the anchor
      // out mid-click cancels the tel:/wa.me navigation it sits on.
      var touchVia = function (type, label) {
        setTimeout(function () {
          var logged = logEvent(lead.id, null, type, label);
          if (state.pipelineReady && 'status' in lead && bucketOf(lead) === 'open') {
            setStatus(lead, 'contacted', null);
          } else if (logged && logged.then) {
            logged.then(function () {
              lastEventsSignature = null;
              loadEvents(true);
            });
          }
        }, 0);
      };
      call.addEventListener('click', function () { touchVia('call_opened', 'נפתח חיוג מהכרטיס'); });
      wa.addEventListener('click', function () { touchVia('whatsapp_opened', 'נפתחה שיחת וואטסאפ מהכרטיס'); });
    }

    var copy = el('button', 'crm-act', 'העתקת פרטים');
    copy.type = 'button';
    copy.addEventListener('click', function () { copyText(detailsFor(lead)); });
    actions.appendChild(copy);

    var toggle = el('button', 'crm-act crm-act--mark',
      lead.handled ? 'החזרה לממתינות' : 'סימון כטופל');
    toggle.type = 'button';
    toggle.addEventListener('click', function () { setHandled(lead, !lead.handled, toggle); });
    actions.appendChild(toggle);

    li.appendChild(actions);
    return li;
  }

  /* ------------------------------------------------------------ filtering --- */

  function matchesQuery(lead, query) {
    if (!query) return true;
    var name = (lead.name || '').toLowerCase();
    if (name.indexOf(query) !== -1) return true;
    var email = (lead.email || '').toLowerCase();
    if (email && email.indexOf(query) !== -1) return true;

    // "רמת גן", "אולם", a phrase from a note — how a person actually
    // remembers a lead six weeks later. Plain indexOf on lowercased text,
    // never a regex, so stranger-typed content cannot become a pattern.
    var extras = [lead.message, lead.notes, lead.area, lead.campaign,
                  parseSource(lead.source).campaign];
    for (var x = 0; x < extras.length; x++) {
      if (extras[x] && String(extras[x]).toLowerCase().indexOf(query) !== -1) return true;
    }

    var digits = query.replace(/\D/g, '');
    if (!digits) return false;
    var stored = phoneDigits(lead.phone);
    // Two passes: the digits as typed (so a partial "3662" hits), and the same
    // digits normalised (so typing the local "050…" still matches a number
    // stored as "+972 50…" — the search box is where a lead gets lost).
    if (stored.indexOf(digits) !== -1) return true;
    return stored.indexOf(phoneDigits(digits)) !== -1;
  }

  /* Which shelf a lead sits on. The old two-shelf split (handled yes/no)
     hid the entire LIVE pipeline: choosing "נוצר קשר" — the correct action
     after the first phone call — set handled and dropped the lead from the
     default view into the same drawer as the dead deals. Pre-migration rows
     carry no status at all and keep the old behavior exactly, so the CRM
     works on both sides of the deploy. */
  function bucketOf(lead) {
    var s = lead.status;
    if (s === 'contacted' || s === 'proposal' || s === 'contract_sent') return 'active';
    if (s === 'signed' || s === 'lost') return 'closed';
    if (s === 'new') return 'open';
    return lead.handled ? 'closed' : 'open';
  }

  function visibleLeads() {
    var query = state.query.trim().toLowerCase();
    var rows = state.leads.filter(function (lead) {
      var bucket = bucketOf(lead);
      if (state.handled === 'open' && bucket !== 'open') return false;
      if (state.handled === 'active' && bucket !== 'active') return false;
      /* 'done' is the closed shelf; the value survives as an alias. */
      if (state.handled === 'done' && bucket !== 'closed') return false;
      if (state.type !== 'all' && (lead.event_type || '') !== state.type) return false;
      return matchesQuery(lead, query);
    });

    if (state.sort === 'event') {
      rows.sort(function (a, b) { return eventRank(a) - eventRank(b); });
    } else {
      // The server already returns created_at desc, but sorting here as well
      // keeps "newest first" true after an optimistic edit and does not depend
      // on the query string staying correct.
      rows.sort(function (a, b) {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    }
    return rows;
  }

  /** Days of silence on a live lead, or null when there is nothing to flag.
   *  Basis: the newest diary entry when one exists, else arrival. One guard
   *  matters: state.events is a capped global window (1000 rows, 8/lead) —
   *  a lead older than a FULL window has no events in memory and would read
   *  as ancient silence when it may have been worked long ago, so such
   *  leads are never flagged. */
  function silenceDays(lead) {
    if (bucketOf(lead) === 'closed') return null;
    var evs = state.events[lead.id];
    var created = new Date(lead.created_at).getTime();
    if (!evs && eventsWindowFull && eventsOldest && created < eventsOldest) return null;
    var basis = evs && evs.length ? evs[0].created_at : lead.created_at;
    var ms = Date.now() - new Date(basis).getTime();
    if (isNaN(ms)) return null;
    var d = Math.floor(ms / 86400000);
    return d >= STALE_DAYS ? d : null;
  }

  /** Sort key for "לפי קרבת האירוע": the soonest upcoming event first, then
   *  leads with no date yet (still live, just undecided), and only then events
   *  that have already passed — most recent of those first. */
  function eventRank(lead) {
    var day = parseDay(lead.event_date);
    if (!day) return 1e8;
    var days = dayDiff(day);
    if (days < 0) return 1e9 + Math.abs(days);
    return days;
  }

  function renderStats() {
    var open = 0, week = 0, soon = 0, stale = 0;
    var weekAgo = Date.now() - 7 * 86400000;

    state.leads.forEach(function (lead) {
      // Everything not yet closed is money in motion: a studio with six
      // live proposals and zero new enquiries used to see 0 here.
      if (bucketOf(lead) !== 'closed') open++;
      if (silenceDays(lead) !== null) stale++;
      var created = new Date(lead.created_at).getTime();
      if (!isNaN(created) && created >= weekAgo) week++;
      var day = parseDay(lead.event_date);
      if (day) {
        var d = dayDiff(day);
        if (d >= 0 && d <= SOON_DAYS) soon++;
      }
    });

    var total = state.total === null ? state.leads.length : state.total;
    setStat('total', total);
    setStat('open', open);
    setStat('week', week);
    setStat('soon', soon);
    setStat('stale', stale);
  }

  function setStat(name, value) {
    var node = $('[data-stat="' + name + '"]');
    if (node) node.textContent = String(value);
  }

  function renderTypeOptions() {
    if (!typeEl) return;
    var seen = {};
    state.leads.forEach(function (lead) {
      if (lead.event_type) seen[lead.event_type] = true;
    });
    var wanted = Object.keys(seen).sort();
    var current = state.type;

    // Rebuild only when the set changed, so the select does not lose focus on
    // every poll.
    var existing = $$('option', typeEl).map(function (o) { return o.value; })
      .filter(function (v) { return v !== 'all'; });
    if (existing.join('|') === wanted.join('|')) return;

    while (typeEl.firstChild) typeEl.removeChild(typeEl.firstChild);
    var all = el('option', null, 'הכול');
    all.value = 'all';
    typeEl.appendChild(all);
    wanted.forEach(function (value) {
      var opt = el('option', null, typeLabel(value));
      opt.value = value;
      typeEl.appendChild(opt);
    });
    typeEl.value = wanted.indexOf(current) === -1 ? 'all' : current;
    state.type = typeEl.value;
  }

  function render() {
    if (!listEl) return;
    renderStats();
    renderTypeOptions();

    var rows = visibleLeads();

    // If the owner is mid-keystroke in a note, the rebuild below replaces
    // the textarea under the caret — dirtyNotes keeps the TEXT, this keeps
    // the FOCUS and the caret position, keyed by lead id.
    var focused = document.activeElement;
    var focusLead = focused && focused.className === 'crm-note__area'
      ? focused.dataset.lead : null;
    var caret = focusLead ? focused.selectionStart : 0;

    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
    rows.forEach(function (lead) { listEl.appendChild(buildCard(lead)); });

    if (focusLead) {
      var again = $('.crm-note__area[data-lead="' + focusLead + '"]');
      if (again) {
        again.focus();
        try { again.setSelectionRange(caret, caret); } catch (e) { /* type quirks */ }
      }
    }

    if (!rows.length) {
      var message = state.leads.length
        ? 'אין פניות שמתאימות לסינון הנוכחי.'
        : 'עדיין לא הגיעו פניות. ברגע שמישהו ישאיר פרטים באתר, הן יופיעו כאן.';
      if (emptyEl) emptyEl.textContent = message;
      show(emptyEl, true);
    } else {
      show(emptyEl, false);
    }

    if (metaEl) {
      var parts = ['מוצגות ' + rows.length + ' מתוך ' + state.leads.length + ' פניות שנטענו'];
      if (state.total !== null && state.total > state.leads.length) {
        parts.push('נטענו ' + state.leads.length + ' האחרונות מתוך ' + state.total + ' בסך הכול');
      }
      if (state.loadedAt) {
        var t = new Date(state.loadedAt);
        parts.push('עודכן ב־' + pad2(t.getHours()) + ':' + pad2(t.getMinutes()));
      }
      metaEl.textContent = parts.join(' · ');
    }
  }

  /* ----------------------------------------------------------------- data --- */

  function parseTotal(res) {
    // PostgREST answers Prefer: count=exact with "0-24/137". Supabase exposes
    // Content-Range to the browser; if a proxy strips it we simply do not show
    // a total rather than guess one.
    var range = res.headers.get('content-range');
    if (!range) return null;
    var m = /\/(\d+)$/.exec(range);
    return m ? Number(m[1]) : null;
  }

  var loading = false;
  var lastSignature = null;   // serialised server snapshot, to skip idle repaints
  var pendingWrites = 0;      // PATCHes in flight; a poll must not race one

  /** Tear the session down and put the lead list back behind the gate. The DOM
   *  is emptied too: a dead session must not leave customers' phone numbers
   *  sitting in the document for whoever picks the phone up next. */
  function endSession(message) {
    clearSession();
    state.leads = [];
    state.total = null;
    state.contracts = {};
    state.events = {};
    lastSignature = null;
    lastContractsSignature = null;
    lastEventsSignature = null;
    render();
    showGate(message);
  }

  function loadLeads(silent) {
    if (loading) return Promise.resolve();
    loading = true;
    var changed = true;
    if (!silent) {
      show(errorEl, false);
      show(loadingEl, true);
    }

    // select=* on purpose: the same page must work before and after the
    // pipeline migration (docs/supabase-crm-pipeline.sql) adds columns. An
    // explicit list would 400 on whichever side of the deploy it mismatched.
    var path = '/rest/v1/leads?select=*&order=created_at.desc&limit=' + PAGE_LIMIT;

    return api(path, { headers: { Prefer: 'count=exact' } })
      .then(function (res) {
        if (res.status === 401) {
          var expired = new Error('expired');
          expired.expired = true;
          throw expired;
        }
        if (res.status === 403 || res.status === 404) {
          var denied = new Error('החשבון הזה מחובר, אבל אין לו הרשאת קריאה לפניות. ' +
            'צריך להוסיף את המשתמש לטבלת admins בסופאבייס.');
          denied.friendly = true;   // safe to show as-is
          throw denied;
        }
        if (!res.ok) throw new Error('שגיאת שרת (' + res.status + ').');
        var total = parseTotal(res);
        return res.json().then(function (rows) {
          var next = Array.isArray(rows) ? rows : [];
          var signature = JSON.stringify(next);
          // Keep the existing objects when the server says nothing moved. The
          // card buttons close over them, and replacing the array would leave
          // those closures pointing at rows that are no longer in state.
          if (signature === lastSignature) {
            changed = false;
          } else {
            changed = true;
            lastSignature = signature;
            state.leads = next;
          }
          state.total = total;
          state.loadedAt = Date.now();
        });
      })
      .then(function () {
        loading = false;
        show(loadingEl, false);
        show(errorEl, false);
        // A background poll that found no change must not rebuild the list:
        // that would throw away keyboard focus and any text the owner had
        // selected in a lead's message.
        if (!silent || changed) render();
        return loadContracts(silent).then(function () { return loadEvents(silent); });
      })
      .catch(function (err) {
        loading = false;
        show(loadingEl, false);
        if (err && (err.expired || err.message === 'no-session')) {
          endSession('פג תוקף החיבור. אפשר להיכנס שוב.');
          return;
        }
        if (err && err.friendly) {
          showError(err.message);
          return;
        }
        showError('לא הצלחנו לטעון את הפניות. ייתכן שאין חיבור לרשת, ' +
          'או שסופאבייס לא זמין כרגע. אפשר לנסות שוב.');
      });
  }

  var lastContractsSignature = null;

  /** Contracts ride alongside the leads. Failure here is deliberately quiet:
   *  before docs/supabase-crm-pipeline.sql has run the table does not exist,
   *  and the lead list — the part that loses money when it breaks — must keep
   *  working exactly as before. */
  function loadContracts(silent) {
    return api('/rest/v1/contracts' +
      '?select=id,lead_id,status,token,created_at,sent_at,viewed_at,signed_at,couple_name' +
      '&order=created_at.desc&limit=' + PAGE_LIMIT, {})
      .then(function (res) {
        if (!res.ok) {
          state.pipelineReady = res.status !== 404;
          return null;
        }
        state.pipelineReady = true;
        return res.json();
      })
      .then(function (rows) {
        if (!Array.isArray(rows)) return;
        var signature = JSON.stringify(rows);
        if (signature === lastContractsSignature) return;
        lastContractsSignature = signature;
        var map = {};
        rows.forEach(function (c) {
          // Newest first from the server; keep only the newest per lead.
          if (c.lead_id && !map[c.lead_id]) map[c.lead_id] = c;
        });
        state.contracts = map;
        render();
      })
      .catch(function () { /* quiet: see above */ });
  }

  /* The CRM has been WRITING lead_events since the pipeline shipped —
     status_changed, contract_created, contract_sent — and never read one
     back. leads has no updated_at, so this table is the only record of
     last contact that exists; without it a card can only say when the
     enquiry ARRIVED. Same failure discipline as loadContracts: one bulk
     request, silent on error, the lead list never depends on it. */
  var EVENT_LABEL = { status_changed: 'סטטוס עודכן', contract_created: 'נוצר חוזה',
                      contract_sent: 'חוזה נשלח', whatsapp_opened: 'נפתחה שיחת וואטסאפ',
                      call_opened: 'נפתח חיוג' };
  var lastEventsSignature = null;
  var eventsOldest = null;      // oldest created_at in the loaded window (ms)
  var eventsWindowFull = false; // true when the 1000-row window is at capacity
  function loadEvents(silent) {
    // One global newest-first window, not a per-lead query — PostgREST has
    // no cheap top-N-per-group. At ~3 events per worked lead this covers the
    // last ~300 worked leads; beyond the window an old lead simply shows no
    // stamp (nothing extra renders), it never shows a WRONG one.
    return api('/rest/v1/lead_events' +
      '?select=lead_id,type,detail,created_at&order=created_at.desc&limit=1000', {})
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (rows) {
        if (!Array.isArray(rows)) return;
        var signature = JSON.stringify(rows);
        if (signature === lastEventsSignature) return;
        lastEventsSignature = signature;
        eventsWindowFull = rows.length >= 1000;
        eventsOldest = rows.length
          ? new Date(rows[rows.length - 1].created_at).getTime() : null;
        var map = {};
        rows.forEach(function (ev) {
          if (!ev.lead_id) return;
          var list = map[ev.lead_id] || (map[ev.lead_id] = []);
          if (list.length < 8) list.push(ev);   // newest first, capped per lead
        });
        state.events = map;
        render();
      })
      .catch(function () { /* quiet — see above */ });
  }

  /** Timeline entries are nice-to-have; never let one break an action.
   *  Returns the request promise (failure already swallowed) so a caller may
   *  refresh the diary AFTER the row lands rather than racing it. */
  function logEvent(leadId, contractId, type, detail) {
    return api('/rest/v1/lead_events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ lead_id: leadId, contract_id: contractId || null,
                             type: type, detail: detail || null })
    }).catch(function () {});
  }

  function setStatus(lead, next, control) {
    var previous = lead.status || 'new';
    if (next === previous) return;
    lead.status = next;
    // The pipeline and the old handled flag must not disagree: anything past
    // "new" has been handled; back to "new" reopens it.
    var handledNext = next !== 'new';
    var handledPrev = lead.handled;
    lead.handled = handledNext;
    // Null when the change was triggered by something that is not a control
    // (the call/WhatsApp touch) — the render below repaints everything.
    if (control) control.disabled = true;
    pendingWrites++;
    lastSignature = null;
    render();

    function settle() { pendingWrites = Math.max(0, pendingWrites - 1); }

    api('/rest/v1/leads?id=eq.' + encodeURIComponent(lead.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ status: next, handled: handledNext })
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      settle();
      toast('הסטטוס עודכן: ' + (STATUS_LABEL[next] || next));
      logEvent(lead.id, null, 'status_changed', (STATUS_LABEL[previous] || previous) +
        ' ← ' + (STATUS_LABEL[next] || next));
    }, function (err) {
      settle();
      lead.status = previous;
      lead.handled = handledPrev;
      render();
      if (err && (err.expired || err.message === 'no-session')) {
        endSession('פג תוקף החיבור. אפשר להיכנס שוב.');
        return;
      }
      toast('העדכון לא נשמר. אפשר לנסות שוב.');
    });
  }

  function saveNotes(lead, value, button) {
    var previous = lead.notes || '';
    lead.notes = value;
    button.disabled = true;
    pendingWrites++;
    lastSignature = null;

    function settle() { pendingWrites = Math.max(0, pendingWrites - 1); button.disabled = false; }

    api('/rest/v1/leads?id=eq.' + encodeURIComponent(lead.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ notes: value || null })
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      settle();
      delete dirtyNotes[lead.id];   // the draft became the saved note
      toast('הפתק נשמר');
    }, function (err) {
      settle();
      lead.notes = previous;
      dirtyNotes[lead.id] = value;  // the typed text is a draft again — keep it
      if (err && (err.expired || err.message === 'no-session')) {
        endSession('פג תוקף החיבור. אפשר להיכנס שוב.');
        return;
      }
      toast('הפתק לא נשמר. אפשר לנסות שוב.');
    });
  }

  /* ----------------------------------------------------------- contracts --- */

  function contractLink(contract) {
    return CONFIG.contractBase + contract.token;
  }

  function contractWaText(lead, contract) {
    var parts = ['היי ' + (lead.name || '') + ', כאן ' + CONFIG.studioName + '.'];
    parts.push('מצורף ההסכם שלנו לאירוע — אפשר לקרוא ולחתום ישירות מהנייד:');
    parts.push(contractLink(contract));
    parts.push('אם משהו לא ברור, אנחנו כאן לכל שאלה.');
    return stripBidi(parts.join('\n'));
  }

  function markContractSent(lead, contract, button) {
    button.disabled = true;
    pendingWrites++;
    function settle() { pendingWrites = Math.max(0, pendingWrites - 1); }

    api('/rest/v1/contracts?id=eq.' + encodeURIComponent(contract.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'sent', sent_at: new Date().toISOString() })
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      settle();
      contract.status = 'sent';
      lastContractsSignature = null;
      logEvent(lead.id, contract.id, 'contract_sent', 'החוזה סומן כנשלח');
      // The extra !== 'contract_sent' guard matters: setStatus no-ops when
      // next equals current — early return, no render — and the button this
      // function disabled stayed disabled over a state line still reading
      // "טיוטה". A dead button that reads as "the contract didn't send".
      var cur = lead.status || 'new';
      if (cur !== 'signed' && cur !== 'contract_sent') setStatus(lead, 'contract_sent', button);
      else render();
      toast('החוזה סומן כנשלח');
    }, function () {
      settle();
      button.disabled = false;
      toast('העדכון לא נשמר. אפשר לנסות שוב.');
    });
  }

  /** The create-contract dialog. Built once, filled per lead. Plain DOM, same
   *  rules as every card: values go in via textContent/value, never HTML. */
  var dialogEl = null;
  var dialogOpener = null;   // focus goes back where it came from on close

  function fieldRow(labelText, inputEl) {
    var wrap = el('label', 'field');
    wrap.appendChild(el('span', 'field__label', labelText));
    inputEl.className = 'field__control';
    wrap.appendChild(inputEl);
    return wrap;
  }

  function input(type, name, value) {
    var node = document.createElement('input');
    node.type = type;
    node.name = name;
    if (value !== undefined && value !== null) node.value = value;
    return node;
  }

  function openContractDialog(lead) {
    closeContractDialog();

    var overlay = el('div', 'crm-dialog');
    var box = el('form', 'crm-dialog__box');
    box.setAttribute('novalidate', 'novalidate');

    box.appendChild(el('h2', 'crm-dialog__title', 'חוזה חדש — ' + (lead.name || '')));
    box.appendChild(el('p', 'crm-dialog__note',
      'המחיר נשאר בחוזה בלבד — הוא לא מופיע בשום מקום באתר.'));

    var fName = input('text', 'couple_name', lead.name || '');
    var fPhone = input('tel', 'phone', lead.phone || '');
    var fEmail = input('email', 'email', lead.email || '');
    var fDate = input('date', 'event_date', lead.event_date || '');
    var fVenue = input('text', 'venue', '');
    var fPackage = input('text', 'package', 'צילום סטילס + וידאו · שלושה צלמים · אירוע מלא');
    var fHours = input('text', 'hours', '');
    var fPrice = input('number', 'price_total', '');
    fPrice.min = '0'; fPrice.step = '50';
    var fDeposit = input('number', 'deposit', '');
    fDeposit.min = '0'; fDeposit.step = '50';

    box.appendChild(fieldRow('שם הלקוחות (כפי שיופיע בחוזה)', fName));
    box.appendChild(fieldRow('טלפון', fPhone));
    box.appendChild(fieldRow('אימייל (לא חובה)', fEmail));
    box.appendChild(fieldRow('תאריך האירוע', fDate));
    box.appendChild(fieldRow('מקום האירוע (לא חובה)', fVenue));
    box.appendChild(fieldRow('החבילה', fPackage));
    box.appendChild(fieldRow('שעות צילום (לא חובה)', fHours));
    box.appendChild(fieldRow('סך התמורה בש״ח (לא חובה)', fPrice));
    box.appendChild(fieldRow('מקדמה בש״ח (לא חובה)', fDeposit));

    var errEl = el('p', 'form__failure', '');
    errEl.hidden = true;
    box.appendChild(errEl);

    var actions = el('div', 'crm-dialog__actions');
    var cancel = el('button', 'crm-act', 'ביטול');
    cancel.type = 'button';
    cancel.addEventListener('click', closeContractDialog);
    var create = el('button', 'crm-act crm-act--mark', 'יצירת חוזה');
    create.type = 'submit';
    actions.appendChild(cancel);
    actions.appendChild(create);
    box.appendChild(actions);

    box.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = fName.value.trim();
      if (name.length < 2) {
        errEl.textContent = 'צריך שם לקוחות.';
        errEl.hidden = false;
        return;
      }
      create.disabled = true;
      create.textContent = 'יוצרים…';
      errEl.hidden = true;

      var row = {
        lead_id: lead.id,
        couple_name: name,
        phone: fPhone.value.trim() || null,
        email: fEmail.value.trim() || null,
        event_date: fDate.value || null,
        event_type: lead.event_type ? typeLabel(lead.event_type) : null,
        venue: fVenue.value.trim() || null,
        package: fPackage.value.trim() || null,
        hours: fHours.value.trim() || null,
        price_total: fPrice.value === '' ? null : Number(fPrice.value),
        deposit: fDeposit.value === '' ? null : Number(fDeposit.value)
      };

      api('/rest/v1/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(row)
      }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function (rows) {
        var contract = Array.isArray(rows) ? rows[0] : rows;
        if (!contract || !contract.token) throw new Error('no token');
        state.contracts[lead.id] = contract;
        lastContractsSignature = null;
        logEvent(lead.id, contract.id, 'contract_created', 'נוצר חוזה');
        closeContractDialog();
        render();
        toast('החוזה נוצר. עכשיו אפשר לשלוח אותו בוואטסאפ.');
      }).catch(function (err) {
        create.disabled = false;
        create.textContent = 'יצירת חוזה';
        if (err && (err.expired || err.message === 'no-session')) {
          endSession('פג תוקף החיבור. אפשר להיכנס שוב.');
          return;
        }
        errEl.textContent = 'החוזה לא נוצר. אם זו הפעם הראשונה — ייתכן שהמיגרציה ' +
          '(docs/supabase-crm-pipeline.sql) עוד לא הורצה.';
        errEl.hidden = false;
      });
    });

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeContractDialog();
    });
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    dialogEl = overlay;
    dialogOpener = document.activeElement;
    fName.focus();
  }

  function closeContractDialog() {
    if (dialogEl && dialogEl.parentNode) dialogEl.parentNode.removeChild(dialogEl);
    dialogEl = null;
    if (dialogOpener && dialogOpener.focus && document.contains(dialogOpener)) {
      dialogOpener.focus();
    }
    dialogOpener = null;
  }

  /* Keyboard: Escape closes the dialog (focus returns to its opener) and Tab
     stays inside it — before this, Tab walked out behind the overlay and
     Escape did nothing on the owner's own laptop. Outside a dialog, `/`
     jumps to the search box: the shortcut that makes a 500-row list usable
     without a mouse. */
  document.addEventListener('keydown', function (e) {
    if (dialogEl) {
      if (e.key === 'Escape') { e.preventDefault(); closeContractDialog(); return; }
      if (e.key === 'Tab') {
        var items = $$('a[href], button:not([disabled]), input, select, textarea', dialogEl)
          .filter(function (n) { return n.offsetParent !== null; });
        if (!items.length) return;
        var first = items[0];
        var last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      return;
    }
    if (e.key === '/' && searchEl) {
      var t = e.target;
      var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (!typing) { e.preventDefault(); searchEl.focus(); }
    }
  });

  function setHandled(lead, next, button) {
    var previous = lead.handled;
    lead.handled = next;           // optimistic — the list stays responsive
    button.disabled = true;
    pendingWrites++;
    // The optimistic value no longer matches the last server snapshot, so the
    // next poll must be allowed to repaint.
    lastSignature = null;
    render();

    function settle() { pendingWrites = Math.max(0, pendingWrites - 1); }

    api('/rest/v1/leads?id=eq.' + encodeURIComponent(lead.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ handled: next })
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res;
    }).then(function () {
      settle();
      toast(next ? 'סומן כטופל' : 'הוחזר לממתינות');
    }, function (err) {
      // Two-argument then, not .catch: a throw inside the success branch above
      // must not run this handler as well and decrement pendingWrites twice.
      settle();
      lead.handled = previous;     // put the truth back on screen
      render();
      if (err && (err.expired || err.message === 'no-session')) {
        endSession('פג תוקף החיבור. אפשר להיכנס שוב.');
        return;
      }
      toast('העדכון לא נשמר. אפשר לנסות שוב.');
    });
  }

  /* ------------------------------------------------------------- wiring --- */

  if (loginForm) {
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = loginEmail ? loginEmail.value.trim() : '';
      var password = loginPassword ? loginPassword.value : '';
      if (!email || !password) {
        loginError.textContent = 'צריך אימייל וסיסמה.';
        loginError.hidden = false;
        return;
      }

      loginSubmit.disabled = true;
      loginSubmit.textContent = 'נכנסים…';
      loginError.hidden = true;

      signIn(email, password).then(function () {
        loginSubmit.disabled = false;
        loginSubmit.textContent = 'כניסה';
        if (loginPassword) loginPassword.value = '';
        showApp();
        loadLeads(false);
      }, function (err) {
        loginSubmit.disabled = false;
        loginSubmit.textContent = 'כניסה';
        loginError.hidden = false;
        // 400 from GoTrue is a wrong pair; anything else is infrastructure.
        loginError.textContent = (err && err.status === 400)
          ? 'האימייל או הסיסמה אינם נכונים.'
          : 'לא הצלחנו להתחבר כרגע. בדקו את החיבור לרשת ונסו שוב.';
      });
    });
  }

  if (signoutBtn) {
    signoutBtn.addEventListener('click', function () {
      var token = session && session.access_token;
      if (token) {
        // Best effort: revoke server-side too, so the refresh token dies with
        // the click and not only in this browser.
        fetchWithTimeout(base + '/auth/v1/logout', {
          method: 'POST',
          headers: { apikey: CONFIG.supabaseKey, Authorization: 'Bearer ' + token }
        }).catch(function () {});
      }
      endSession('');
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', function () { loadLeads(false); });
  }
  if (retryBtn) {
    retryBtn.addEventListener('click', function () { loadLeads(false); });
  }

  if (searchEl) {
    // Debounced: every keystroke rebuilds up to 500 cards synchronously,
    // which is visible jank on the phone this page actually runs on.
    var searchTimer = null;
    searchEl.addEventListener('input', function () {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.query = searchEl.value;
        render();
      }, 120);
    });
  }
  if (typeEl) {
    typeEl.addEventListener('change', function () {
      state.type = typeEl.value;
      render();
    });
  }
  if (sortEl) {
    sortEl.addEventListener('change', function () {
      state.sort = sortEl.value;
      render();
    });
  }
  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      state.handled = chip.dataset.filterHandled;
      chips.forEach(function (c) {
        c.setAttribute('aria-pressed', String(c === chip));
      });
      render();
    });
  });

  // Poll quietly while the tab is open and visible; a studio leaves this page
  // up on a phone during the day and should not have to pull to refresh.
  setInterval(function () {
    // pendingWrites: a poll landing while a PATCH is in flight would overwrite
    // the optimistic value with the server's pre-PATCH snapshot and flip the
    // card back under the owner's finger. dirtyNotes: the same courtesy for a
    // note mid-typing — the draft would survive the repaint (dirtyNotes), but
    // there is no reason to repaint under the caret at all.
    if (document.hidden || !session || pendingWrites) return;
    if (Object.keys(dirtyNotes).length) return;
    loadLeads(true);
  }, POLL_INTERVAL);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden || !session || pendingWrites) return;
    if (Object.keys(dirtyNotes).length) return;
    if (Date.now() - state.loadedAt > POLL_INTERVAL) loadLeads(true);
  });

  /* ---------------------------------------------------------------- boot --- */

  session = readStored();

  if (!session) {
    showGate('');
  } else {
    showApp();
    show(loadingEl, true);
    // The stored access token may already be stale; ensureToken inside
    // loadLeads renews it before the first read.
    loadLeads(false);
  }
})();

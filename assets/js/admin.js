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
    studioName: 'Amora Studio'
  };

  var STORE_KEY = 'amora.crm.session';
  var PAGE_LIMIT = 500;      // newest N leads; the header tells us the true total
  var REQUEST_TIMEOUT = 15000;
  var REFRESH_MARGIN = 90;   // seconds before expiry that we renew the token
  var POLL_INTERVAL = 120000;
  var SOON_DAYS = 30;        // an event this close is "approaching"
  var HORIZON_DAYS = 90;     // beyond this an event is not yet pressing

  var TYPE_LABEL = { wedding: 'חתונה', std: 'Save the Date', henna: 'חינה / אירוסין',
                     mitzvah: 'בר / בת מצווה', other: 'אירוע אחר' };
  var COVERAGE_LABEL = { both: 'סטילס + וידאו', stills: 'סטילס בלבד',
                         video: 'וידאו בלבד', unsure: 'עוד לא בטוחים' };
  var WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  var base = CONFIG.supabaseUrl.replace(/\/+$/, '');

  /* ------------------------------------------------------------- helpers --- */

  /** Build an element. Text always goes in via textContent — lead fields are
   *  attacker-controllable input and must never be parsed as HTML. */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null && text !== '') node.textContent = String(text);
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

  function relativeArrival(iso) {
    var when = new Date(iso);
    if (isNaN(when.getTime())) return '';
    var mins = Math.round((Date.now() - when.getTime()) / 60000);
    if (mins < 1) return 'התקבלה עכשיו';
    if (mins === 1) return 'התקבלה לפני דקה';
    if (mins === 2) return 'התקבלה לפני שתי דקות';
    if (mins < 60) return 'התקבלה לפני ' + mins + ' דקות';
    var hours = Math.round(mins / 60);
    if (hours === 1) return 'התקבלה לפני שעה';
    if (hours === 2) return 'התקבלה לפני שעתיים';
    if (hours < 24) return 'התקבלה לפני ' + hours + ' שעות';
    var days = Math.round(hours / 24);
    if (days === 1) return 'התקבלה אתמול';
    if (days === 2) return 'התקבלה לפני יומיים';
    if (days < 30) return 'התקבלה לפני ' + days + ' ימים';
    return 'התקבלה ב־' + formatDay(when);
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
    return TYPE_LABEL[value] || value;
  }

  function coverageLabel(value) {
    if (!value) return '';
    return COVERAGE_LABEL[value] || value;
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
    var line = 'קיבלנו את הפנייה שלכם מהאתר';
    if (subject) line += ' לגבי ' + subject;
    if (day) line += ' בתאריך ' + formatDay(day);
    parts.push(line + '.');
    parts.push('נשמח לבדוק זמינות ולחזור אליכם עם כל הפרטים — מתי נוח לכם לדבר?');
    return parts.join(' ');
  }

  function detailsFor(lead) {
    var day = parseDay(lead.event_date);
    var rows = [
      'שם: ' + (lead.name || ''),
      'טלפון: ' + (lead.phone || ''),
      day ? 'תאריך האירוע: ' + formatDay(day) + ' (יום ' + WEEKDAYS[day.getDay()] + ')' : '',
      lead.event_type ? 'סוג אירוע: ' + typeLabel(lead.event_type) : '',
      lead.area ? 'אזור: ' + lead.area : '',
      lead.coverage ? 'מה מצלמים: ' + coverageLabel(lead.coverage) : '',
      lead.message ? 'הודעה: ' + lead.message : '',
      'התקבלה: ' + formatDay(new Date(lead.created_at))
    ];
    return rows.filter(Boolean).join('\n');
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
    badges.appendChild(el('span', 'crm-card__badge crm-card__badge--status',
      lead.handled ? 'טופל' : 'ממתין'));
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
    if (day) {
      addRow(dl, 'תאריך האירוע',
        formatDay(day) + ' · יום ' + WEEKDAYS[day.getDay()]);
    }
    addRow(dl, 'סוג אירוע', typeLabel(lead.event_type));
    addRow(dl, 'אזור', lead.area);
    addRow(dl, 'מה מצלמים', coverageLabel(lead.coverage));
    if (dl.childNodes.length) li.appendChild(dl);

    if (lead.message) {
      var quote = el('p', 'crm-card__message', lead.message);
      li.appendChild(quote);
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

    var digits = query.replace(/\D/g, '');
    if (!digits) return false;
    var stored = phoneDigits(lead.phone);
    // Two passes: the digits as typed (so a partial "3662" hits), and the same
    // digits normalised (so typing the local "050…" still matches a number
    // stored as "+972 50…" — the search box is where a lead gets lost).
    if (stored.indexOf(digits) !== -1) return true;
    return stored.indexOf(phoneDigits(digits)) !== -1;
  }

  function visibleLeads() {
    var query = state.query.trim().toLowerCase();
    var rows = state.leads.filter(function (lead) {
      if (state.handled === 'open' && lead.handled) return false;
      if (state.handled === 'done' && !lead.handled) return false;
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
    var open = 0, week = 0, soon = 0;
    var weekAgo = Date.now() - 7 * 86400000;

    state.leads.forEach(function (lead) {
      if (!lead.handled) open++;
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

    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
    rows.forEach(function (lead) { listEl.appendChild(buildCard(lead)); });

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
    lastSignature = null;
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

    var path = '/rest/v1/leads' +
      '?select=id,created_at,name,phone,event_date,event_type,area,coverage,message,source,handled' +
      '&order=created_at.desc&limit=' + PAGE_LIMIT;

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
    searchEl.addEventListener('input', function () {
      state.query = searchEl.value;
      render();
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
    // card back under the owner's finger.
    if (document.hidden || !session || pendingWrites) return;
    loadLeads(true);
  }, POLL_INTERVAL);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden || !session || pendingWrites) return;
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

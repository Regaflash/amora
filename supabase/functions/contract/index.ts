// The couple's contract page: view and sign.
//
// The CRM creates a row in public.contracts; its `token` becomes a capability
// URL —  .../functions/v1/contract?t=<token>  — that the studio sends the
// couple, usually over WhatsApp. GET renders the branded contract; POST
// records the signature. Whoever holds the link holds the contract, which is
// why the token is 24 random bytes and why this function never lists,
// searches, or enumerates anything.
//
// verify_jwt is disabled: the couple has no Supabase account. The token in
// the URL is the authentication, checked against the table on every request
// with the service role.
//
// Branding is inline and self-contained — the site's palette and no external
// requests except the studio logo from the live site. The terms text is a
// DRAFT and carries the same visible not-yet-lawyered banner as the site's
// legal pages; the studio's own details print as [להשלים] until the owner
// fills them into CONTRACT_STUDIO below.
//
// If RESEND_API_KEY + LEAD_ALERT_TO are configured (same envs as lead-alert),
// a signed contract also emails both sides a confirmation. If they are not,
// signing still works — the confirmation email is an extra, not the record.
// The record is the row.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY');
const ALERT_TO = Deno.env.get('LEAD_ALERT_TO');
const ALERT_FROM = Deno.env.get('LEAD_ALERT_FROM') ?? 'Amora Studio <onboarding@resend.dev>';

// Owner-supplied studio identity. [להשלים] renders literally on the page —
// the same convention as privacy.html/terms.html — so a contract sent before
// these are filled is visibly a draft, not silently incomplete.
const CONTRACT_STUDIO = {
  name: 'Amora Studio',
  legalName: '[להשלים — שם העוסק/החברה]',
  businessId: '[להשלים — ע.מ/ח.פ]',
  phone: '[להשלים — טלפון הסטודיו]',
  email: '[להשלים — אימייל הסטודיו]',
  site: 'amora-studios.com',
};

interface ContractRow {
  id: string;
  lead_id: string | null;
  created_at: string;
  status: 'draft' | 'sent' | 'signed' | 'cancelled';
  token: string;
  couple_name: string;
  phone: string | null;
  email: string | null;
  event_date: string | null;
  event_type: string | null;
  venue: string | null;
  package: string | null;
  hours: string | null;
  price_total: number | null;
  deposit: number | null;
  notes: string | null;
  terms_version: string;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  signed_name: string | null;
  signature: string | null;
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function stripBidi(v: unknown): string {
  return String(v ?? '').replace(/[‪-‮⁦-⁩‎‏؜]/g, '');
}

function field(v: unknown): string {
  return esc(stripBidi(v));
}

function shekel(v: number | null): string {
  if (v === null || v === undefined || isNaN(Number(v))) return '';
  return Number(v).toLocaleString('he-IL', { maximumFractionDigits: 2 }) + ' ₪';
}

function hebDate(iso: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '';
  return `${m[3]}.${m[2]}.${m[1]}`;
}

async function rest(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('apikey', SERVICE_KEY);
  headers.set('authorization', `Bearer ${SERVICE_KEY}`);
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, { ...init, headers });
}

async function findByToken(token: string): Promise<ContractRow | null> {
  if (!/^[a-f0-9]{40,64}$/.test(token)) return null;
  const res = await rest(`/contracts?token=eq.${token}&limit=1`, { method: 'GET' });
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows[0] ? rows[0] as ContractRow : null;
}

/* --------------------------------------------------------------- page ---- */

const PAGE_CSS = `
  :root { --champagne:#C9AE8C; --sand:#D9C3A5; --cream:#F7F2EA; --ivory:#FFFDF9;
          --mocha:#6B5B4B; --charcoal:#1C1A18; --rule:rgba(107,91,75,.24); }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--cream); color:var(--charcoal);
         font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;
         line-height:1.65; padding:24px 16px 64px; }
  .sheet { max-width:720px; margin:0 auto; background:var(--ivory);
           border:1px solid var(--rule); padding:clamp(24px,5vw,56px); }
  .brand { text-align:center; border-bottom:1px solid var(--rule);
           padding-bottom:24px; margin-bottom:28px; }
  .brand img { width:64px; height:64px; border-radius:50%; object-fit:cover; }
  .brand__name { font-size:22px; letter-spacing:.12em; margin-top:10px; }
  .brand__sub { font-size:12px; letter-spacing:.2em; color:var(--mocha); }
  h1 { font-size:clamp(22px,4vw,30px); text-align:center; font-weight:600;
       margin-bottom:6px; }
  .muted { color:var(--mocha); font-size:14px; text-align:center; }
  .draftband { background:#fdf3e3; border:1px solid var(--sand); color:#7a5c33;
               font-size:13px; padding:10px 14px; margin:20px 0; text-align:center; }
  h2 { font-size:15px; letter-spacing:.14em; color:var(--mocha);
       border-bottom:1px solid var(--rule); padding-bottom:6px;
       margin:30px 0 12px; font-weight:600; }
  table.kv { width:100%; border-collapse:collapse; font-size:15px; }
  table.kv td { padding:7px 0; vertical-align:top; }
  table.kv td:first-child { color:var(--mocha); width:34%; white-space:nowrap; }
  .terms p { font-size:14px; margin-bottom:10px; }
  .sig { margin-top:34px; border-top:1px solid var(--rule); padding-top:24px; }
  .sig label { display:block; font-size:14px; color:var(--mocha); margin:14px 0 6px; }
  .sig input[type=text] { width:100%; padding:12px; font-size:16px;
       border:1px solid var(--rule); background:var(--ivory); color:var(--charcoal); }
  #pad { width:100%; height:180px; border:1px dashed var(--mocha);
         background:#fff; touch-action:none; border-radius:2px; cursor:crosshair; }
  .padrow { display:flex; justify-content:space-between; align-items:center; margin-top:6px; }
  .clear { background:none; border:none; color:var(--mocha); font-size:13px;
           cursor:pointer; text-decoration:underline; }
  .agree { display:flex; gap:10px; align-items:flex-start; font-size:14px; margin:18px 0; }
  .agree input { margin-top:4px; width:18px; height:18px; accent-color:var(--charcoal); }
  .submit { display:block; width:100%; background:var(--charcoal); color:var(--ivory);
            font-size:17px; padding:15px; border:none; cursor:pointer;
            letter-spacing:.06em; }
  .submit:disabled { opacity:.55; cursor:default; }
  .err { color:#8f2f1e; font-size:14px; margin-top:10px; display:none; }
  .signedbox { border:1px solid var(--champagne); background:#faf6ee;
               padding:18px; margin-top:26px; }
  .signedbox img { max-width:280px; display:block; margin-top:8px;
                   border-bottom:1px solid var(--rule); }
  .print { margin-top:18px; text-align:center; }
  .print button { background:none; border:1px solid var(--charcoal);
                  color:var(--charcoal); padding:10px 22px; font-size:14px; cursor:pointer; }
  footer { text-align:center; font-size:12px; color:var(--mocha); margin-top:26px; }
  @media print {
    body { background:#fff; padding:0; }
    .sheet { border:none; max-width:none; }
    .print, .clear, .submit, .agree, #pad, .sig label[for=pad] { display:none !important; }
  }
`;

function shell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow, noarchive" />
<title>${esc(title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<div class="sheet">
<header class="brand">
  <img src="https://www.amora-studios.com/assets/img/logo.jpg" alt="Amora Studio" />
  <p class="brand__name">Amora Studio</p>
  <p class="brand__sub">PHOTO · FILM</p>
</header>
${body}
<footer>Amora Studio · amora-studios.com</footer>
</div>
</body>
</html>`;
}

function detailRows(c: ContractRow): string {
  const rows: Array<[string, string]> = [];
  rows.push(['שם הלקוחות', field(c.couple_name)]);
  if (c.phone) rows.push(['טלפון', field(c.phone)]);
  if (c.email) rows.push(['אימייל', field(c.email)]);
  if (c.event_date) rows.push(['תאריך האירוע', hebDate(c.event_date)]);
  if (c.event_type) rows.push(['סוג האירוע', field(c.event_type)]);
  if (c.venue) rows.push(['מקום האירוע', field(c.venue)]);
  if (c.package) rows.push(['החבילה', field(c.package)]);
  if (c.hours) rows.push(['שעות צילום', field(c.hours)]);
  return rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('');
}

function paymentRows(c: ContractRow): string {
  const rows: Array<[string, string]> = [];
  if (c.price_total !== null) rows.push(['סך התמורה', shekel(c.price_total)]);
  if (c.deposit !== null) rows.push(['מקדמה בחתימה', shekel(c.deposit)]);
  if (c.price_total !== null && c.deposit !== null) {
    rows.push(['יתרה עד מועד האירוע', shekel(Number(c.price_total) - Number(c.deposit))]);
  }
  if (!rows.length) return '';
  return `<h2>התמורה</h2><table class="kv">${
    rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('')
  }</table>`;
}

// The delivery clause repeats what the site already promises — 7 days to the
// first gallery, 30 days to full delivery, the album two weeks after the
// selection is approved, a 3–5 minute film. A contract must never promise
// less than the homepage does.
const TERMS_HTML = `
<div class="terms">
<h2>מה כלול ואיך זה עובד</h2>
<p>1. הסטודיו יצלם את האירוע בהתאם לחבילה המפורטת לעיל, בצוות של שני צלמים באירוע מלא (סטילס ווידאו).</p>
<p>2. גלריה ראשונה נמסרת בתוך 7 ימים מהאירוע; אספקה מלאה של התוצרים בתוך 30 יום.</p>
<p>3. ככל שהחבילה כוללת אלבום מודפס — האלבום נמסר עד שבועיים לאחר אישור בחירת התמונות על ידי הלקוחות.</p>
<p>4. ככל שהחבילה כוללת סרט חתונה — אורכו 3 עד 5 דקות, מתוך חומרי הגלם של האירוע.</p>
<p>5. חומרי הגלם והתוצרים נשמרים אצל הסטודיו לתקופה של [להשלים] חודשים ממועד האספקה.</p>
<h2>זכויות ופרטיות</h2>
<p>6. זכויות היוצרים בתוצרים שייכות לסטודיו; הלקוחות מקבלים רישיון שימוש אישי, לא מסחרי, ללא הגבלת זמן.</p>
<p>7. פרסום תמונות מהאירוע בערוצי הסטודיו ייעשה רק בהסכמת הלקוחות. ברירת המחדל היא: [להשלים — בהסכמה מראש / מותר אלא אם נאמר אחרת].</p>
<h2>שינויים וביטולים</h2>
<p>8. שינוי תאריך בכפוף לזמינות הסטודיו. [להשלים — מדיניות דחייה].</p>
<p>9. ביטול על ידי הלקוחות: [להשלים — מדרגות החזר/חילוט מקדמה בהתאם למועד הביטול ולדין].</p>
<p>10. כוח עליון: [להשלים].</p>
<p>11. על הסכם זה יחול הדין הישראלי. [להשלים — סמכות שיפוט].</p>
</div>`;

function signedBox(c: ContractRow): string {
  const when = c.signed_at ? new Date(c.signed_at) : null;
  const stamp = when
    ? `${String(when.getUTCDate()).padStart(2, '0')}.${String(when.getUTCMonth() + 1).padStart(2, '0')}.${when.getUTCFullYear()}`
    : '';
  return `
<div class="signedbox">
  <strong>ההסכם נחתם ✓</strong>
  <p style="font-size:14px;margin-top:4px">נחתם על ידי ${field(c.signed_name)} בתאריך ${esc(stamp)}.</p>
  ${c.signature ? `<img src="${esc(c.signature)}" alt="חתימה" />` : ''}
</div>
<div class="print"><button onclick="window.print()">הדפסה / שמירה כ־PDF</button></div>`;
}

function signForm(c: ContractRow): string {
  return `
<div class="sig">
  <h2>חתימה</h2>
  <label for="signer">שם מלא של החותם/ת</label>
  <input type="text" id="signer" maxlength="160" autocomplete="name"
         value="${field(c.couple_name)}" />
  <label for="pad">חתימה — לחתום עם האצבע או העכבר בתוך המסגרת</label>
  <canvas id="pad" width="640" height="180"></canvas>
  <div class="padrow"><span class="muted" style="text-align:start">החתימה נשמרת יחד עם מועד החתימה</span>
    <button type="button" class="clear" id="clear">ניקוי</button></div>
  <label class="agree"><input type="checkbox" id="agree" />
    <span>קראנו את ההסכם על כל סעיפיו, ואנחנו מאשרים ומסכימים לתוכנו.</span></label>
  <button type="button" class="submit" id="send">חתימה על ההסכם</button>
  <p class="err" id="err"></p>
</div>
<script>
(function () {
  'use strict';
  var pad = document.getElementById('pad');
  var ctx = pad.getContext('2d');
  var drawn = false, drawing = false;

  function pos(e) {
    var r = pad.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (pad.width / r.width),
             y: (e.clientY - r.top) * (pad.height / r.height) };
  }
  ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#1C1A18';

  pad.addEventListener('pointerdown', function (e) {
    drawing = true; drawn = true;
    pad.setPointerCapture(e.pointerId);
    var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
    e.preventDefault();
  });
  pad.addEventListener('pointermove', function (e) {
    if (!drawing) return;
    var p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke();
    e.preventDefault();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) {
    pad.addEventListener(t, function () { drawing = false; });
  });
  document.getElementById('clear').addEventListener('click', function () {
    ctx.clearRect(0, 0, pad.width, pad.height); drawn = false;
  });

  var send = document.getElementById('send');
  var err = document.getElementById('err');
  send.addEventListener('click', function () {
    err.style.display = 'none';
    var name = document.getElementById('signer').value.trim();
    if (name.length < 2) { fail('צריך למלא שם מלא.'); return; }
    if (!drawn) { fail('צריך לחתום בתוך המסגרת.'); return; }
    if (!document.getElementById('agree').checked) { fail('צריך לאשר את קריאת ההסכם.'); return; }

    send.disabled = true; send.textContent = 'שולחים…';
    fetch(window.location.pathname + window.location.search, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, signature: pad.toDataURL('image/png') })
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      window.location.reload();
    }).catch(function () {
      send.disabled = false; send.textContent = 'חתימה על ההסכם';
      fail('החתימה לא נשלחה. בדקו את החיבור ונסו שוב.');
    });
  });
  function fail(msg) { err.textContent = msg; err.style.display = 'block'; }
})();
</script>`;
}

function contractPage(c: ContractRow): string {
  const body = `
<h1>הסכם צילום אירוע</h1>
<p class="muted">מסמך מס׳ ${esc(c.id.slice(0, 8))} · נוצר ${hebDate(c.created_at.slice(0, 10))}</p>
<div class="draftband">נוסח ההסכם הוא טיוטה הנמצאת בבדיקה משפטית. סעיפים המסומנים [להשלים] טרם נקבעו סופית.</div>
<h2>הצדדים</h2>
<table class="kv">
  <tr><td>הסטודיו</td><td>${esc(CONTRACT_STUDIO.name)} · ${esc(CONTRACT_STUDIO.legalName)} · ${esc(CONTRACT_STUDIO.businessId)}</td></tr>
  <tr><td>הלקוחות</td><td>${field(c.couple_name)}</td></tr>
</table>
<h2>פרטי האירוע והחבילה</h2>
<table class="kv">${detailRows(c)}</table>
${paymentRows(c)}
${c.notes ? `<h2>הערות</h2><p style="font-size:14px">${field(c.notes)}</p>` : ''}
${TERMS_HTML}
${c.status === 'signed' ? signedBox(c) : c.status === 'cancelled'
    ? '<div class="draftband">ההסכם בוטל על ידי הסטודיו ואינו זמין לחתימה.</div>'
    : signForm(c)}`;
  return shell('הסכם צילום — Amora Studio', body);
}

const NOT_FOUND = shell('Amora Studio', `
<h1>הקישור אינו תקף</h1>
<p class="muted" style="margin-top:10px">לא נמצא כאן הסכם. ייתכן שהקישור הועתק חלקית —
כדאי לחזור להודעה שקיבלתם מהסטודיו וללחוץ עליו שוב.</p>`);

/* -------------------------------------------------------------- server ---- */

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const token = (url.searchParams.get('t') ?? '').trim();

  const htmlHeaders = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'content-security-policy':
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
      "img-src data: https://www.amora-studios.com; connect-src 'self'",
  };

  if (req.method === 'GET') {
    if (!token) return new Response(NOT_FOUND, { status: 404, headers: htmlHeaders });
    const c = await findByToken(token);
    if (!c) return new Response(NOT_FOUND, { status: 404, headers: htmlHeaders });

    if (!c.viewed_at && (c.status === 'draft' || c.status === 'sent')) {
      // First open: stamp it and note it on the timeline. Service role writes;
      // the CRM's own column grants deliberately cannot touch viewed_at.
      await rest(`/contracts?id=eq.${c.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', prefer: 'return=minimal' },
        body: JSON.stringify({ viewed_at: new Date().toISOString() }),
      }).catch(() => {});
      if (c.lead_id) {
        await rest('/lead_events', {
          method: 'POST',
          headers: { 'content-type': 'application/json', prefer: 'return=minimal' },
          body: JSON.stringify({ lead_id: c.lead_id, contract_id: c.id,
            type: 'contract_viewed', detail: 'ההסכם נפתח לראשונה' }),
        }).catch(() => {});
      }
    }
    return new Response(contractPage(c), { status: 200, headers: htmlHeaders });
  }

  if (req.method === 'POST') {
    if (!token) return new Response('forbidden', { status: 403 });
    const c = await findByToken(token);
    if (!c) return new Response('forbidden', { status: 403 });
    if (c.status === 'signed') return new Response('already signed', { status: 409 });
    if (c.status === 'cancelled') return new Response('cancelled', { status: 410 });

    let body: { name?: string; signature?: string };
    try { body = await req.json(); } catch { return new Response('bad json', { status: 400 }); }

    const name = stripBidi(body.name ?? '').trim();
    const signature = String(body.signature ?? '');
    if (name.length < 2 || name.length > 160) return new Response('bad name', { status: 422 });
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature) ||
        signature.length > 300000) {
      return new Response('bad signature', { status: 422 });
    }

    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
    const ua = (req.headers.get('user-agent') ?? '').slice(0, 300);

    const patch = await rest(`/contracts?id=eq.${c.id}&status=neq.signed`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'signed',
        signed_at: new Date().toISOString(),
        signed_name: name.slice(0, 160),
        signature,
        signer_ip: ip || null,
        signer_ua: ua || null,
      }),
    });
    if (!patch.ok) {
      console.error('contract: sign failed', { id: c.id, status: patch.status });
      return new Response('sign failed', { status: 502 });
    }

    if (c.lead_id) {
      await rest(`/leads?id=eq.${c.lead_id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'signed', handled: true }),
      }).catch(() => {});
      await rest('/lead_events', {
        method: 'POST',
        headers: { 'content-type': 'application/json', prefer: 'return=minimal' },
        body: JSON.stringify({ lead_id: c.lead_id, contract_id: c.id,
          type: 'contract_signed', detail: `נחתם על ידי ${name.slice(0, 120)}` }),
      }).catch(() => {});
    }

    // Confirmation emails are best-effort extras; the signed row is the record.
    if (RESEND_KEY && ALERT_TO) {
      const link = `${url.origin}${url.pathname}?t=${c.token}`;
      const to: string[] = [ALERT_TO];
      if (c.email) to.push(stripBidi(c.email).split('?')[0]);
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${RESEND_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: ALERT_FROM, to, reply_to: ALERT_TO,
          subject: `הסכם חתום ✓ ${stripBidi(c.couple_name)}`,
          text: `ההסכם נחתם על ידי ${name}.\n\nצפייה בהסכם החתום:\n${link}\n\nAmora Studio · amora-studios.com`,
        }),
      }).catch((e) => console.error('contract: confirmation email failed', e));
    }

    console.log('contract: signed', { id: c.id });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }

  return new Response('method not allowed', { status: 405 });
});

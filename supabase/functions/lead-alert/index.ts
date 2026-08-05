// Sends the studio an alert the moment a lead arrives.
//
// Why this exists: the site promises "נחזור אליכם היום" in six places — on the
// homepage and three times in the assistant. Before this function, nothing told
// anyone a lead had come in. A couple enquiring at 22:00 on a Saturday sat
// unread until somebody happened to open admin.html, and in this market they
// have booked someone else by Sunday lunchtime. The promise was real and the
// plumbing behind it was not.
//
// Wiring: a trigger on public.leads, event INSERT, calling this function.
// Setup steps are in docs/lead-alerts.md.
//
// verify_jwt is disabled: this endpoint authenticates itself with the shared
// secret below, which the trigger sends as x-lead-alert-secret.
//
// This runs on Supabase's servers, not in the browser, so it is outside the
// site's zero-dependency rule. Nothing here is ever served to a visitor, and
// supabase/ is in .vercelignore so it is not deployed to the CDN either.

// The webhook payload Supabase sends for an INSERT.
interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  schema: string;
  record: Lead | null;
  old_record: Lead | null;
}

interface Lead {
  id: string;
  created_at: string;
  name: string;
  phone: string;
  email: string | null;
  event_date: string | null;
  date_tbd: boolean | null;
  event_type: string | null;
  area: string | null;
  coverage: string | null;
  message: string | null;
  source: string | null;
  handled: boolean;
}

const RESEND_KEY = Deno.env.get('RESEND_API_KEY');
const ALERT_TO_ENV = Deno.env.get('LEAD_ALERT_TO');
const ALERT_FROM = Deno.env.get('LEAD_ALERT_FROM') ?? 'Amora Studio <onboarding@resend.dev>';
const HOOK_SECRET = Deno.env.get('LEAD_ALERT_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// WHERE THE DESTINATION LIVES, AND WHY IT MOVED
//
// On 2026-08-05 every secret was set and no alert arrived: LEAD_ALERT_TO held
// support@regaflash.com while the Resend account belongs to
// support@amora-studios.com, and with no verified domain the shared
// onboarding@resend.dev sender may only deliver to the account owner. One
// wrong value, and the only way to change it is the Supabase dashboard --
// which means a person has to do it, which is how it sat wrong unnoticed.
//
// A destination address is configuration, not a credential. It now lives in
// private.settings, readable only through a SECURITY DEFINER function granted
// to service_role, and it changes with one UPDATE.
//
// Precedence is explicit: the database row wins, the env var is the fallback.
// The success response says which source was used, so nobody has to guess
// which of the two is live -- the failure mode being fixed here was precisely
// two settings disagreeing with nothing to say which one won.
let cachedTo: string | null = null;

async function alertTo(): Promise<{ to: string | null; source: string }> {
  if (cachedTo) return { to: cachedTo, source: 'private.settings (cached)' };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/lead_alert_to`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    if (res.ok) {
      const v = await res.json();
      if (typeof v === 'string' && v.includes('@')) {
        cachedTo = v;
        return { to: v, source: 'private.settings' };
      }
    } else {
      console.error('lead-alert: destination lookup http', { status: res.status });
    }
  } catch (e) {
    console.error('lead-alert: destination lookup threw', String(e));
  }
  // Falling back is not silent: the source travels in the response.
  return { to: ALERT_TO_ENV ?? null, source: 'LEAD_ALERT_TO env (fallback)' };
}

// The lead fields are typed by a stranger — anyone on the internet can submit
// the form. This is an email, so the risk is HTML injection into the studio's
// own inbox rather than XSS on the site, but the answer is the same: escape.
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Right-to-left and bidi-override characters can make a phone number or a name
// display as something other than what is stored. Strip the overrides.
function stripBidi(v: unknown): string {
  return String(v ?? '').replace(/[‪-‮⁦-⁩‎‏]/g, '');
}

const label = (v: string | null, fallback = '—') => (v && v.trim() ? stripBidi(v) : fallback);

function buildEmail(lead: Lead) {
  const name = label(lead.name);
  const phone = label(lead.phone);
  // E.164 for a tel: link that dials from any SIM, matching the site's own links.
  const digits = phone.replace(/[^\d+]/g, '');
  const intl = digits.startsWith('+') ? digits
             : digits.startsWith('0') ? '+972' + digits.slice(1)
             : digits;

  // A blank date and "we haven't picked one yet" are different sales
  // conversations, so say which one this is rather than showing the same dash
  // for both. date_tbd is the checkbox the couple actually ticked.
  const when = lead.event_date
    ? label(lead.event_date)
    : lead.date_tbd ? 'עוד לא קבעו תאריך' : 'לא נמסר';

  const rows: Array<[string, string]> = [
    ['טלפון', phone],
    ['אימייל', label(lead.email, '(לא נמסר)')],
    ['תאריך האירוע', when],
    ['סוג האירוע', label(lead.event_type)],
    ['אזור', label(lead.area)],
    ['מה מצלמים', label(lead.coverage)],
    ['הודעה', label(lead.message, '(ללא)')],
    ['הגיעו מ', label(lead.source)],
  ];

  const subject = `פנייה חדשה: ${name} · ${phone}`;

  const text = [
    `פנייה חדשה מהאתר`,
    ``,
    `שם: ${name}`,
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ``,
    `וואטסאפ: https://wa.me/${intl.replace('+', '')}`,
    `חיוג: ${intl}`,
    ``,
    `התקבלה: ${lead.created_at}`,
    `מזהה: ${lead.id}`,
  ].join('\n');

  const html = `
<div dir="rtl" style="font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;max-width:520px;color:#1C1A18">
  <p style="font-size:12px;letter-spacing:.14em;color:#8A7A68;margin:0 0 6px">פנייה חדשה מהאתר</p>
  <h1 style="font-size:22px;margin:0 0 4px">${esc(name)}</h1>
  <p style="margin:0 0 18px">
    <a href="tel:${esc(intl)}" style="color:#1C1A18;font-size:18px;text-decoration:none">${esc(phone)}</a>
  </p>
  <table role="presentation" style="border-collapse:collapse;width:100%;font-size:14px">
    ${rows.slice(1).map(([k, v]) => `
    <tr>
      <td style="padding:7px 0;color:#8A7A68;white-space:nowrap;vertical-align:top">${esc(k)}</td>
      <td style="padding:7px 0 7px 14px">${esc(v)}</td>
    </tr>`).join('')}
  </table>
  <p style="margin:22px 0 0">
    <a href="https://wa.me/${esc(intl.replace('+', ''))}"
       style="display:inline-block;background:#1C1A18;color:#FFFDF9;padding:12px 22px;text-decoration:none;font-size:14px">
      לענות בוואטסאפ
    </a>${lead.email ? `
    <a href="mailto:${esc(stripBidi(lead.email).split('?')[0])}?subject=${encodeURIComponent('Amora Studio — בדיקת זמינות')}"
       style="display:inline-block;border:1px solid #1C1A18;color:#1C1A18;padding:11px 22px;text-decoration:none;font-size:14px;margin-inline-start:8px">
      לענות במייל
    </a>` : ''}
  </p>
  <p style="font-size:12px;color:#8A7A68;margin:22px 0 0">
    התקבלה ${esc(lead.created_at)} · ${esc(lead.id)}
  </p>
</div>`.trim();

  return { subject, text, html };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  // The trigger sends a shared secret as a header. If one is configured,
  // require it — otherwise the function URL alone would let anyone send the
  // studio arbitrary email.
  if (HOOK_SECRET) {
    const got = req.headers.get('x-lead-alert-secret');
    if (got !== HOOK_SECRET) return new Response('forbidden', { status: 403 });
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response('bad json', { status: 400 });
  }

  if (payload.type !== 'INSERT' || !payload.record) {
    // Not an insert: acknowledge so Supabase does not retry forever.
    return new Response(JSON.stringify({ skipped: payload.type }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }

  const dest = await alertTo();

  if (!RESEND_KEY || !dest.to) {
    // Fail loudly in the logs rather than silently swallowing a lead alert —
    // a misconfigured alert that returns 200 is worse than none, because
    // nobody ever finds out.
    console.error('lead-alert: RESEND_API_KEY or a destination is not set; no alert sent',
                  { leadId: payload.record.id, source: dest.source });
    return new Response(JSON.stringify({
      error: 'alert not configured',
      missing: [!RESEND_KEY && 'RESEND_API_KEY', !dest.to && "destination (private.settings 'lead_alert_to')"].filter(Boolean),
    }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
  const ALERT_TO = dest.to;

  const mail = buildEmail(payload.record);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${RESEND_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: ALERT_FROM,
      to: [ALERT_TO],
      reply_to: ALERT_TO,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    // Non-2xx rather than a swallowed 200, so the failure is visible: it lands
    // in net._http_response with this status and in the function logs below.
    // Be clear about what it does NOT do — the trigger calls pg_net, which
    // fires once and does not retry. A transient provider outage costs this
    // one alert. The lead itself is already committed and shows in the CRM.
    console.error('lead-alert: provider rejected the send', {
      status: res.status, detail: detail.slice(0, 300), leadId: payload.record.id,
    });
    // The provider's own words travel back in the body, not only to a log.
    // This function returned a bare "send failed" the first time it was tested
    // end to end, and the reason -- which turned out to be a specific, fixable
    // Resend restriction -- was sitting in a log stream that the platform's
    // log API does not return. An error that cannot be read is an error that
    // gets guessed at. The caller here is a database trigger, so this text
    // lands in net._http_response and nowhere public.
    return new Response(JSON.stringify({
      error: 'send failed',
      provider_status: res.status,
      provider: detail.slice(0, 400),
      to_source: dest.source,
    }), { status: 502, headers: { 'content-type': 'application/json' } });
  }

  console.log('lead-alert: sent', { leadId: payload.record.id, source: dest.source });
  return new Response(JSON.stringify({ sent: true, to_source: dest.source }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
});

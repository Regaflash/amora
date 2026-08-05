// Receives Google Ads lead-form webhooks and writes them into public.leads.
//
// Google Ads lead form assets deliver each submission as a POST to a webhook
// URL, carrying a shared key the advertiser sets when configuring the asset.
// That is this endpoint. There is no Google account linkage, no OAuth and no
// polling — Google pushes, we verify the key, we insert.
//
// Owner setup (also in docs/crm-workflow.md):
//   Google Ads → Assets → Lead form → Lead delivery option → Webhook
//     URL:  https://dkejuaildigikufrdiru.supabase.co/functions/v1/lead-intake-google
//     Key:  select value from private.settings where key = 'google_lead_webhook_key';
//   Then "Send test data" in that screen must show a green check, and the test
//   row must appear in admin.html (its message is prefixed [בדיקת מערכת]).
//
// verify_jwt is disabled: Google cannot send a Supabase JWT. The shared key
// inside the payload is the authentication, same pattern as lead-alert.
//
// The insert goes through PostgREST with the service role key (auto-injected
// env), because anon INSERT is column-scoped and deliberately cannot set
// external_id/campaign/status. on_conflict=external_id makes retries by
// Google (they retry non-200s) idempotent.

interface GoogleColumn {
  column_name?: string;
  string_value?: string;
  column_id?: string;
}

interface GoogleLeadPayload {
  lead_id?: string;
  api_version?: string;
  form_id?: number | string;
  campaign_id?: number | string;
  adgroup_id?: number | string;
  creative_id?: number | string;
  gcl_id?: string;
  google_key?: string;
  is_test?: boolean;
  user_column_data?: GoogleColumn[];
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Bidi overrides can make a stored phone number display as a different one.
function stripBidi(v: unknown): string {
  return String(v ?? '').replace(/[‪-‮⁦-⁩‎‏؜]/g, '');
}

function clamp(v: string, max: number): string {
  return v.length > max ? v.slice(0, max) : v;
}

async function rest(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('apikey', SERVICE_KEY);
  headers.set('authorization', `Bearer ${SERVICE_KEY}`);
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, { ...init, headers });
}

async function expectedKey(): Promise<string | null> {
  // The key is born in docs/supabase-crm-pipeline.sql, in private.settings.
  // PostgREST serves only the public schema, so it is read through the
  // service-role-only RPC public.google_lead_webhook_key(). An env var
  // GOOGLE_LEAD_KEY, if the owner ever sets one, wins — same override
  // convention as lead-alert's LEAD_ALERT_FROM.
  const fromEnv = Deno.env.get('GOOGLE_LEAD_KEY');
  if (fromEnv) return fromEnv;

  const res = await rest('/rpc/google_lead_webhook_key', {
    method: 'POST',
    body: '{}',
    headers: { 'content-type': 'application/json' },
  });
  if (!res.ok) return null;
  const value = await res.json().catch(() => null);
  return typeof value === 'string' && value ? value : null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  let payload: GoogleLeadPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response('bad json', { status: 400 });
  }

  const key = await expectedKey();
  if (!key) {
    // Same philosophy as lead-alert: a webhook that cannot authenticate its
    // caller must refuse loudly, not accept quietly.
    console.error('lead-intake-google: no webhook key configured');
    return new Response('not configured', { status: 500 });
  }
  if (payload.google_key !== key) {
    return new Response('forbidden', { status: 403 });
  }

  // Map Google's column list onto the leads schema. Column IDs are stable
  // upper-snake identifiers for the standard questions; custom questions come
  // through with their text as column_name.
  let name = '', phone = '', email = '';
  const extras: string[] = [];
  for (const col of payload.user_column_data ?? []) {
    const id = String(col.column_id ?? '').toUpperCase();
    const val = stripBidi(col.string_value ?? '').trim();
    if (!val) continue;
    if (id === 'FULL_NAME' || id === 'FIRST_NAME') name = name ? `${name} ${val}` : val;
    else if (id === 'LAST_NAME') name = name ? `${name} ${val}` : val;
    else if (id === 'PHONE_NUMBER') phone = val;
    else if (id === 'EMAIL') email = val;
    else extras.push(`${stripBidi(col.column_name ?? id)}: ${val}`);
  }

  if (!name) name = 'ליד מגוגל (ללא שם)';
  if (!phone) {
    // The leads table requires a phone. A lead form without the phone question
    // should not exist for this studio; refuse so the misconfiguration is
    // visible in Google's delivery dashboard instead of silently dropped.
    console.error('lead-intake-google: payload had no PHONE_NUMBER column', {
      leadId: payload.lead_id ?? null,
    });
    return new Response('missing phone', { status: 422 });
  }

  const messageParts = [...extras];
  if (payload.is_test) messageParts.unshift('[בדיקת מערכת — ליד ניסיון מגוגל, לא לקוח אמיתי]');
  if (payload.gcl_id) messageParts.push(`gclid: ${payload.gcl_id}`);

  const row = {
    name: clamp(name, 120),
    phone: clamp(phone, 20),
    email: email ? clamp(email, 254) : null,
    message: messageParts.length ? clamp(messageParts.join('\n'), 2000) : null,
    source: 'google-ads',
    campaign: payload.campaign_id ? clamp(`campaign ${payload.campaign_id}`, 300) : null,
    external_id: payload.lead_id ? clamp(`gads:${payload.lead_id}`, 120) : null,
    status: 'new',
  };

  const res = await rest('/leads?on_conflict=external_id', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      prefer: 'resolution=ignore-duplicates,return=representation',
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error('lead-intake-google: insert failed', {
      status: res.status, detail: detail.slice(0, 300), leadId: payload.lead_id ?? null,
    });
    // Non-200 so Google retries — a transient DB hiccup must not eat a lead.
    return new Response('insert failed', { status: 502 });
  }

  const inserted = await res.json().catch(() => []);
  const leadRow = Array.isArray(inserted) && inserted[0] ? inserted[0] : null;

  if (leadRow) {
    // Timeline entry. Best effort: a failed event must not fail the lead.
    await rest('/lead_events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', prefer: 'return=minimal' },
      body: JSON.stringify({
        lead_id: leadRow.id,
        type: 'created',
        detail: payload.is_test ? 'ליד בדיקה מטופס לידים של Google Ads' : 'התקבל מטופס לידים של Google Ads',
      }),
    }).catch(() => {});
    console.log('lead-intake-google: inserted', { leadId: leadRow.id, test: !!payload.is_test });
  } else {
    console.log('lead-intake-google: duplicate ignored', { externalId: row.external_id });
  }

  return new Response(JSON.stringify({}), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
});

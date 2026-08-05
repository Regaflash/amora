// Reports lead progress back to Meta, so the ad platform learns which ads
// bring couples who actually book.
//
// Meta already knows a lead was submitted. What it cannot see is what happened
// next -- whether the phone number was fake, whether anyone answered, whether
// an offer went out, whether a deposit was paid. Without that, its optimiser
// treats every submitted form as equally good and keeps buying more of
// whatever is cheapest, which is usually the worst traffic.
//
// WHY THIS IS A FUNCTION AND NOT AN HTTP MODULE IN MAKE
//
// The plan in docs/meta-capi-flow.md originally called for an HTTP module
// pasted into each of the status scenarios. That would have put the CAPI
// access token into a Make blueprint -- five copies of a live credential in a
// document that gets fetched, edited and written back wholesale by tooling
// that has already destroyed one module in this account. The token belongs in
// Supabase Secrets, so the call belongs here. Make sends a lead id and a
// status; the token, the validation and the mapping table never leave this
// file.
//
// verify_jwt is off: the caller is Make, which authenticates with the shared
// secret in x-amora-capi-secret.
//
// TWO CREDENTIALS, TWO HOMES
//
// META_CAPI_TOKEN is a Meta platform credential with real reach, so it lives in
// Supabase Secrets and appears in no table and no blueprint. The hook secret is
// a low-privilege shared value Make must also hold -- it can cause a lead-status
// event to be posted for this one dataset and nothing else -- so it lives in
// private.settings, reachable only through a SECURITY DEFINER function granted
// to service_role. That means it can be generated inside the database and
// rotated with one statement, instead of being carried through a chat window.
//
// The payload shape was verified against the live Graph API on 2026-08-05,
// not taken from documentation (which is blocked from this environment) and
// not from memory. See docs/meta-capi-flow.md for the probe and its result.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TOKEN = Deno.env.get('META_CAPI_TOKEN');
const DATASET = Deno.env.get('META_CAPI_DATASET') ?? '2851332215058775';
const GRAPH = 'https://graph.facebook.com/v21.0';

// Read once per instance. Instances are short-lived, so a rotation takes effect
// on its own within minutes without a redeploy.
//
// THREE OUTCOMES, NOT TWO. The first version of this collapsed "I could not
// reach the database" into "the secret is not set", and the very first probe
// caught it: on a cold start the lookup failed and the endpoint answered
// 500 "not configured" while the row existed and two sibling requests read it
// fine. That is the same failure this project has now made three times --
// a missing thing and a broken thing wearing the same error message. They have
// opposite fixes, so they get opposite answers: 'absent' is permanent and the
// operator must act, 'unavailable' is transient and the caller should retry.
type SecretLookup =
  | { ok: true; secret: string }
  | { ok: false; reason: 'absent' | 'unavailable' };

let cachedSecret: string | null = null;

async function readSecretOnce(): Promise<SecretLookup> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/meta_capi_hook_secret`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    if (!res.ok) {
      console.error('meta-capi: secret lookup http', { status: res.status });
      return { ok: false, reason: 'unavailable' };
    }
    const v = await res.json();
    // PostgREST returns JSON null when the row is missing. That is the only
    // signal that means "nobody has set this", and it is the only one that
    // should ever be reported as a configuration problem.
    if (v === null) return { ok: false, reason: 'absent' };
    if (typeof v !== 'string' || v.length === 0) {
      console.error('meta-capi: secret lookup shape', { got: typeof v });
      return { ok: false, reason: 'unavailable' };
    }
    return { ok: true, secret: v };
  } catch (e) {
    console.error('meta-capi: secret lookup threw', String(e));
    return { ok: false, reason: 'unavailable' };
  }
}

async function hookSecret(): Promise<SecretLookup> {
  if (cachedSecret) return { ok: true, secret: cachedSecret };
  let out = await readSecretOnce();
  // One retry, because the observed failure was a cold-start blip and a second
  // attempt 250ms later costs nothing next to a dropped conversion event.
  if (!out.ok && out.reason === 'unavailable') {
    await new Promise((r) => setTimeout(r, 250));
    out = await readSecretOnce();
  }
  if (out.ok) cachedSecret = out.secret;
  return out;
}

// The mapping table from docs/meta-capi-flow.md, in the one place that acts on
// it. Fourteen Origami statuses, five of which are worth telling Meta about.
//
// Everything absent from this map is deliberate, not forgotten:
//   "ליד חדש"            Meta already knows; sending it back is double counting
//   "אין מענה 1"         too early -- many of these answer on the second try
//   "שליחת הצעת מחיר"    internal step, subsumed by "נשלחה הצעה"
//   "פולואפ", "פולואפ הצעת מחיר", "נשלח פולואפ הצעה"
//                        chasing, not a change of stage
//   "נחתם", "שולם"       a booked couple passes through
//                        שולמה מקדמה → נחתם → שולם. Sending a conversion at
//                        each one reports three bookings for one wedding and
//                        teaches the optimiser the campaign is 3x better than
//                        it is. The conversion fires once, at the deposit --
//                        the first point real money moves, and a point every
//                        genuine booking passes through.
const STAGES: Record<string, { stage: string; event: string }> = {
  'אין מענה 2': { stage: 'rejected', event: 'LeadDisqualified' },
  'טלפון שגוי': { stage: 'rejected', event: 'LeadDisqualified' },
  'לא רלוונטי': { stage: 'rejected', event: 'LeadDisqualified' },
  'תואמה שיחה': { stage: 'contacted', event: 'LeadContacted' },
  'נשלחה הצעה': { stage: 'quoted', event: 'LeadQualified' },
  'שולמה מקדמה': { stage: 'converted', event: 'LeadConverted' },
};

const JSON_HEADERS = { 'content-type': 'application/json' };

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

// Meta issues these ids and rejects malformed ones with a batch-level error,
// so one bad value can take down everything sent with it. That is also why
// this function sends exactly one event per request and never batches.
//
// The error text Meta returns says "15 or 17 digits", but real ids in this
// account are 16 and 17 digits long. Coding to the message rather than to the
// observed data would have rejected live leads, so the check is a digit string
// of plausible length and nothing cleverer.
function validLeadId(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9]{15,18}$/.test(v);
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return reply(405, { error: 'method not allowed' });

  // Refuse to run half-configured rather than appearing to work. The lead
  // alert pipeline sat "deployed" for months while answering 500 because a
  // secret was missing, and the difference between that and working was
  // invisible from the repo. Say which piece is absent.
  const look = await hookSecret();

  if (!look.ok && look.reason === 'unavailable') {
    // 503, not 500, and Retry-After: this is the database being briefly out of
    // reach, not a broken deployment. Make retries a 503 instead of counting it
    // against maxErrors and eventually switching the scenario off.
    return new Response(JSON.stringify({ error: 'secret store unavailable', retry: true }), {
      status: 503,
      headers: { ...JSON_HEADERS, 'retry-after': '5' },
    });
  }

  if (!TOKEN || !look.ok) {
    console.error('meta-capi: not configured', { token: !!TOKEN, secret: look.ok });
    return reply(500, {
      error: 'not configured',
      missing: [
        !TOKEN && 'META_CAPI_TOKEN (Supabase Secrets)',
        !look.ok && "private.settings key 'meta_capi_hook_secret'",
      ].filter(Boolean),
    });
  }

  if (req.headers.get('x-amora-capi-secret') !== look.secret) {
    return reply(401, { error: 'unauthorized' });
  }

  let body: { lead_id?: unknown; status?: unknown; test?: unknown };
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'bad json' });
  }

  const status = typeof body.status === 'string' ? body.status.trim() : '';
  const mapped = STAGES[status];

  // Not an error. Most status changes are internal and must not reach Meta;
  // a scenario wired to this endpoint for a status that does not map should
  // get a clean 200 and a reason, not a failure that trips Make's error count.
  if (!mapped) {
    return reply(200, { skipped: true, reason: 'status not mapped', status });
  }

  const leadId = body.lead_id;
  if (!validLeadId(leadId)) {
    // Also not an error: leads from the website, from WhatsApp, or from before
    // fld_1519 existed simply have no Meta id. There is nothing to report and
    // nothing wrong.
    return reply(200, { skipped: true, reason: 'no usable meta lead id', status });
  }

  const payload = {
    data: [{
      event_name: mapped.event,
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'system_generated',
      // Deduplication. A lead that reaches the same stage twice -- a scenario
      // retried, a status set back and forward, an operator double-clicking --
      // must count once. Meta dedupes on event_id, so the id is derived from
      // the lead and the stage and carries no timestamp.
      event_id: `${leadId}:${mapped.stage}`,
      user_data: { lead_id: Number(leadId) },
      custom_data: { lead_event_source: 'Origami', event_source: 'crm' },
    }],
    ...(body.test ? { test_event_code: String(body.test) } : {}),
  };

  let res: Response;
  try {
    res = await fetch(`${GRAPH}/${DATASET}/events?access_token=${TOKEN}`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('meta-capi: network', String(e));
    return reply(502, { error: 'graph unreachable' });
  }

  const text = await res.text();

  if (!res.ok) {
    // Relay Meta's own words. A generic failure here would be indistinguishable
    // between a revoked token, a malformed id and a wrong event name -- three
    // problems with three different fixes.
    console.error('meta-capi: graph rejected', { status: res.status, body: text.slice(0, 400) });
    return reply(502, { error: 'graph rejected', http: res.status, graph: text.slice(0, 400) });
  }

  console.log('meta-capi: sent', { stage: mapped.stage, event: mapped.event, lead: leadId });
  return reply(200, { sent: true, stage: mapped.stage, event: mapped.event, graph: text.slice(0, 200) });
});

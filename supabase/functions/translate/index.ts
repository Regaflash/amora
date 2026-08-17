// Translates the page a visitor is looking at, and remembers every string.
//
// The client sends the visible strings of one page, each with a sha256 of its
// whitespace-normalised source. Anything already in public.translations comes
// straight back; only the misses reach a model, in one batched call. The
// result is written to the cache, so the second visitor to that page pays a
// database lookup instead of a model call.
//
// The cache is keyed by string, not by page. Navigation, footer and button
// copy repeat across the site, so after the first page view most of the next
// page is already warm.
//
// verify_jwt is off: the caller is an anonymous visitor. The protections are:
//   - a size ceiling (MAX_ITEMS / MAX_CHARS);
//   - the cache key is DERIVED FROM THE SOURCE ON THE SERVER, so the caller's
//     `h` is never trusted — it cannot inject into the query below, and it
//     cannot poison another string's cache entry;
//   - CORS is locked to the studio's own origins, so a hostile third-party page
//     cannot drive this endpoint from its visitors' browsers;
//   - a global per-minute model-spend ceiling (translate_take), so no burst can
//     run the paid model without bound;
//   - the endpoint can only ever write to one table.
//
// Model choice was measured, not assumed. Listing both providers' catalogues
// with the project's own keys showed Cerebras serves gpt-oss-120b, gemma-4-31b
// and zai-glm-4.7 -- it has no llama-3.3-70b -- and that Gemini needs an
// explicit responseSchema before it will reliably return a bare JSON array.
//
// Rules from docs/translation-flow.md enforced here:
//   - Hebrew is the source of truth; on failure the client keeps the Hebrew.
//   - "Amora Studio", numbers, phone numbers and URLs are preserved verbatim.
//   - The model must return exactly as many items as it was given, in order.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY');
const CEREBRAS_KEY = Deno.env.get('CEREBRAS_API_KEY');

const LANGS: Record<string, string> = { en: 'English', ru: 'Russian', ar: 'Arabic' };

// Ceilings. A page far past these is a bug or an attack, not a visitor.
const MAX_ITEMS = 240;
const MAX_CHARS = 16000;

// Per-IP rate limit, in memory. Instances are short-lived and x-forwarded-for's
// left-most value is caller-supplied, so this is a speed bump, not the wall --
// the wall is the global model-spend ceiling (translate_take) and the CORS lock.
const hits = new Map<string, { n: number; until: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now > rec.until) {
    hits.set(ip, { n: 1, until: now + 60_000 });
    return false;
  }
  rec.n += 1;
  return rec.n > 30;
}

// The client normalises whitespace before hashing (i18n.js `norm`); we repeat it
// so the hash we derive equals the hash the client sent for honest traffic, and
// the warm cache (keyed by sha256 of the normalised Hebrew) still hits. `norm`
// is idempotent, so it is safe whether the client sent raw or normalised text.
function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// CORS is locked to the studio's own origins. `*` let any page on the internet
// drive this endpoint from its visitors' real IPs -- the one vector that
// defeats a per-IP limit. The Origin is echoed only when it is on the list.
const ALLOW_ORIGINS = new Set([
  'https://www.amora-studios.com',
  'https://amora-studios.com',
]);
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allow = ALLOW_ORIGINS.has(origin) ? origin : 'https://www.amora-studios.com';
  return {
    'access-control-allow-origin': allow,
    'vary': 'Origin',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
}

async function rest(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('apikey', SERVICE_KEY);
  headers.set('authorization', `Bearer ${SERVICE_KEY}`);
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, { ...init, headers });
}

// Global model-spend ceiling. translate_take(n) atomically adds n to the
// current minute's counter and returns whether the running total is still under
// the cap. Fail-OPEN: a meter outage must never break translation for real
// visitors -- it is a cost brake, not a security control.
async function modelBudgetOk(n: number): Promise<boolean> {
  try {
    const r = await rest('/rpc/translate_take', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ n }),
    });
    if (!r.ok) return true;
    const v = await r.json().catch(() => true);
    return v !== false;
  } catch {
    return true;
  }
}

function prompt(lang: string, items: string[]): string {
  return [
    'You are translating the website of Amora Studio, an Israeli wedding',
    `photography and videography studio, from Hebrew into ${lang}.`,
    '',
    'Rules:',
    `1. Return a JSON array of exactly ${items.length} strings, in the same order as the input.`,
    '2. Never merge, split, drop or reorder items. Item N in, item N out.',
    '3. Keep "Amora Studio" exactly as written. Never translate or transliterate it.',
    '4. Keep every number, date, duration and phone number exactly as written.',
    '5. Keep URLs, e-mail addresses and file names unchanged.',
    '6. Preserve the leading and trailing whitespace of each item.',
    '7. This is marketing copy for couples planning a wedding. Translate for a',
    '   warm, understated, premium tone -- not word for word, but never adding a',
    '   claim that is not in the source.',
    '8. If an item is a single symbol or digit, or is untranslatable, return it unchanged.',
    '',
    'Input:',
    JSON.stringify(items),
  ].join('\n');
}

function parseArray(raw: string, n: number): string[] | null {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const arr = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(arr) || arr.length !== n) return null;
    if (!arr.every((v) => typeof v === 'string')) return null;
    return arr;
  } catch {
    return null;
  }
}

async function viaGemini(lang: string, items: string[], note: string[]): Promise<string[] | null> {
  if (!GEMINI_KEY) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt(lang, items) }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
            responseSchema: { type: 'ARRAY', items: { type: 'STRING' } },
          },
        }),
      },
    );
    const body = await res.text();
    if (!res.ok) {
      note.push(`gemini ${res.status}: ${body.slice(0, 160)}`);
      return null;
    }
    const j = JSON.parse(body);
    const text = j?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') {
      note.push(`gemini shape: ${body.slice(0, 160)}`);
      return null;
    }
    const out = parseArray(text, items.length);
    if (!out) note.push(`gemini count: wanted ${items.length}`);
    return out;
  } catch (e) {
    note.push(`gemini threw: ${String(e).slice(0, 120)}`);
    return null;
  }
}

async function viaCerebras(lang: string, items: string[], note: string[]): Promise<string[] | null> {
  if (!CEREBRAS_KEY) return null;
  try {
    const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${CEREBRAS_KEY}` },
      body: JSON.stringify({
        model: 'gpt-oss-120b',
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt(lang, items) }],
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      note.push(`cerebras ${res.status}: ${body.slice(0, 160)}`);
      return null;
    }
    const text = JSON.parse(body)?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') {
      note.push('cerebras shape');
      return null;
    }
    const out = parseArray(text, items.length);
    if (!out) note.push(`cerebras count: wanted ${items.length}`);
    return out;
  } catch (e) {
    note.push(`cerebras threw: ${String(e).slice(0, 120)}`);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  const jsonHeaders = { ...cors, 'content-type': 'application/json' };

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405, headers: cors });
  }

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) {
    return new Response(JSON.stringify({ error: 'rate limited' }), { status: 429, headers: jsonHeaders });
  }

  let payload: { lang?: string; items?: Array<{ h?: string; s?: string }> };
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'bad json' }), { status: 400, headers: jsonHeaders });
  }

  const lang = String(payload.lang ?? '');
  if (!LANGS[lang]) {
    return new Response(JSON.stringify({ error: 'unsupported lang' }), { status: 400, headers: jsonHeaders });
  }

  const raw = (payload.items ?? []).filter(
    (i) => typeof i?.s === 'string',
  ).slice(0, MAX_ITEMS) as Array<{ s: string }>;

  let budget = 0;
  const capped: Array<{ s: string }> = [];
  for (const it of raw) {
    if (budget + it.s.length > MAX_CHARS) break;
    budget += it.s.length;
    capped.push(it);
  }
  if (!capped.length) {
    return new Response(JSON.stringify({ t: {}, cached: 0, fresh: 0 }), { headers: jsonHeaders });
  }

  // 1 - cache lookup. The key is derived from the source here, never taken from
  //     the caller: `h` is advisory. This kills two attacks at once -- PostgREST
  //     filter injection through `h` into the service-role query below, and
  //     cache poisoning by seeding a real string's key with a bogus target.
  const out: Record<string, string> = {};
  const uniq = new Map<string, string>();          // derived hex hash -> normalised source
  for (const it of capped) {
    const src = norm(it.s);
    uniq.set(await sha256Hex(src), src);
  }
  const hashes = [...uniq.keys()];                  // every entry is [0-9a-f]{64}

  const hit = await rest(
    `/translations?select=hash,target&lang=eq.${lang}&hash=in.(${hashes.map((h) => `"${h}"`).join(',')})`,
    { method: 'GET' },
  );
  if (hit.ok) {
    const rows = await hit.json().catch(() => []);
    if (Array.isArray(rows)) for (const r of rows) out[r.hash] = r.target;
  } else {
    console.error('translate: cache read failed', { status: hit.status });
  }

  const missing = hashes.filter((h) => !(h in out));
  if (!missing.length) {
    return new Response(JSON.stringify({ t: out, cached: hashes.length, fresh: 0 }), { headers: jsonHeaders });
  }

  // Cost circuit-breaker: a global ceiling on fresh items per minute. During an
  // abusive burst the model is skipped and cold strings simply stay Hebrew; the
  // warm cache still serves everyone. Fail-open (see modelBudgetOk).
  if (!(await modelBudgetOk(missing.length))) {
    console.warn('translate: model budget exceeded, serving cache only', { lang, skipped: missing.length });
    return new Response(
      JSON.stringify({ t: out, cached: hashes.length - missing.length, fresh: 0 }),
      { headers: jsonHeaders },
    );
  }

  // 2 - one batched model call for the misses
  const note: string[] = [];
  const sources = missing.map((h) => uniq.get(h)!);
  let model = 'gemini-2.5-flash';
  let translated = await viaGemini(LANGS[lang], sources, note);
  if (!translated) {
    model = 'cerebras/gpt-oss-120b';
    translated = await viaCerebras(LANGS[lang], sources, note);
  }

  if (!translated) {
    // Every provider failed. Return the hits we have; the client leaves the
    // rest in Hebrew. A partly translated page beats a broken one. The reason
    // is logged, but NOT reflected to the anonymous caller -- upstream error
    // bodies are ours to read, not to hand back to the internet.
    console.error('translate: all providers failed', { lang, missing: missing.length, note });
    return new Response(
      JSON.stringify({ t: out, cached: hashes.length - missing.length, fresh: 0 }),
      { headers: jsonHeaders },
    );
  }

  // 3 - write through. Best effort: a failed insert must not cost the visitor
  //     their translation, only the next visitor's speed.
  const rows = missing.map((h, i) => ({
    hash: h, lang, source: uniq.get(h)!, target: translated![i], model,
  }));
  for (const r of rows) out[r.hash] = r.target;

  await rest('/translations?on_conflict=hash,lang', {
    method: 'POST',
    headers: { 'content-type': 'application/json', prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  }).catch((e) => console.error('translate: cache write failed', e));

  console.log('translate: done', { lang, cached: hashes.length - missing.length, fresh: missing.length, model });
  return new Response(
    JSON.stringify({ t: out, cached: hashes.length - missing.length, fresh: missing.length }),
    { headers: jsonHeaders },
  );
});

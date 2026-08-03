#!/usr/bin/env bash
# Pre-deploy consistency checks. Exits non-zero if anything looks wrong.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
fail=0
say() { printf '%-46s %s\n' "$1" "$2"; }

# The page list was written out by hand in six places. A seventh page therefore
# shipped with no asset check, no CSP-hash check, no id-reference check and no
# [[OWNER: check -- silently, with every existing check still green. Derive it
# once from what is actually on disk instead.
PAGES=$(ls -1 *.html | sort)

# every src/srcset target actually exists
missing=$(grep -oE '(src|srcset)="[^"]*"' $PAGES 2>/dev/null \
  | sed 's/.*="//;s/"$//' | tr ',' '\n' | sed 's/ [0-9]*w$//' | tr -d ' ' \
  | grep -E '^assets/' | sort -u | while read -r f; do [ -f "$f" ] || echo "$f"; done)
if [ -n "$missing" ]; then say "קבצים חסרים" "✗"; echo "$missing" | sed 's/^/    /'; fail=1; else say "כל הנכסים קיימים" "✓"; fi

# no WebP heavier than its JPEG sibling
worse=$(for f in assets/img/*.webp; do j="${f%.webp}.jpg"; [ -f "$j" ] || continue
  [ "$(stat -c%s "$f")" -ge "$(stat -c%s "$j")" ] && basename "$f"; done)
if [ -n "$worse" ]; then say "WebP כבד מ-JPEG" "✗"; echo "$worse" | sed 's/^/    /'; fail=1; else say "כל WebP קטן מה-JPEG" "✓"; fi

# the placeholder must be gone before launch
if grep -rq 'SITE_URL' index.html robots.txt sitemap.xml 2>/dev/null; then
  say "SITE_URL עדיין placeholder" "✗ הרץ tools/set-site-url.sh"; fail=1
else say "SITE_URL הוגדר" "✓"; fi

# one phone number, one format
fmts=$(grep -oE '05[0-9]-?3662699|9725[0-9]{8}' index.html | sed 's/[0-9]//g' | sort -u | wc -l)
say "פורמטי טלפון בשימוש" "$fmts"

# JSON-LD must parse
python3 - <<'PY' || fail=1
import json, re, sys
blocks = []
import glob as _g
for _f in sorted(_g.glob('*.html')):        # derived, not hand-listed
    _s = open(_f, encoding='utf-8').read()
    for _b in re.findall(r'<script type="application/ld\+json">(.*?)</script>', _s, re.S):
        blocks.append((_f, _b))
for _f, _b in blocks:
    try: json.loads(_b)
    except Exception as e: print(f'    JSON-LD שבור ב-{_f}: {e}'); sys.exit(1)
print(f'{"JSON-LD תקין":<46} ✓ ({len(blocks)} בלוקים)')
PY

# no external runtime dependency crept back in
ext=$(grep -oE 'https://(fonts\.googleapis|fonts\.gstatic|unpkg|cdn\.jsdelivr)\.(com|net)' $PAGES 2>/dev/null | sort -u)
if [ -n "$ext" ]; then say "תלות חיצונית חזרה" "✗"; echo "$ext" | sed 's/^/    /'; fail=1; else say "אין תלויות חיצוניות בזמן ריצה" "✓"; fi

# a service key or private token must never reach anything the browser loads
secrets=$(grep -lE 'service_role[\"'"'"']*[[:space:]]*[:=]|sb_secret_|sk-ant-' index.html admin.html assets/js/*.js 2>/dev/null)
if [ -n "$secrets" ]; then say "סוד בקוד צד-לקוח" "✗"; echo "$secrets" | sed 's/^/    /'; fail=1; else say "אין סודות בקוד צד-לקוח" "✓"; fi

# ---------------------------------------------------------------------------
# Additions below. Each one exists because this project actually shipped the
# defect once. Ordered cheapest first. Every one is deterministic: same tree,
# same answer, no network, no browser.
# ---------------------------------------------------------------------------

# The raw photo library must not be tracked. .vercelignore keeps it off the
# CDN, but a tracked 30MB of full-resolution JPEG is still cloned by everyone
# who touches the repo, and one edit to .vercelignore turns it into a public
# archive of the studio's work. Working copies stay on disk — tools/*.mjs read
# them — so this asks git, not the filesystem.
if git rev-parse --git-dir >/dev/null 2>&1; then
  tracked=$(git ls-files -- ':(top,glob)*.jpg' ':(top,glob)*.jpeg' ':(top,glob)*.png' ':(top,glob)*.heic' ':(top)תמונות' | wc -l)
  if [ "$tracked" -gt 0 ]; then
    say "תמונות גולמיות ב-HEAD" "✗ $tracked קבצים — git rm --cached"; fail=1
  else say "אין תמונות גולמיות ב-HEAD" "✓"; fi
fi

# Everything the pages reference by <link href> or by an absolute og:/JSON-LD
# URL on our own origin. The src/srcset scan above never looked at either, and
# that is how a favicon and an og:image can 404 with a green check.
python3 - <<'PY' || fail=1
import io, json, os, re, sys
import glob as _g; pages = sorted(_g.glob('*.html'))   # derived, not hand-listed
canon = re.search(r'<link rel="canonical" href="([^"]+)"', io.open('index.html', encoding='utf-8').read())
origin = canon.group(1).rstrip('/') if canon and 'SITE_URL' not in canon.group(1) else None
missing = []
for f in pages:
    s = io.open(f, encoding='utf-8').read()
    targets = re.findall(r'<link [^>]*href="([^"]+)"', s)
    targets += re.findall(r'<meta [^>]*(?:property|name)="(?:og:image|twitter:image)"[^>]*content="([^"]+)"', s)
    for b in re.findall(r'<script type="application/ld\+json">(.*?)</script>', s, re.S):
        try: targets += re.findall(r'"https?://[^"]+\.(?:jpg|jpeg|png|webp|ico|svg)"', b)
        except Exception: pass
    for t in targets:
        t = t.strip('"')
        if t.startswith('data:') or t.startswith('#'): continue
        if t.startswith('http'):
            if not origin or not t.startswith(origin + '/'): continue   # third-party, not ours to check
            t = t[len(origin) + 1:]
        t = t.lstrip('/').split('?')[0].split('#')[0]
        if t and not os.path.isfile(t): missing.append(f + ' → ' + t)
if missing:
    print('    ' + '\n    '.join(sorted(set(missing)))); sys.exit(1)
print(f'{"יעדי link / og:image קיימים":<46} ✓')
PY

# /favicon.ico is requested by every browser whether or not a <link> asks for
# it, and Google wants the favicon it indexes to be a multiple of 48px.
python3 - <<'PY' || fail=1
import struct, sys, os
if not os.path.isfile('favicon.ico'):
    print('    favicon.ico חסר בשורש'); sys.exit(1)
d = open('favicon.ico', 'rb').read()
res, typ, n = struct.unpack('<HHH', d[:6])
if typ != 1 or n == 0:
    print('    favicon.ico אינו ICO תקין'); sys.exit(1)
sizes = []
for i in range(n):
    w, h = d[6 + i*16], d[7 + i*16]
    off = struct.unpack('<I', d[18 + i*16:22 + i*16])[0]
    length = struct.unpack('<I', d[14 + i*16:18 + i*16])[0]
    if off + length > len(d):
        print('    favicon.ico קטום'); sys.exit(1)
    sizes.append(w or 256)
if not any(s % 48 == 0 for s in sizes):
    print(f'    favicon.ico: {sizes} — אף גודל אינו כפולה של 48'); sys.exit(1)
print(f'{"favicon.ico תקין":<46} ✓ ({"/".join(str(s) for s in sizes)} px)')
PY

# Every in-page reference to an id must land on one. A section rename that
# leaves the nav pointing at #services while the <section> says #service is
# invisible in review and dead on the site. HTML files only — the widget and
# the assistant build their own DOM and wire their own ids in JS.
python3 - <<'PY' || fail=1
import io, re, sys
import glob as _g; pages = sorted(_g.glob('*.html'))   # derived, not hand-listed
bad = []
for f in pages:
    s = io.open(f, encoding='utf-8').read()
    ids = set(re.findall(r'\bid="([^"]+)"', s))
    for frag in set(re.findall(r'href="#([^"]+)"', s)):
        if frag not in ids: bad.append(f'{f}: href="#{frag}"')
    for attr in ('for', 'aria-labelledby', 'aria-describedby', 'aria-controls'):
        refs = set()
        for v in re.findall(r'\b' + attr + r'="([^"]+)"', s): refs.update(v.split())
        for r in sorted(refs - ids): bad.append(f'{f}: {attr}="{r}"')
if bad:
    print('    ' + '\n    '.join(bad)); sys.exit(1)
print(f'{"כל ההפניות ל-id נפתרות":<46} ✓')
PY

# The focus ring, two ways it has already gone invisible here:
#  1. a :focus rule that kills the outline and puts nothing back;
#  2. an outline colour pointing at a custom property nobody defines any more —
#     the declaration is then invalid at computed-value time and the ring falls
#     back to currentColor, which on .hero is the text colour on top of itself.
# Not a contrast measurement. Contrast needs a browser; these two do not, and
# they are the two that shipped.
python3 - <<'PY' || fail=1
import glob, io, re, sys
css = {f: io.open(f, encoding='utf-8').read() for f in sorted(glob.glob('assets/css/*.css'))}
defined = set()
for s in css.values(): defined.update(re.findall(r'(--[A-Za-z0-9_-]+)\s*:', s))

def outlines(body):
    # every `outline:` shorthand in source order. `outline-offset` does not
    # match — the property name has to end at the colon.
    return re.findall(r'(?:^|;)\s*outline\s*:([^;}]*)', body)

rules, restored = [], set()
for f, s in css.items():
    s_nc = re.sub(r'/\*.*?\*/', '', s, flags=re.S)          # comments are not CSS
    for sel, body in re.findall(r'([^{}]+)\{([^{}]*)\}', s_nc):
        rules.append((f, sel, body))
        v = outlines(body)
        if v and not re.match(r'\s*(none|0)\b', v[-1]):
            for one in sel.split(','): restored.add(one.strip())

bad = []
for f, sel, body in rules:
    if ':focus' not in sel: continue
    v = outlines(body)
    # the LAST declaration wins, so `outline:none;outline:2px solid` is fine
    if v and re.match(r'\s*(none|0)\b', v[-1]) and not re.search(r'box-shadow\s*:(?!\s*none)', body):
        # Dropping the ring on :focus and putting it back on :focus-visible is
        # the recommended pattern, not a defect. Only complain when nothing
        # anywhere puts it back. A :focus-visible rule has no further fallback,
        # so killing the outline there is always wrong.
        parts = [p.strip() for p in sel.split(',') if p.strip()]
        covered = bool(parts) and all(
            ':focus-visible' not in p and p.replace(':focus', ':focus-visible') in restored
            for p in parts)
        if not covered:
            bad.append(f'{f}: {sel.strip()[:60]} — outline מבוטל ללא חלופה')
    for prop, val in re.findall(r'(outline[a-z-]*)\s*:([^;}]*)', body):
        for var in re.findall(r'var\(\s*(--[A-Za-z0-9_-]+)\s*(\)|,)', val):
            if var[0] not in defined and var[1] == ')':
                bad.append(f'{f}: {sel.strip()[:40]} — {prop}: var({var[0]}) לא מוגדר')
if bad:
    print('    ' + '\n    '.join(sorted(set(bad)))); sys.exit(1)
print(f'{"טבעת פוקוס לא בוטלה ולא נשברה":<46} ✓')
PY

# CSP hashes vs the inline scripts that are actually on the pages. A one-word
# edit to the inline bootstrap silently invalidates its hash; today the policy
# is Report-Only so nothing breaks visibly, which is exactly why this needs a
# machine to notice.
# Only executable inline scripts are hashed. <script type="application/ld+json">
# is a data block: HTML never prepares it as a script, so script-src never sees
# it. Verified in Chromium — an ld+json block under `script-src 'none'` raises
# no violation. Hashing those would be busywork that goes stale on every copy
# edit, and demanding a hash for them would be this file's second false alarm.
python3 - <<'PY' || fail=1
import base64, hashlib, io, json, re, sys
EXEC = {'', 'module', 'importmap', 'text/javascript', 'application/javascript',
        'speculationrules'}
cfg = json.load(io.open('vercel.json', encoding='utf-8'))
policies = []
for block in cfg.get('headers', []):
    for h in block.get('headers', []):
        if h.get('key', '').lower().startswith('content-security-policy'):
            policies.append((block.get('source', ''), h['value']))
known = set()
for _, v in policies: known.update(re.findall(r"'(sha(?:256|384|512)-[A-Za-z0-9+/=]+)'", v))
import glob as _g; pages = sorted(_g.glob('*.html'))   # derived, not hand-listed
bad, seen = [], 0
for f in pages:
    s = io.open(f, encoding='utf-8').read()
    for m in re.finditer(r'<script(?![^>]*\ssrc=)([^>]*)>(.*?)</script>', s, re.S):
        t = re.search(r'type="([^"]*)"', m.group(1))
        t = (t.group(1) if t else '').strip().lower()
        if t not in EXEC: continue
        seen += 1
        h = 'sha256-' + base64.b64encode(hashlib.sha256(m.group(2).encode()).digest()).decode()
        line = s[:m.start()].count('\n') + 1
        if h not in known: bad.append(f"{f}:{line} → '{h}'")
# admin.html carries its own enforcing policy with script-src 'self' and no
# hash slot at all. An inline script there is dead on arrival, hash or not.
adm = io.open('admin.html', encoding='utf-8').read()
for m in re.finditer(r'<script(?![^>]*\ssrc=)([^>]*)>(.*?)</script>', adm, re.S):
    t = re.search(r'type="([^"]*)"', m.group(1))
    if ((t.group(1) if t else '').strip().lower()) in EXEC:
        bad.append('admin.html: סקריפט inline תחת CSP אוכף עם script-src \'self\'')
if bad:
    print('    hash חסר ב-vercel.json:'); print('    ' + '\n    '.join(bad)); sys.exit(1)
print(f'{"CSP hashes תואמים לסקריפטים":<46} ✓ ({seen})')
PY

# The origin the browser is told to talk to must be the origin the code talks
# to. A project rename in CONFIG without the matching connect-src edit gives a
# form that fails only in production, only for real visitors.
python3 - <<'PY' || fail=1
import io, json, re, sys
cfg = json.load(io.open('vercel.json', encoding='utf-8'))
pol = ' '.join(h['value'] for b in cfg.get('headers', []) for h in b.get('headers', [])
               if h.get('key', '').lower().startswith('content-security-policy'))
bad = []
for f in ('assets/js/main.js', 'assets/js/admin.js', 'assets/js/assistant.js'):
    try: s = io.open(f, encoding='utf-8').read()
    except OSError: continue
    off = re.search(r'remoteEnabled\s*:\s*false', s)
    if off: continue                                      # never contacted
    m = re.search(r'supabaseUrl\s*:\s*[\'"]([^\'"]*)[\'"]', s)
    if not m or not m.group(1).strip(): continue          # not wired up yet
    origin = re.match(r'https?://[^/]+', m.group(1)).group(0)
    if origin not in pol: bad.append(f'{f}: {origin} חסר ב-connect-src')
if bad:
    print('    ' + '\n    '.join(bad)); sys.exit(1)
print(f'{"connect-src מכסה את Supabase":<46} ✓')
PY

# Supabase: a policy without a matching GRANT, and the privileges RLS cannot
# see. This project lost an afternoon to the first one — RLS chooses which rows
# a role may touch, but Postgres checks the table privilege first, so a policy
# with no grant behind it is never even consulted. The second is worse and
# quieter: TRUNCATE, REFERENCES and TRIGGER are not row-level operations, so no
# policy restrains them; they have to be revoked by hand. Reads the checked-in
# SQL, not the live database — it catches the file that will be pasted in.
python3 - <<'PY' || fail=1
import glob, io, re, sys
sql = ''
for f in sorted(glob.glob('docs/*.sql')): sql += io.open(f, encoding='utf-8').read() + '\n'
if not sql.strip():
    print(f'{"SQL: אין קבצים לבדיקה":<46} ·'); sys.exit(0)
sql_nc = re.sub(r'--[^\n]*', '', sql).lower()
grants = re.findall(r'grant\s+([a-z ,()a-z_]+?)\s+on\s+(?:table\s+)?([a-z_.]+)\s+to\s+([a-z_, ]+)', sql_nc)
def granted(verb, table, role):
    for g_verbs, g_table, g_roles in grants:
        if g_table.split('.')[-1] != table.split('.')[-1]: continue
        if role not in [r.strip() for r in g_roles.split(',')]: continue
        if verb in re.sub(r'\([^)]*\)', '', g_verbs) or 'all' in g_verbs: return True
    return False
bad = []
for m in re.finditer(r'create\s+policy\s+"[^"]*"\s*on\s+([a-z_.]+)\s*for\s+([a-z]+)\s*to\s+([a-z_,\s]+?)\s*(?:using|with check)', sql_nc):
    table, verb = m.group(1), m.group(2)
    for role in [r.strip() for r in m.group(3).split(',') if r.strip()]:
        if not granted(verb, table, role):
            bad.append(f'policy {verb} on {table} to {role} — אין GRANT תואם')
rls = set(re.findall(r'alter\s+table\s+([a-z_.]+)\s+enable\s+row\s+level\s+security', sql_nc))
for table in sorted(rls):
    revoked = re.findall(r'revoke\s+([a-z ,]+?)\s+on\s+(?:table\s+)?' + re.escape(table) + r'\s+from\s+([a-z_, ]+)', sql_nc)
    for priv in ('truncate', 'references', 'trigger'):
        roles = set()
        for r_privs, r_roles in revoked:
            if priv in r_privs or 'all' in r_privs:
                roles.update(r.strip() for r in r_roles.split(','))
        for role in ('anon', 'authenticated'):
            if role not in roles:
                bad.append(f'{table}: {priv} לא נשלל מ-{role} (RLS לא חל עליו)')
if bad:
    print('    ' + '\n    '.join(bad)); sys.exit(1)
print(f'{"SQL: לכל policy יש GRANT, אין הרשאה חסינת-RLS":<46} ✓')
PY

# An owner placeholder must never reach production. Every patch staged by the
# E-E-A-T pass carries an [[OWNER: …]] token precisely so this line can stop it.
# The legal drafts' [להשלים] markers are NOT checked here: those pages are
# published knowingly as drafts, behind noindex.
owner=$(grep -rl '\[\[OWNER:' $PAGES assets/css/*.css assets/js/*.js 2>/dev/null)
if [ -n "$owner" ]; then say "placeholder של הבעלים בקוד" "✗"; echo "$owner" | sed 's/^/    /'; fail=1; else say "אין placeholders של הבעלים" "✓"; fi

# sitemap.xml is the one file that silently goes wrong: nothing in the build
# reads it, so a page added or noindexed leaves it stale for months.
if python3 tools/gen-sitemap.py --check >/dev/null 2>&1; then say "sitemap.xml מעודכן" "✓"
else say "sitemap.xml לא מעודכן" "✗ הרץ tools/gen-sitemap.py"; fail=1; fi

# The ImageGallery block is derived from the gallery markup. A swapped
# photograph leaves a caption naming an image that is no longer there, which is
# worse than shipping no image markup at all.
if python3 tools/gen-image-schema.py --check >/dev/null 2>&1; then say "ImageGallery מסונכרן לגלריה" "✓"
else say "ImageGallery לא מסונכרן" "✗ הרץ tools/gen-image-schema.py"; fail=1; fi

# llms.txt closes with the claim that this check exists. It describes the site to
# assistants that quote it, so a page it never heard of is a page they will
# answer about wrongly — or not at all.
missing_llms=$(python3 - <<'PY'
import re
sm = open('sitemap.xml', encoding='utf-8').read()
try:
    llms = open('llms.txt', encoding='utf-8').read()
except FileNotFoundError:
    print('llms.txt missing'); raise SystemExit
for loc in re.findall(r'<loc>([^<]+)</loc>', sm):
    if loc not in llms:
        print(loc)
PY
)
if [ -n "$missing_llms" ]; then say "llms.txt מכסה את sitemap" "✗"; echo "$missing_llms" | sed 's/^/    /'; fail=1
else say "llms.txt מכסה את sitemap" "✓"; fi

# robots.txt now carries a policy with a legal commitment behind it: terms.html
# undertakes that this content is not used to train models, to protect the
# couples in the photographs. A crawler that finds a group naming it ignores the
# "*" group entirely, so the Disallow lines are repeated per group — and a
# careless edit that drops one silently opens /tools/ to an AI crawler while
# every other check stays green. Assert the behaviour, not the text.
python3 - <<'PY' || fail=1
from urllib.robotparser import RobotFileParser
import sys
rp = RobotFileParser(); rp.parse(open('robots.txt', encoding='utf-8').read().splitlines())
SITE = 'https://www.amora-studios.com'
CASES = [
    ('GPTBot','/',False), ('ClaudeBot','/',False), ('Google-Extended','/',False),
    ('Applebot-Extended','/',False), ('CCBot','/',False), ('Bytespider','/',False),
    ('meta-externalagent','/',False),
    ('OAI-SearchBot','/',True), ('ChatGPT-User','/',True), ('Claude-SearchBot','/',True),
    ('Claude-User','/',True), ('PerplexityBot','/',True),
    ('Googlebot','/',True), ('Googlebot','/camera-3d.html',True),
    ('OAI-SearchBot','/tools/x',False), ('OAI-SearchBot','/project/x',False),
    ('Claude-SearchBot','/docs/x',False),
    ('Googlebot','/project/x',False), ('Googlebot','/chats/x',False),
    ('Googlebot','/docs/x',False), ('Googlebot','/tools/x',False),
]
bad = [f'{a} {p} -> {rp.can_fetch(a, SITE+p)}, expected {w}'
       for a, p, w in CASES if rp.can_fetch(a, SITE + p) != w]
if bad:
    print('    ' + '\n    '.join(bad)); sys.exit(1)
if not rp.site_maps():
    print('    robots.txt לא מפנה ל-sitemap'); sys.exit(1)
print(f'{"robots.txt: אימון חסום, ציטוט מותר":<46} ✓ ({len(CASES)} מקרים)')
PY

exit $fail

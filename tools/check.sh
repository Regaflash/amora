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

# Same rule one format along, and the reason is the same inversion: <picture>
# serves the FIRST source the browser understands, so an AVIF heavier than the
# WebP beside it hands the newest browsers the biggest file. build-assets.mjs
# steps the AVIF quality down until it wins and writes NO file if it never
# does — so a losing .avif on disk means someone put it there by hand.
avifworse=$(for f in assets/img/*.avif; do [ -e "$f" ] || continue; w="${f%.avif}.webp"; [ -f "$w" ] || continue
  [ "$(stat -c%s "$f")" -ge "$(stat -c%s "$w")" ] && basename "$f"; done)
if [ -n "$avifworse" ]; then say "AVIF כבד מ-WebP" "✗"; echo "$avifworse" | sed 's/^/    /'; fail=1
else say "כל AVIF קטן מה-WebP" "✓ ($(ls assets/img/*.avif 2>/dev/null | wc -l) קבצים)"; fi

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

# The FAQ answers must stay byte-identical to the FAQPage JSON-LD.
#
# The project notes have described this as enforced by a script for a long
# time, and it is the stated reason for a standing rule — nothing may be put
# inside a .faq__a, not even a link, because it would break the lock. It was
# not enforced by anything. Eight answers, mirrored by hand into structured
# data, guarded by a sentence in a markdown file: the visible copy and the copy
# Google is served could drift apart in either direction and every check here
# would still pass. They had not drifted, which is luck, not a mechanism.
python3 - <<'PY' || fail=1
import re, json, html, sys
src = open('index.html', encoding='utf-8').read()
norm = lambda t: html.unescape(re.sub(r'\s+', ' ', t)).strip()
seen = [norm(a) for a in re.findall(r'<p class="faq__a">(.*?)</p>', src, re.S)]
faq = None
for b in re.findall(r'<script type="application/ld\+json">(.*?)</script>', src, re.S):
    d = json.loads(b)
    for node in (d if isinstance(d, list) else [d]):
        if node.get('@type') == 'FAQPage':
            faq = node
if faq is None:
    print(f'{"FAQ נעול ל-JSON-LD":<46} ✗ אין בלוק FAQPage'); sys.exit(1)
ld = [norm(q['acceptedAnswer']['text']) for q in faq['mainEntity']]
if len(seen) != len(ld):
    print(f'{"FAQ נעול ל-JSON-LD":<46} ✗ {len(seen)} תשובות בעמוד מול {len(ld)} ב-JSON-LD')
    sys.exit(1)
bad = [i for i, (a, l) in enumerate(zip(seen, ld), 1) if a != l]
# Markup inside an answer would be normalised away above and the lock would
# still read as intact, so the raw run is checked for tags separately.
tags = [i for i, a in enumerate(re.findall(r'<p class="faq__a">(.*?)</p>', src, re.S), 1) if '<' in a]
if bad or tags:
    for i in bad:
        print(f'    תשובה {i} אינה זהה ל-JSON-LD')
        print(f'      עמוד : {seen[i-1][:110]}')
        print(f'      סכימה: {ld[i-1][:110]}')
    for i in tags:
        print(f'    תשובה {i} מכילה תגית — .faq__a חייב להישאר טקסט בלבד')
    print(f'{"FAQ נעול ל-JSON-LD":<46} ✗')
    sys.exit(1)
print(f'{"FAQ נעול ל-JSON-LD":<46} ✓ ({len(ld)} תשובות)')
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
# edit to the inline bootstrap silently invalidates its hash.
# THIS STOPPED BEING COSMETIC ON 2026-08-13. The comment here used to say "the
# policy is Report-Only so nothing breaks visibly" — true when written, and
# false the moment vercel.json moved to an enforcing Content-Security-Policy.
# An unhashed boot is now BLOCKED, not reported: a returning en/ru visitor gets
# the full-page RTL->LTR mirror flash that the boot exists to prevent.
# Known limit, stated rather than hidden: this asserts that every copy's hash is
# ALLOWED, not that the nine copies are identical to each other. Fork the boot
# on one page, add a fifth sha256 to vercel.json, and this still prints green.
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

# Every column the form posts must be in anon's INSERT grant.
#
# This is the check that did not exist on 2026-08-03, when `email`, `date_tbd`
# and `source` were added to the table and to main.js but not to the grant.
# anon's INSERT is column-scoped, and a column-scoped grant is all-or-nothing
# per statement — one ungranted column fails the whole INSERT. Every submission
# from the live form failed for a day and public.leads stayed empty.
#
# What this can and cannot do: it reads files, so it compares main.js against
# the grant DECLARED in docs/supabase-crm.sql. It cannot see the database. That
# is deliberate and the limit is the point — docs/verify-lead-insert.sql is the
# other half, and it proves the LIVE grant by becoming anon and inserting for
# real. Repo state is not deploy state; this check only keeps the repo honest
# with itself.
python3 - <<'PY' || fail=1
import re, sys

js = open('assets/js/main.js', encoding='utf-8').read()
# The payload object in the Supabase branch: from `payload = {` to its closing
# `};`, anchored on the endpoint assignment above it so a future second payload
# cannot be picked up by accident.
m = re.search(r"/rest/v1/leads.*?payload\s*=\s*\{(.*?)\n\s*\};", js, re.S)
if not m:
    print(f'{"שדות הטופס מול הרשאת anon":<46} ✗ לא נמצא ה-payload ב-main.js')
    sys.exit(1)
body = re.sub(r'//[^\n]*', '', m.group(1))          # strip comments
posts = set(re.findall(r'^\s*([a-z_]+)\s*:', body, re.M))

sql = open('docs/supabase-crm.sql', encoding='utf-8').read()
g = re.search(r'grant\s+insert\s*\((.*?)\)\s*on\s+table\s+public\.leads\s+to\s+anon',
              sql, re.S | re.I)
if not g:
    print(f'{"שדות הטופס מול הרשאת anon":<46} ✗ אין grant insert (…) ל-anon ב-supabase-crm.sql')
    print('    הרשאה ברמת טבלה מאפשרת ל-anon לכתוב handled / id / created_at')
    sys.exit(1)
granted = set(c.strip() for c in re.sub(r'--[^\n]*', '', g.group(1)).split(',') if c.strip())

missing = sorted(posts - granted)
extra   = sorted(granted - posts)
if missing:
    print(f'{"שדות הטופס מול הרשאת anon":<46} ✗')
    print('    main.js שולח עמודות שאינן ב-grant: ' + ', '.join(missing))
    print('    כל שליחה מהאתר תיכשל ב-permission denied for column.')
    print('    הוסף אותן ל-grant ב-docs/supabase-crm.sql, הרץ את אותו grant על')
    print('    הפרויקט החי, ואמת עם docs/verify-lead-insert.sql.')
    sys.exit(1)
if extra:
    print(f'{"שדות הטופס מול הרשאת anon":<46} ✗')
    print('    ה-grant רחב מהטופס: ' + ', '.join(extra))
    print('    צמצם — anon לא צריך הרשאת כתיבה לעמודה שהטופס לא שולח.')
    sys.exit(1)
for never in ('id', 'created_at', 'handled'):
    if never in granted:
        print(f'{"שדות הטופס מול הרשאת anon":<46} ✗ anon מורשה לכתוב {never}')
        sys.exit(1)
print(f'{"שדות הטופס מול הרשאת anon":<46} ✓ ({len(posts)} עמודות)')
PY

# The lead form exists in EIGHT copies and main.js binds
# the first [data-form] on the page, so nothing at runtime notices when they
# drift -- a visitor on the wrong page simply gets a different question set.
# Compares the ordered field/option/error/step attribute sequence of each copy.
python3 - <<'PYFORM' || fail=1
import io, re, sys, glob

def shape(html):
    m = re.search(r'<form class="form" data-form.*?</form>', html, re.S)
    if not m: return None
    b = m.group(0)
    # Four lists was not enough. type=, inputmode= and autocomplete= were all
    # outside the tuple, so changing type="tel" to type="text" on ONE page kept
    # this green while Android stopped offering a numeric keypad on the single
    # field the database declares NOT NULL. Labels and the three submit-label
    # spans were outside it too — a page could ask a different question under
    # the same data-field name.
    return (re.findall(r'data-field="([^"]+)"', b),
            re.findall(r'<option value="([^"]*)"', b),
            re.findall(r'data-error="([^"]+)"', b),
            re.findall(r'data-form-step="([^"]+)"', b),
            re.findall(r'\stype="([^"]+)"', b),
            re.findall(r'\sinputmode="([^"]+)"', b),
            re.findall(r'\sautocomplete="([^"]+)"', b),
            re.findall(r'\sname="([^"]+)"', b),
            re.findall(r'\saria-required="([^"]+)"', b),
            re.findall(r'data-submit-label="([^"]+)"', b),
            [re.sub(r'\s+', ' ', t).strip()
             for t in re.findall(r'<span class="field__label">(.*?)</span>', b, re.S)])

shapes = {}
for p in sorted(glob.glob('*.html')):
    sh = shape(io.open(p, encoding='utf-8').read())
    if sh: shapes[p] = sh
pages = sorted(shapes)
if len(pages) < 2:
    print(f'{"עותקי הטופס זהים":<46} ✗ נמצא רק עותק אחד'); sys.exit(1)
base = pages[0]
bad = [p for p in pages[1:] if shapes[p] != shapes[base]]
if bad:
    print(f'{"עותקי הטופס זהים":<46} ✗')
    for p in bad:
        for i, name in enumerate(('data-field', 'option', 'data-error', 'data-form-step')):
            if shapes[p][i] != shapes[base][i]:
                print(f'    {p} vs {base} — {name}')
                print(f'      {base}: {shapes[base][i]}')
                print(f'      {p}: {shapes[p][i]}')
    sys.exit(1)
print(f'{"עותקי הטופס זהים":<46} ✓ ({len(pages)} עותקים)')
PYFORM
# Two link guards. Both exist because the site grew from 4 pages to 9 in one
# day and neither failure was visible to anything:
#
#  (a) CROSS-PAGE FRAGMENTS. The id-reference check above matches href="#..."
#      anchored at the quote, so href="index.html#services" -- 25 of them --
#      was invisible to it. Renaming one homepage section id killed 25 links
#      across 8 files with a green build.
#  (b) REACHABILITY. delivery.html, save-the-date.html and corporate.html
#      shipped with ZERO inbound links from anywhere on the site. They were
#      in sitemap.xml and in llms.txt and could not be reached by clicking.
python3 - <<'PYLINKS' || fail=1
import io, os, re, sys, glob

pages = sorted(glob.glob("*.html"))
src = {p: io.open(p, encoding="utf-8").read() for p in pages}
ids = {p: set(re.findall(r'\sid="([^"]+)"', s)) for p, s in src.items()}

# (a) every href="other.html#frag" must resolve in THAT file
dead = []
for p, s in src.items():
    for tgt, frag in re.findall(r'href="([A-Za-z0-9._-]+\.html)#([^"]+)"', s):
        if not os.path.isfile(tgt):
            dead.append(f"{p}: {tgt} לא קיים"); continue
        # gallery deep links are JS filter values, not ids — main.js resolves them
        if frag.startswith("gallery-") or frag.startswith("photo-"): continue
        if frag not in ids[tgt]:
            dead.append(f"{p}: {tgt}#{frag}")
if dead:
    print(f'{"עוגנים חוצי-עמודים נפתרים":<46} ✗')
    for d in sorted(set(dead))[:12]: print("    " + d)
    sys.exit(1)
print(f'{"עוגנים חוצי-עמודים נפתרים":<46} ✓')

# (b) every indexable page must be reachable by clicking from index.html
def links(s):
    return set(re.findall(r'href="([A-Za-z0-9._-]+\.html)(?:#[^"]*)?"', s))
indexable = set()
for p, s in src.items():
    m = re.search(r'<meta name="robots" content="([^"]*)"', s)
    if m and "noindex" in m.group(1): continue
    if p == "admin.html": continue
    indexable.add(p)
seen, frontier = {"index.html"}, ["index.html"]
while frontier:
    cur = frontier.pop()
    for nxt in links(src.get(cur, "")):
        if nxt in src and nxt not in seen:
            seen.add(nxt); frontier.append(nxt)
orphans = sorted(indexable - seen)
if orphans:
    print(f'{"כל עמוד ניתן להגעה מעמוד הבית":<46} ✗')
    for o in orphans: print(f"    {o} — אין אליו מסלול קליקים מ-index.html")
    sys.exit(1)
print(f'{"כל עמוד ניתן להגעה מעמוד הבית":<46} ✓ ({len(indexable)} עמודים)')
PYLINKS
# Shell parity. The header, the mobile menu and the footer exist in nine
# hand-copied copies each, and until now NOTHING compared them — the CSP hash
# covered the RTL boot and the parity check above covered the form, and that
# was the whole of it. What drift costs, concretely:
#   header  — lose data-header-solid on one page and it spends its first 80px
#             painting ivory text on sand: an invisible nav.
#   menu    — lose data-menu-close on one page and AMORA_LOCK is never
#             released: the body stays position:fixed and the visitor cannot
#             scroll at all, with no way out but a reload.
#   footer  — one stale phone number or one 404ing legal link, on one page,
#             seen by nobody because nobody visits all nine footers.
#   scripts — drop i18n.js from one copy and that page silently loses the
#             language switcher; drop main.js and the form binds to nothing
#             and writes no lead, with no error anywhere.
#
# The family is the pages carrying data-header-solid — the shared subpage
# shell. index.html is EXCLUDED and named here rather than silently skipped:
# it owns #gear and #process, which exist on no other page, so its nav is
# legitimately two items longer. camera-3d.html is inside the family; its
# cross-page #contact is normalised below, and its two extra module scripts
# are ignored because only the three shared ones are order-critical.
python3 - <<'PYSHELL' || fail=1
import io, re, sys, glob

def norm(t):
    t = re.sub(r"<!--.*?-->", "", t, flags=re.S)      # comments drift freely
    t = t.replace('href="index.html#', 'href="#')   # camera-3d's cross-page contact
    return re.sub(r"\s+", " ", t).strip()

def block(s, start, end):
    i = s.find(start)
    if i < 0: return None
    j = s.find(end, i)
    return norm(s[i:j + len(end)]) if j > 0 else None

def scripts(s):
    core = ("main.js", "assistant.js", "i18n.js")
    got = re.findall(r'<script src="assets/js/([a-z0-9-]+\.js)"([^>]*)>', s)
    return [(f, "defer" in a) for f, a in got if f in core]

family = sorted(p for p in glob.glob("*.html")
                if "data-header-solid" in io.open(p, encoding="utf-8").read())
if len(family) < 2:
    print(f'{"מעטפת זהה בין העמודים":<46} ✗ פחות משני עמודים במשפחה'); sys.exit(1)

PARTS = {
    "header": ('<header class="site-header', "</header>"),
    "menu": ('<div class="menu" id="mobile-menu"', "</div>"),
    "footer": ('<footer class="site-footer">', "</footer>"),
}
shapes = {}
for p in family:
    s = io.open(p, encoding="utf-8").read()
    d = {k: block(s, a, b) for k, (a, b) in PARTS.items()}
    d["scripts"] = scripts(s)
    shapes[p] = d

base = family[0]
bad = []
for p in family[1:]:
    for k in list(PARTS) + ["scripts"]:
        if shapes[p][k] != shapes[base][k]:
            bad.append((p, k))
missing = [(p, k) for p in family for k in PARTS if shapes[p][k] is None]
if bad or missing:
    print(f'{"מעטפת זהה בין העמודים":<46} ✗')
    for p, k in missing: print(f"    {p}: אין בלוק {k} בכלל")
    for p, k in bad:     print(f"    {p}: {k} שונה מ-{base}")
    sys.exit(1)
print(f'{"מעטפת זהה בין העמודים":<46} ✓ ({len(family)} עמודים, 4 בלוקים)')
PYSHELL
# Gallery deep links vs the filter values that resolve them. #gallery-<cat> is
# NOT an id — main.js matches the fragment against the chips' data-filter
# values at runtime — so the cross-page fragment check above deliberately skips
# them and nothing else looked. CLAUDE.md is explicit that these addresses have
# already been sent to people: renaming a data-filter value breaks links that
# are sitting in strangers' WhatsApp threads, and nothing fails loudly.
python3 - <<'PYGAL' || fail=1
import io, re, sys, glob

LABEL = "קישורי גלריה תואמים לפילטרים"
home = io.open("index.html", encoding="utf-8").read()
chips = set(re.findall(r'data-filter="([^"]+)"', home))
if not chips:
    print(f'{LABEL:<46} ✗ no data-filter chips found'); sys.exit(1)
bad = []
for p in sorted(glob.glob("*.html")):
    s = io.open(p, encoding="utf-8").read()
    for cat in re.findall(r'href="(?:index\.html)?#gallery-([a-z]+)"', s):
        if cat not in chips:
            bad.append(f"{p}: #gallery-{cat}")
if bad:
    print(f'{LABEL:<46} ✗')
    for d in sorted(set(bad)): print("    " + d)
    print("    " + "available: " + ", ".join(sorted(chips)))
    sys.exit(1)
print(f'{LABEL:<46} ✓ ({len(chips)} filters)')
PYGAL

exit $fail

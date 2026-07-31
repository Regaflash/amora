#!/usr/bin/env bash
# Pre-deploy consistency checks. Exits non-zero if anything looks wrong.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
fail=0
say() { printf '%-46s %s\n' "$1" "$2"; }

# every src/srcset target actually exists
missing=$(grep -oE '(src|srcset)="[^"]*"' index.html accessibility.html privacy.html camera-3d.html 2>/dev/null \
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
s = open('index.html', encoding='utf-8').read()
blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', s, re.S)
for b in blocks:
    try: json.loads(b)
    except Exception as e: print(f'    JSON-LD שבור: {e}'); sys.exit(1)
print(f'{"JSON-LD תקין":<46} ✓ ({len(blocks)} בלוקים)')
PY

# no external runtime dependency crept back in
ext=$(grep -oE 'https://(fonts\.googleapis|fonts\.gstatic|unpkg)\.com' index.html camera-3d.html 2>/dev/null | sort -u)
if [ -n "$ext" ]; then say "תלות חיצונית חזרה" "✗"; echo "$ext" | sed 's/^/    /'; fail=1; else say "אין תלויות חיצוניות בזמן ריצה" "✓"; fi

exit $fail

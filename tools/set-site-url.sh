#!/usr/bin/env bash
# Replace the SITE_URL placeholder everywhere. Run once, before going live.
#   tools/set-site-url.sh https://amorastudio.co.il
set -euo pipefail
URL="${1:-}"
[ -n "$URL" ] || { echo "usage: $0 https://your-domain.co.il  (no trailing slash)" >&2; exit 1; }
URL="${URL%/}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
n=0
for f in index.html robots.txt sitemap.xml accessibility.html privacy.html camera-3d.html; do
  [ -f "$ROOT/$f" ] || continue
  c=$(grep -c 'SITE_URL' "$ROOT/$f" 2>/dev/null || true); c=${c:-0}
  [ "$c" -eq 0 ] && continue
  sed -i "s#SITE_URL#${URL}#g" "$ROOT/$f"
  echo "  $f — $c"
  n=$((n+c))
done
echo "סה\"כ $n הוחלפו."

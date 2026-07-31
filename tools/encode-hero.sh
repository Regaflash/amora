#!/usr/bin/env bash
# Encode the hero background loop from real footage.
#
#   tools/encode-hero.sh wide     path/to/landscape-source.mov
#   tools/encode-hero.sh vertical path/to/portrait-source.mov
#
# Writes assets/video/hero-<variant>.{mp4,webm} and the matching poster into
# assets/img/. Nothing else in the site needs to change — main.js picks the
# variant by viewport shape at runtime.
#
# Requires ffmpeg on PATH. Audio is stripped: the hero always plays muted, and
# an audio track is dead weight the visitor still downloads.
set -euo pipefail

VARIANT="${1:-}"; SRC="${2:-}"
START="${START:-0}"        # START=12 to begin 12s into the source
DURATION="${DURATION:-8}"  # loop length in seconds

case "$VARIANT" in
  wide)     W=1920; H=1080 ;;
  vertical) W=1080; H=1920 ;;
  *) echo "usage: $0 {wide|vertical} <source-video>" >&2; exit 1 ;;
esac
[ -f "$SRC" ] || { echo "no such file: $SRC" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/assets/video" "$ROOT/assets/img"
SCALE="scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},format=yuv420p"

echo "→ H.264 ${W}x${H}"
ffmpeg -y -loglevel error -ss "$START" -i "$SRC" -t "$DURATION" -vf "$SCALE" \
  -c:v libx264 -crf 26 -preset slow -profile:v high -movflags +faststart -an \
  "$ROOT/assets/video/hero-${VARIANT}.mp4"

echo "→ VP9 ${W}x${H}"
ffmpeg -y -loglevel error -ss "$START" -i "$SRC" -t "$DURATION" -vf "$SCALE" \
  -c:v libvpx-vp9 -crf 36 -b:v 0 -row-mt 1 -deadline good -cpu-used 2 -an \
  "$ROOT/assets/video/hero-${VARIANT}.webm"

echo "→ poster (first frame, so there is no flash when the video fades in)"
ffmpeg -y -loglevel error -ss "$START" -i "$SRC" -vframes 1 \
  -vf "${SCALE},scale=$((W*2/3)):-2" -q:v 3 "$ROOT/assets/img/hero-${VARIANT}-poster.jpg"
ffmpeg -y -loglevel error -i "$ROOT/assets/img/hero-${VARIANT}-poster.jpg" \
  -c:v libwebp -quality 74 "$ROOT/assets/img/hero-${VARIANT}-poster.webp"

ls -lh "$ROOT/assets/video/hero-${VARIANT}".* "$ROOT/assets/img/hero-${VARIANT}-poster".*
echo
echo "Aim for under ~3MB per file. If it is bigger, raise -crf (26 → 28 → 30)."

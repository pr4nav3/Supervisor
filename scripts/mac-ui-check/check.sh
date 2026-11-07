#!/bin/sh
# Lays out every screen of the mock in WebKit (the macOS webview) and fails on anything a
# Windows-only pass cannot see: horizontal overflow, a modal taller than the window, or a
# status-window card taller than its window. Runs on a Mac; CI runs it on the macOS job.
#   sh scripts/mac-ui-check/check.sh          (starts its own Vite server)
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
OUT=${TMPDIR:-/tmp}/mac-ui-check
mkdir -p "$OUT"
clang -O -fobjc-arc -framework Cocoa -framework WebKit -o "$OUT/webkit-eval" "$HERE/webkit-eval.m"
STARTED=0
if ! curl -sf -o /dev/null http://127.0.0.1:1420/scripts/mac-ui-check/mock.html; then
  (cd "$ROOT" && npx vite --host 127.0.0.1 --port 1420 --strictPort >"$OUT/vite.log" 2>&1 &)
  STARTED=1
  for i in $(seq 1 150); do curl -sf -o /dev/null http://127.0.0.1:1420/scripts/mac-ui-check/mock.html && break; sleep 0.2; done
fi
# The default window, then the smallest: 800x560 less the 28 px title bar a Mac draws inside it.
FAILED=0
for SIZE in 920x760 800x532; do
  "$OUT/webkit-eval" "http://127.0.0.1:1420/scripts/mac-ui-check/mock.html" "${SIZE%x*}" "${SIZE#*x}" "$HERE/states.js" > "$OUT/raw-$SIZE.txt" \
    || { cat "$OUT/raw-$SIZE.txt" >&2; FAILED=1; continue; }
  tail -1 "$OUT/raw-$SIZE.txt" > "$OUT/states-$SIZE.json"
  python3 "$HERE/assert.py" "$OUT/states-$SIZE.json" || FAILED=1
done
[ "$STARTED" = 1 ] && pkill -f "vite --host 127.0.0.1 --port 1420" || true
exit $FAILED

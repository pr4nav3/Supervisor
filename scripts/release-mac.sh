#!/bin/sh
# Build a Mac release: freeze and sign the webcam worker, build and sign Supervisor.app, then
# zip it for scripts/install-mac.sh and tar it for the app's own updater. Run on a Mac (or the
# macos CI runner) from the repo root, with the updater key in the environment:
#   TAURI_SIGNING_PRIVATE_KEY=~/.tauri/supervisor-updater.key TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
#     sh scripts/release-mac.sh ["Signing identity"]
# Output in build/release/: Supervisor-macos-<arch>.zip and .sha256 (the install line),
# Supervisor-macos-<arch>.app.tar.gz and .sig, and latest.json (the updater). Upload the zip, its
# .sha256, the .app.tar.gz and latest.json to the release tagged v<version>, the one GitHub marks
# Latest; the script fetches that release's latest.json first, so both platforms stay in it.
#
# The identity defaults to "Supervisor Dev" (scripts/make_mac_dev_cert.sh). Every release must
# use the SAME certificate, or macOS treats the update as a different app and silently drops
# the user's Accessibility, Camera and Microphone grants.
set -eu

IDENTITY="${1:-Supervisor Dev}"
REPO=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO"

case "$(uname -m)" in
  arm64) arch=aarch64 ;;
  *) echo "unsupported processor $(uname -m); install-mac.sh only installs on Apple Silicon" >&2; exit 1 ;;
esac
VERSION=$(python3 -c 'import json; print(json.load(open("src-tauri/tauri.conf.json"))["version"])')
TAG="v$VERSION"
# The certificate every release must carry; anything else silently drops users' permissions.
REQUIREMENT='identifier "app.supervisor.desktop" and certificate leaf = H"71098375bde8e53f630830c240148afff64e7500"'
out="build/release"
zip="$out/Supervisor-macos-$arch.zip"

security unlock-keychain -p supervisor-dev "$HOME/Library/Keychains/supervisor-dev.keychain-db" 2>/dev/null || true
# The updater refuses anything its key did not sign, and the build fails late without the key.
[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ] || { echo "set TAURI_SIGNING_PRIVATE_KEY to the updater key (notes/plans/mac-handoff.md)" >&2; exit 1; }

.venv-webcam/bin/python scripts/build_webcam_runtime.py
sh scripts/sign_webcam_runtime.sh "$IDENTITY"
APPLE_SIGNING_IDENTITY="$IDENTITY" npx tauri build --bundles app --config src-tauri/tauri.bundle.conf.json

app="src-tauri/target/release/bundle/macos/Supervisor.app"
codesign --verify --deep --strict -R="$REQUIREMENT" "$app" \
  || { echo "the app is not signed with Supervisor's certificate (notes/plans/distribution.md)" >&2; exit 1; }

mkdir -p "$out"
rm -f "$zip" "$zip.sha256"
ditto -c -k --keepParent "$app" "$zip"
(cd "$out" && shasum -a 256 "$(basename "$zip")" > "$(basename "$zip").sha256")

# The updater's copy: the tar the build signed, under its release name, and latest.json.
tar="$out/Supervisor-macos-$arch.app.tar.gz"
cp "$app.tar.gz" "$tar"
cp "$app.tar.gz.sig" "$tar.sig"
# Start from the release's latest.json, if Windows already uploaded one: otherwise the file
# written here has only the Mac entry, and uploading it would break every Windows copy's check.
gh release download "$TAG" -p latest.json -D "$out" --clobber 2>/dev/null || true
python3 scripts/updater_manifest.py "darwin-$arch" "$tar"

echo "release ready: $zip ($(du -h "$zip" | cut -f1)), $tar and $out/latest.json"
cat "$zip.sha256"

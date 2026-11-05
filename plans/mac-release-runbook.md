# Mac release runbook: finish Supervisor 1.0 from a fresh Mac

For an agent on a Mac that has never seen this repo. Goal: add the two Mac assets to the
GitHub Releases that already hold the Windows ones, so the Mac install line and the in-app
voice engine download work for Mac users. Nothing else in the app needs changing.

What already exists on GitHub (`pr4nav3/Supervisor`):
- Release `v1.0` (latest): `Supervisor_v1.0_x64-setup.exe` and the notes. Needs the Mac app
  zip and its `.sha256` added.
- Pre-release `voice-runtime`: `supervisor-voice-runtime-windows-x64.zip` and a manifest that
  lists Windows only. Needs the Mac engine zip added and the manifest rebuilt from both.

## 0. The Mac itself

- Apple Silicon (M1 or later) and macOS 14 or later. An Intel Mac produces an `x86_64` zip the
  installer does not look for; stop and say so.
- About 25 GB free. The voice venv alone is several GB.
- The user's GitHub account, signed in with `gh` (step 2). Commits from this Mac must carry
  the user's identity, never the Mac owner's (step 2).

## 1. Toolchain

```sh
xcode-select --install                 # Command Line Tools, if not present
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"   # if no brew
brew install node python@3.11 python@3.13 gh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && . "$HOME/.cargo/env"
```

## 2. Clone as the user

```sh
git clone git@github.com:pr4nav3/Supervisor.git supervisor   # or https
cd supervisor
git config user.name "Pranav Karthik"
git config user.email "tkotalwar@wisc.edu"
gh auth login --hostname github.com --web      # the USER does this step in the browser, as pr4nav3
gh auth status                                  # must say pr4nav3
npm install
npm run check
(cd src-tauri && cargo test)                    # 218 pass, 7 ignored on Windows; a few more ignored here
```

## 3. The two Python venvs (names are fixed; the build scripts look for them)

```sh
/opt/homebrew/opt/python@3.13/bin/python3.13 -m venv .venv-webcam
.venv-webcam/bin/pip install -r webcam_bakeoff/build-requirements.txt
.venv-webcam/bin/python webcam_bakeoff/export_models.py       # makes webcam_bakeoff/models/yolo26s.onnx (not in git)
.venv-webcam/bin/python webcam_bakeoff/download_models.py     # verifies both model files
```

If `download_models.py` says the YOLO file "does not match its pinned sha256": the export's
bytes vary with tool versions. Run `.venv-webcam/bin/python -m pytest webcam_bakeoff` and
`.venv-webcam/bin/python webcam_bakeoff/run_tracker.py --self-test --device cpu` and the same
with `--device gpu`; if all pass, add the new hash to `also_sha256` in
`webcam_bakeoff/download_models.py` with a dated comment, as the two Mac hashes there were.

```sh
/opt/homebrew/opt/python@3.11/bin/python3.11 -m venv .venv-voice-runtime-macos
.venv-voice-runtime-macos/bin/pip install -r voice_worker/requirements.txt -r voice_worker/build-requirements.txt
```

Do not use `/opt/anaconda3` or any x86_64 Python: the venv would pull Intel wheels.

## 4. The signing certificate: read before building

`scripts/release-mac.sh` and `scripts/install-mac.sh` both pin the certificate "Supervisor Dev"
by its SHA-1 (`71098375bde8e53f630830c240148afff64e7500`). macOS keys a user's Accessibility,
Camera and Microphone grants to it, so every future release must carry the same one.

**Case A: the user has the backup** (`supervisor-signing.p12` + `p12-password.txt`, made on
the first Mac, kept outside the repo). Import it; never run `make_mac_dev_cert.sh`:

```sh
KC=~/Library/Keychains/supervisor-dev.keychain-db
security create-keychain -p supervisor-dev $KC
security set-keychain-settings $KC
security unlock-keychain -p supervisor-dev $KC
security import supervisor-signing.p12 -k $KC -P "$(cat p12-password.txt)" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple: -s -k supervisor-dev $KC
security find-certificate -c "Supervisor Dev" -p $KC > /tmp/supervisor-dev.pem
security add-trusted-cert -r trustRoot -p codeSign -k $KC /tmp/supervisor-dev.pem
security list-keychains -d user -s $KC ~/Library/Keychains/login.keychain-db
security find-identity -v -p codesigning        # must list "Supervisor Dev" with the SHA-1 above
```

**Case B: no backup on hand.** No Mac release has shipped yet, so nobody's grants depend on
the old certificate. Mint a new one and make it THE certificate from now on:

```sh
sh scripts/make_mac_dev_cert.sh
security find-identity -v -p codesigning        # note the new 40-hex SHA-1
```

Then replace the old hash with the new one, lowercase, in both `scripts/release-mac.sh` and
`scripts/install-mac.sh` (the `REQUIREMENT=` line in each) and in `plans/distribution.md`,
commit that with a message saying the certificate was re-minted on this date, and push it
BEFORE building. The installer reads `scripts/install-mac.sh` from `main`, so a release
signed with the new certificate only installs once that push is up. Then back the new
certificate up at once, outside the repo, and tell the user to put it in a password manager:

```sh
mkdir -p ~/supervisor-signing && cd ~/supervisor-signing
security export -k ~/Library/Keychains/supervisor-dev.keychain-db -t identities -f pkcs12 -P "$(openssl rand -hex 16 | tee p12-password.txt)" -o supervisor-signing.p12
base64 -i supervisor-signing.p12 -o supervisor-signing.p12.base64
cd -
```

Never commit the `.p12`, the password or the base64 file.

## 5. Build the two assets

```sh
sh scripts/release-mac.sh
# -> build/release/Supervisor-macos-aarch64.zip and .sha256; the script verifies the signature
#    against the pinned hash and refuses otherwise
.venv-voice-runtime-macos/bin/python scripts/build_voice_runtime.py
# -> build/voice-runtime/supervisor-voice-runtime-macos-arm64.zip and .asset.json
```

Check the engine zip the way Windows was checked: install it through the app's own code and
make one line with the installed worker.

```sh
cd src-tauri && SUPERVISOR_TEST_RUNTIME_ZIP=../build/voice-runtime/supervisor-voice-runtime-macos-arm64.zip \
  cargo test manual_install_real_runtime_zip -- --ignored --nocapture; cd ..
```

It prints the installed worker's path. Make a line with it (needs the engine weights; if
`~/Library/Application Support/app.supervisor.desktop/voice/model_packs/chatterbox-nano-minimal`
does not exist, skip this check and say so):

```sh
printf '{"phrases":[{"id":"smoke","tone":"stern","text":"Put the phone down."}]}' > /tmp/smoke.json
<printed worker path> --model-dir "$HOME/Library/Application Support/app.supervisor.desktop/voice/model_packs/chatterbox-nano-minimal" \
  --reference src-tauri/voices/derek.wav --phrases /tmp/smoke.json --out-dir /tmp/smoke-out --cache-dir /tmp/smoke-cache --device cpu --seed 11
```

## 6. Upload

Engine zip first, then the manifest from BOTH asset files. The Windows asset descriptor is not
in git (build/ is ignored); write it exactly as below:

```sh
mkdir -p build/voice-runtime
cat > build/voice-runtime/supervisor-voice-runtime-windows-x64.asset.json <<'EOF'
{
  "bytes": 310794974,
  "executable": "supervisor-voice-worker.exe",
  "sha256": "827cdba5980a73f9cc888fddfd464e7dd6e0a37181f04ea4cc130039eaa76516",
  "target": "windows-x64",
  "url": "https://github.com/pr4nav3/Supervisor/releases/download/voice-runtime/supervisor-voice-runtime-windows-x64.zip"
}
EOF
gh release upload voice-runtime build/voice-runtime/supervisor-voice-runtime-macos-arm64.zip
```

Put the Mac zip's release URL into its `.asset.json` `url` field:
`https://github.com/pr4nav3/Supervisor/releases/download/voice-runtime/supervisor-voice-runtime-macos-arm64.zip`.
Then:

```sh
python3 scripts/build_voice_runtime_manifest.py --version 2026-11-05 \
  --output build/voice-runtime/voice-runtime-manifest.json \
  build/voice-runtime/supervisor-voice-runtime-windows-x64.asset.json \
  build/voice-runtime/supervisor-voice-runtime-macos-arm64.asset.json
gh release upload voice-runtime build/voice-runtime/voice-runtime-manifest.json --clobber
gh release upload v1.0 build/release/Supervisor-macos-aarch64.zip build/release/Supervisor-macos-aarch64.zip.sha256
```

## 7. Prove it

```sh
curl -sL https://github.com/pr4nav3/Supervisor/releases/download/voice-runtime/voice-runtime-manifest.json | python3 -m json.tool   # two targets
curl -fsSL https://raw.githubusercontent.com/pr4nav3/Supervisor/main/scripts/install-mac.sh | sh   # installs and opens Supervisor on this Mac
```

The installed app must open with no Gatekeeper dialog. Then in the app: Settings > Customize >
Voice engine > Download, and generate one line.

## 8. Record it

Append the Mac zip names, sizes and sha256s to `plans/release-2026-11-05.md` under a "Mac
half" heading, note which certificate case applied, commit as the user and push. Commit only
the files you changed: nothing under `build/`, no venv, no `.p12`.

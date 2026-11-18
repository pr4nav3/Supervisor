"""Add one platform's update to latest.json, the file the app's updater reads.

    python scripts/updater_manifest.py windows-x86_64 build/release/Supervisor-windows-x64-setup.exe
    python scripts/updater_manifest.py darwin-aarch64 build/release/Supervisor-macos-aarch64.app.tar.gz

The installer must sit next to the .sig its build wrote (TAURI_SIGNING_PRIVATE_KEY set). The
version is tauri.conf.json's; the address is that version's release asset, so the file must be
uploaded under the same name. Windows and Mac are built on different machines: download the
release's latest.json into the same folder first, so the second platform joins the first.
"""
import argparse
import json
import pathlib
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = "pr4nav3/Supervisor"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("platform", choices=["windows-x86_64", "darwin-aarch64"])
    parser.add_argument("installer", type=pathlib.Path)
    parser.add_argument("--base-url", help="where the installer is served; default: the version's GitHub release")
    args = parser.parse_args()

    version = json.loads((ROOT / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8"))["version"]
    base = args.base_url or f"https://github.com/{REPO}/releases/download/v{version}"
    manifest_path = args.installer.parent / "latest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    if manifest.get("version") != version:
        manifest = {"version": version, "pub_date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "platforms": {}}
    manifest["platforms"][args.platform] = {
        "signature": pathlib.Path(f"{args.installer}.sig").read_text(encoding="utf-8").strip(),
        "url": f"{base}/{args.installer.name}",
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"{manifest_path}: {version}, {', '.join(sorted(manifest['platforms']))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

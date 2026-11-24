"""Set the app's version everywhere it is written down.

    python scripts/bump_version.py 1.0.1

Edits tauri.conf.json, Cargo.toml, Cargo.lock and package.json in place, one value each, and
prints what changed. Run cargo or a build afterwards as usual; this never does.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
# (file, pattern whose first group is the old version)
TARGETS = [
    (ROOT / "src-tauri" / "tauri.conf.json", r'^  "version": "([^"]+)"'),
    (ROOT / "package.json", r'^  "version": "([^"]+)"'),
    (ROOT / "src-tauri" / "Cargo.toml", r'^\[package\]\r?\nname = "supervisor"\r?\nversion = "([^"]+)"'),
    (ROOT / "src-tauri" / "Cargo.lock", r'^name = "supervisor"\r?\nversion = "([^"]+)"'),
]


def main() -> int:
    if len(sys.argv) != 2 or not re.fullmatch(r"\d+\.\d+\.\d+", sys.argv[1]):
        print("usage: bump_version.py MAJOR.MINOR.PATCH", file=sys.stderr)
        return 2
    new = sys.argv[1]
    for path, pattern in TARGETS:
        # newline="" both ways: the files keep their own line endings.
        with path.open(encoding="utf-8", newline="") as f:
            text = f.read()
        match = re.search(pattern, text, re.MULTILINE)
        if not match:
            print(f"{path}: no version found", file=sys.stderr)
            return 1
        start, end = match.span(1)
        path.write_text(text[:start] + new + text[end:], encoding="utf-8", newline="")
        print(f"{path.relative_to(ROOT)}: {match.group(1)} -> {new}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

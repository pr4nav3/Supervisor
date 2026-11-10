#!/usr/bin/env python3
"""Build a Supervisor voice runtime zip for GitHub Releases.

Run this on the target OS/architecture from a clean Python 3.11 environment
with voice_worker/build-requirements.txt and voice_worker/requirements.txt
installed. The zip layout intentionally has the worker executable at archive
root because the Rust installer expects that simple contract.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import stat
import subprocess
import sys
import zipfile
from pathlib import Path
from typing import Sequence


WORKER_NAME = "supervisor-voice-worker"
HIDDEN_IMPORTS = [
    "scipy._cyutility",
]
COPY_METADATA = [
    "requests",
]


def runtime_target() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()
    os_name = {"darwin": "macos", "windows": "windows"}.get(system, system)
    arch = {
        "arm64": "arm64",
        "aarch64": "arm64",
        "amd64": "x64",
        "x86_64": "x64",
    }.get(machine, machine)
    return f"{os_name}-{arch}"


def zip_dir(source: Path, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source.rglob("*")):
            # Keep symlinks as symlinks. PyInstaller on macOS links `_internal/Python` into
            # Python.framework; stored as a copy, its @loader_path rpath points outside the
            # runtime and the worker cannot load libintl.
            if path.is_symlink():
                info = zipfile.ZipInfo(str(path.relative_to(source)))
                info.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(info, os.readlink(path))
                continue
            if path.is_dir():
                continue
            archive.write(path, path.relative_to(source))


def build_runtime(output: Path) -> None:
    repo = Path(__file__).resolve().parents[1]
    worker = repo / "voice_worker" / "chatterbox_nano_worker.py"
    hooks_dir = repo / "voice_worker" / "pyinstaller_hooks"
    build_root = repo / "build" / "voice_runtime"
    dist_dir = build_root / "dist"
    work_dir = build_root / "pyinstaller"
    spec_dir = build_root / "spec"
    runtime_dir = dist_dir / WORKER_NAME

    if runtime_dir.exists():
        shutil.rmtree(runtime_dir)
    env = os.environ.copy()
    env.setdefault("PYINSTALLER_CONFIG_DIR", str(build_root / "config"))
    env.setdefault("MPLCONFIGDIR", str(build_root / "matplotlib"))
    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        # Transformers' lazy import machinery can ask importlib/inspect for
        # external .pyc paths in frozen apps. noarchive keeps those bytecode
        # files beside the collected sources instead of only inside PYZ.
        "--debug",
        "noarchive",
        "--onedir",
        "--name",
        WORKER_NAME,
        "--distpath",
        str(dist_dir),
        "--workpath",
        str(work_dir),
        "--specpath",
        str(spec_dir),
        "--additional-hooks-dir",
        str(hooks_dir),
    ]
    for module in HIDDEN_IMPORTS:
        command.extend(["--hidden-import", module])
    for package in COPY_METADATA:
        command.extend(["--copy-metadata", package])
    command.append(str(worker))

    subprocess.run(
        command,
        check=True,
        cwd=repo,
        env=env,
    )
    zip_dir(runtime_dir, output)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build a Supervisor voice runtime zip for this computer.")
    parser.add_argument("--output", type=Path, help="Output zip path.")
    args = parser.parse_args(argv)
    # PyInstaller cannot cross-compile, so the zip is always for this host.
    target = runtime_target()
    repo = Path(__file__).resolve().parents[1]
    output = args.output or (repo / "build" / "voice-runtime" / f"supervisor-voice-runtime-{target}.zip")
    build_runtime(output)
    with output.open("rb") as handle:
        sha256 = hashlib.file_digest(handle, "sha256").hexdigest()
    asset = {
        "target": target,
        "url": "<attach this zip to a GitHub Release and paste the asset URL here>",
        "sha256": sha256,
        "bytes": output.stat().st_size,
        "executable": f"{WORKER_NAME}.exe" if target.startswith("windows-") else WORKER_NAME,
    }
    sidecar = output.with_suffix(".asset.json")
    sidecar.write_text(json.dumps(asset, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(output)
    print(sidecar)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""The ONNX files the webcam worker needs, pinned by sha256. Local disk only."""

from __future__ import annotations

import hashlib
import shutil
import sys
import urllib.request
from pathlib import Path
from typing import Dict

MODELS_DIR = Path(__file__).resolve().parent / "models"

FACE_MODEL = "face_detection_yunet_2023mar.onnx"
DETECTOR = "yolo26s.onnx"

# Shipped with the app, but not in git (the root .gitignore ignores it). The YOLO file is
# the phone detector fine-tuned in train/ (YOLO26s, exported once with `train.py export`)
# and pinned here, so every build ships exactly the model that was judged. See README.md
# for where to get it.
REQUIRED = {
    FACE_MODEL: {
        "url": "https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx",
        "sha256": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    },
    DETECTOR: {
        # train/runs/distil2-neck round 8, exported 2026-11-22 (train/README.md).
        "sha256": "d62da80acbdc3b67339a69d93e4b8b2a633b38f352a34f128beb228b5d70b57e",
    },
}

USER_AGENT = "SupervisorWebcam/1"


def sha256_file(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=180) as response, tmp.open("wb") as out:
        shutil.copyfileobj(response, out)
    tmp.replace(dest)


def verify_models(models_dir: Path = MODELS_DIR) -> Dict[str, Path]:
    """Every required model present with the pinned hash. Never downloads."""
    problems = []
    for name, spec in REQUIRED.items():
        path = models_dir / name
        if not path.is_file():
            problems.append(f"{name} is missing")
        elif sha256_file(path) != spec["sha256"]:
            problems.append(f"{name} does not match its pinned sha256")
    if problems:
        raise RuntimeError(f"webcam models in {models_dir}: " + "; ".join(problems))
    return {name: models_dir / name for name in REQUIRED}


def ensure_models(models_dir: Path = MODELS_DIR) -> Dict[str, Path]:
    """Dev helper: fetch the downloadable models, then verify all of them."""
    for name, spec in REQUIRED.items():
        path = models_dir / name
        if "url" in spec and not path.is_file():
            print(f"downloading {name}", file=sys.stderr, flush=True)
            download(spec["url"], path)
    return verify_models(models_dir)


def main() -> int:
    for name, path in ensure_models().items():
        print(f"{name}  {path.stat().st_size}  {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

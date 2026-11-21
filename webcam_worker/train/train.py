#!/usr/bin/env python3
"""Fine-tune the shipped YOLO26s on data/yolo and export it to ONNX like export_models.py.
Run in .venv-train after `dataset.py build`.

  python train.py NAME [epochs] [freeze]   trains runs/NAME (25 rounds, head only by default)
  python train.py resume NAME              carries on from runs/NAME/weights/last.pt
  python train.py blend NAME SHARE         stock weights plus SHARE of the way to runs/NAME's

Gentle on purpose, so it learns the desk-webcam view without forgetting what it knew: only the
detection head learns, plain SGD at a fifth of the usual learning rate, no bias warm-up. A blend
(WiSE-FT, Wortsman et al. 2022) moves only part of the way from the stock weights to the
fine-tuned ones, which keeps more of what the stock model knew.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUNS = HERE / "runs"


def export(pt: Path, dest: Path) -> None:
    from ultralytics import YOLO

    shutil.copy2(Path(YOLO(str(pt)).export(format="onnx", imgsz=640, simplify=True, device="cpu")), dest)
    print(f"{dest}  {dest.stat().st_size}  sha256={hashlib.sha256(dest.read_bytes()).hexdigest()}")


def blend(name: str, share: float) -> None:
    import torch

    stock = torch.load(HERE / "data" / "yolo26s.pt", weights_only=False)["model"].float().state_dict()
    ckpt = torch.load(RUNS / name / "weights" / "best.pt", weights_only=False)
    model = ckpt["model"].float()
    tuned = model.state_dict()
    model.load_state_dict({k: stock[k] + share * (v - stock[k]) if v.is_floating_point() else v for k, v in tuned.items()})
    ckpt["model"] = model.half()
    out = RUNS / name / "weights" / f"blend-{share}.pt"
    torch.save(ckpt, out)
    export(out, RUNS / name / f"blend-{share}.onnx")


def main() -> int:
    args = sys.argv[1:]
    from ultralytics import YOLO, settings

    settings.update({"sync": False})
    os.chdir(HERE / "data")  # stock weights download here, not into the repo
    if len(args) == 3 and args[0] == "blend":
        blend(args[1], float(args[2]))
        return 0
    if len(args) == 2 and args[0] == "resume":
        name = args[1]
        YOLO(str(RUNS / name / "weights" / "last.pt")).train(resume=True)
    elif 1 <= len(args) <= 3:
        name = args[0]
        YOLO("yolo26s.pt").train(
            data=str(HERE / "data" / "yolo" / "data.yaml"),
            epochs=int(args[1]) if len(args) > 1 else 25,
            patience=10,
            imgsz=640,
            batch=16,
            freeze=int(args[2]) if len(args) > 2 else 23,  # 23 = everything but the detection head
            optimizer="SGD",  # "auto" would pick its own learning rate and ignore lr0
            lr0=0.002,
            lrf=0.1,
            warmup_epochs=1,
            warmup_bias_lr=0.0,  # the default 0.1 is for training from scratch; it knocks the stock head off
            workers=2,  # four ran this 16 GB laptop out of memory twice
            seed=42,
            project=str(RUNS),
            name=name,
            exist_ok=True,
        )
    else:
        print(__doc__)
        return 2
    export(RUNS / name / "weights" / "best.pt", RUNS / name / "yolo26s-phone.onnx")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

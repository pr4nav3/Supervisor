#!/usr/bin/env python3
"""Fine-tune the shipped YOLO26s on data/yolo and export it to ONNX like export_models.py.
Run in .venv-train after `dataset.py build`.

  python train.py NAME [key=value ...]   trains runs/NAME; e.g. freeze=16 distill_model=yolo26x.pt lr0=0.001 batch=8
  python train.py resume NAME            carries on from runs/NAME/weights/last.pt
  python train.py blend NAME CKPT SHARE  stock weights plus SHARE of the way to runs/NAME/weights/CKPT.pt
  python train.py export NAME CKPT       runs/NAME/CKPT.onnx, as the app runs it

Gentle on purpose, so it learns the desk-webcam view without forgetting what it knew: by default
only the detection head learns, plain SGD at a fifth of the usual learning rate, no bias warm-up.
A checkpoint is kept every two rounds and none is picked here: Ultralytics would pick by all-class
accuracy on validation, and `evaluate.py select` picks by phones caught at a fixed false-alarm
rate. A blend (WiSE-FT, Wortsman et al. 2022) moves only part of the way from the stock weights to
the fine-tuned ones, which keeps more of what the stock model knew.
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


def keep_app_head_weight() -> None:
    """YOLO26 trains two heads: one-to-many (the app's ONNX uses it, with its own NMS) and one-to-one.
    Ultralytics moves the loss from the first to the second over a run (0.8 down to 0.1), which in a
    fine-tune sends most of the learning to the head the app never runs. Hold it at 0.8."""
    from ultralytics.utils.loss import E2ELoss

    E2ELoss.decay = lambda self, x: self.o2m_copy


def blend(name: str, ckpt: str, share: float) -> None:
    import torch

    stock = torch.load(HERE / "data" / "yolo26s.pt", weights_only=False)["model"].float().state_dict()
    saved = torch.load(RUNS / name / "weights" / f"{ckpt}.pt", weights_only=False)
    model = (saved.get("ema") or saved["model"]).float().cpu()  # mid-run checkpoints keep the weights under "ema", on the GPU
    tuned = model.state_dict()
    key = lambda k: k.removeprefix("student_model.")  # a distillation checkpoint wraps the student, and carries the teacher too
    model.load_state_dict({k: stock[key(k)] + share * (v - stock[key(k)]) if v.is_floating_point() and key(k) in stock else v
                           for k, v in tuned.items()})
    torch.save({**saved, "model": model.half(), "ema": None, "optimizer": None}, RUNS / name / "weights" / f"{ckpt}-blend-{share}.pt")


def main() -> int:
    args = sys.argv[1:]
    from ultralytics import YOLO, settings

    settings.update({"sync": False})
    os.chdir(HERE / "data")  # stock weights download here, not into the repo
    if len(args) == 4 and args[0] == "blend":
        blend(args[1], args[2], float(args[3]))
        return 0
    if len(args) == 3 and args[0] == "export":
        export(RUNS / args[1] / "weights" / f"{args[2]}.pt", RUNS / args[1] / f"{args[2]}.onnx")
        return 0
    keep_app_head_weight()
    if len(args) == 2 and args[0] == "resume":
        YOLO(str(RUNS / args[1] / "weights" / "last.pt")).train(resume=True)
    elif args and "=" not in args[0] and all("=" in a for a in args[1:]):
        settings_ = dict(
            data=str(HERE / "data" / "yolo" / "data.yaml"),
            epochs=20,
            patience=0,  # no early stop on all-class accuracy; `evaluate.py select` picks the checkpoint
            save_period=2,
            imgsz=640,
            batch=16,
            freeze=23,  # 23 = everything but the detection head
            optimizer="SGD",  # "auto" would pick its own learning rate and ignore lr0
            lr0=0.002,
            lrf=0.1,
            warmup_epochs=1,
            warmup_bias_lr=0.0,  # the default 0.1 is for training from scratch; it knocks the stock head off
            workers=2,  # four ran this 16 GB laptop out of memory twice
            seed=42,
            project=str(RUNS),
            name=args[0],
            exist_ok=True,
        )
        for a in args[1:]:
            key, value = a.split("=", 1)
            settings_[key] = int(value) if value.isdigit() else float(value) if value.replace(".", "", 1).isdigit() else value
        YOLO("yolo26s.pt").train(**settings_)
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

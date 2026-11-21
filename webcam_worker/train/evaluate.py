#!/usr/bin/env python3
"""Score a model the way the app runs it. Run in .venv-train after `dataset.py build`.

  python evaluate.py score NAME model.onnx model.pt   writes data/results/NAME.json
  python evaluate.py speed BASE base.onnx NEW new.onnx times both in turns (idle machine)
  python evaluate.py compare BASE NEW                 prints the pass checks as a table

Phone scores come from the worker's own detector (detectors.py, ONNX on CPU), and a picture
counts as "phone" if any phone box clears the threshold, as in RESULTS.md. Person and phone
box accuracy on COCO val comes from Ultralytics' validator on the .pt weights.
"""

from __future__ import annotations

import csv
import json
import math
import statistics
import sys
import time
from pathlib import Path

import cv2

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from detectors import CELL_PHONE_CLASS, UltralyticsYoloDetector  # noqa: E402

DATA = HERE / "data"
RESULTS = DATA / "results"
SHIPPED_THRESHOLD = 0.15


def phone_scores(detector: UltralyticsYoloDetector, images: list[Path]) -> list[float]:
    out = []
    for path in images:
        boxes = detector.detect(cv2.imread(str(path)))
        out.append(max((b.score for b in boxes if b.class_id == CELL_PHONE_CLASS), default=0.0))
    return out


def counts(truth: list[int], scores: list[float], threshold: float) -> dict:
    tp = sum(1 for t, s in zip(truth, scores) if t and s >= threshold)
    fp = sum(1 for t, s in zip(truth, scores) if not t and s >= threshold)
    fn = sum(1 for t, s in zip(truth, scores) if t and s < threshold)
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"precision": round(precision, 4), "recall": round(recall, 4), "f1": round(f1, 4),
            "images": len(truth), "with_phone": sum(truth)}


def false_alarms(rows: list, threshold: float) -> float:
    """Share of the pictures with no phone that would raise a reminder."""
    clear = [score for phone, score, _ in rows if not phone]
    return sum(score >= threshold for score in clear) / len(clear)


def pick_threshold(val: list, budget: float) -> float:
    """The threshold with the best validation F1 that raises no more false alarms on validation
    than the shipped model does at 0.15. The same rule for every model, tuned on validation only."""
    grid = [round(0.05 + 0.01 * i, 2) for i in range(91)]
    allowed = [t for t in grid if false_alarms(val, t) <= budget] or [grid[-1]]
    truth, scores = [r[0] for r in val], [r[1] for r in val]
    return max(allowed, key=lambda t: (counts(truth, scores, t)["f1"], t))


def paired(base_rows: list, new_rows: list, tb: float, tn: float, keep) -> str:
    """The pictures the two models disagree on, and McNemar's exact two-sided p: how likely a
    split at least this uneven is if neither model were better."""
    only_new = sum(1 for b, n in zip(base_rows, new_rows) if keep(b) and n[1] >= tn and b[1] < tb)
    only_base = sum(1 for b, n in zip(base_rows, new_rows) if keep(b) and b[1] >= tb and n[1] < tn)
    total = only_new + only_base
    p = min(1.0, 2 * sum(math.comb(total, i) for i in range(min(only_new, only_base) + 1)) / 2 ** total) if total else 1.0
    return f"{only_new} only new, {only_base} only shipped, p={p:.2g}"


def at(rows: list, threshold: float) -> dict:
    out = counts([r[0] for r in rows], [r[1] for r in rows], threshold)
    if any(r[2] == "lookalike" for r in rows):
        looks = [r for r in rows if r[2] == "lookalike"]
        out["lookalike_false_phones"] = round(false_alarms(looks, threshold), 4)
    return out


def val_set() -> tuple[list[Path], list[int]]:
    images = sorted((DATA / "yolo" / "images" / "val").iterdir())
    truth = []
    for img in images:
        label = DATA / "yolo" / "labels" / "val" / (img.stem + ".txt")
        truth.append(int(any(line.split()[0] == "67" for line in label.read_text().splitlines() if line)))
    return images, truth


def image_set(root: Path) -> tuple[list[Path], list[int], list[str]]:
    rows = list(csv.DictReader((root / "labels.csv").open()))
    return [root / "images" / r["image"] for r in rows], [int(r["phone"]) for r in rows], [r["kind"] for r in rows]


def score(name: str, onnx: Path, pt: Path) -> dict:
    """Every picture's highest phone score (val, each test set), and COCO val box accuracy."""
    detector = UltralyticsYoloDetector(onnx, phone_score=0.05, person_score=0.99, threads=4, device="cpu")
    result: dict = {"name": name, "onnx": str(onnx), "pt": str(pt), "scores": {}}
    images, truth = val_set()
    result["scores"]["val"] = [[t, round(sc, 4), ""] for t, sc in zip(truth, phone_scores(detector, images))]
    for root in sorted((DATA / "test").iterdir()):
        images, truth, kinds = image_set(root)
        result["scores"][root.name] = [[t, round(sc, 4), k] for t, sc, k in zip(truth, phone_scores(detector, images), kinds)]

    from ultralytics import YOLO

    metrics = YOLO(str(pt)).val(data=str(DATA / "cocoval" / "data.yaml"), classes=[0, 67], imgsz=640,
                                batch=16, plots=False, verbose=False, project=str(DATA / "valruns"), name=name,
                                exist_ok=True)
    index = {int(c): i for i, c in enumerate(metrics.box.ap_class_index)}
    all_ap = metrics.box.all_ap  # one row per class present, AP at IoU 0.50 ... 0.95
    result["coco_val_boxes"] = {
        cls: {"map50_95": round(float(all_ap[index[cid]].mean()), 4), "map50": round(float(all_ap[index[cid]][0]), 4)}
        for cls, cid in (("person", 0), ("phone", 67))
    }

    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / f"{name}.json").write_text(json.dumps(result))
    print(name, result["coco_val_boxes"])
    return result


def speed(base_name: str, base_onnx: Path, new_name: str, new_onnx: Path) -> None:
    """Both models timed in turns on the same frames, two threads, as the app runs them. Run on an
    idle machine; turns keep any background load fair to both."""
    detectors = {name: UltralyticsYoloDetector(path, phone_score=0.15, person_score=0.35, threads=2, device="cpu")
                 for name, path in ((base_name, base_onnx), (new_name, new_onnx))}
    frames = [cv2.imread(str(p)) for p in image_set(DATA / "test" / "coco605")[0][:100]]
    times: dict[str, list[float]] = {name: [] for name in detectors}
    for frame in frames[:5]:
        for det in detectors.values():
            det.detect(frame)
    for frame in frames:
        for name, det in detectors.items():
            start = time.perf_counter()
            det.detect(frame)
            times[name].append((time.perf_counter() - start) * 1000)
    out = {name: round(statistics.median(t), 1) for name, t in times.items()}
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "speed.json").write_text(json.dumps(out, indent=1))
    print(out)


def compare(base_name: str, new_name: str) -> None:
    base = json.loads((RESULTS / f"{base_name}.json").read_text())
    new = json.loads((RESULTS / f"{new_name}.json").read_text())
    budget = false_alarms(base["scores"]["val"], SHIPPED_THRESHOLD)
    tb, tn = (pick_threshold(m["scores"]["val"], budget) for m in (base, new))
    tests = sorted(k for k in new["scores"] if k not in ("val", "coco605"))
    webcam = {n: [r for k in tests for r in m["scores"][k]] for n, m in ((base_name, base), (new_name, new))}
    rows = []

    def row(label: str, b, n, ok: bool | None = None) -> None:
        rows.append(f"| {label} | {b} | {n} | {'' if ok is None else 'pass' if ok else 'FAIL'} |")

    wb, wn = at(webcam[base_name], tb), at(webcam[new_name], tn)
    row("Threshold (same false-alarm budget on validation)", tb, tn)
    row("Webcam tests, phone F1", wb["f1"], wn["f1"], wn["f1"] > wb["f1"])
    row("Webcam tests, phones caught", wb["recall"], wn["recall"])
    row("  phones caught by one model only", "", paired(webcam[base_name], webcam[new_name], tb, tn, lambda r: r[0] == 1))
    row("Webcam tests, reminders that were right", wb["precision"], wn["precision"])
    for k in tests:
        row(f"  {k}, phones caught", at(base["scores"][k], tb)["recall"], at(new["scores"][k], tn)["recall"])
    cb, cn = at(base["scores"]["coco605"], tb), at(new["scores"]["coco605"], tn)
    row("COCO 605 look-alikes taken for phones", cb["lookalike_false_phones"], cn["lookalike_false_phones"],
        cn["lookalike_false_phones"] <= max(0.04, cb["lookalike_false_phones"]))
    row("  look-alikes taken for phones by one model only", "",
        paired(base["scores"]["coco605"], new["scores"]["coco605"], tb, tn, lambda r: r[2] == "lookalike"))
    row("COCO 605 phone F1", cb["f1"], cn["f1"], cn["f1"] >= cb["f1"] - 0.01)
    bp, np_ = base["coco_val_boxes"]["person"]["map50_95"], new["coco_val_boxes"]["person"]["map50_95"]
    row("COCO val person mAP50-95", bp, np_, np_ >= bp - 0.005)
    row("COCO val phone mAP50-95", base["coco_val_boxes"]["phone"]["map50_95"], new["coco_val_boxes"]["phone"]["map50_95"])
    timing_file = RESULTS / "speed.json"
    timing = json.loads(timing_file.read_text()) if timing_file.is_file() else {}
    if base_name in timing and new_name in timing:
        row("CPU ms a frame, two threads", timing[base_name], timing[new_name], timing[new_name] <= timing[base_name] * 1.1)
    print(f"| Check | {base_name} | {new_name} | |\n|---|---|---|---|")
    print("\n".join(rows))
    print(f"\nFalse-alarm budget: {budget:.3f} of validation pictures with no phone (shipped model at {SHIPPED_THRESHOLD})")


def main() -> int:
    if len(sys.argv) == 5 and sys.argv[1] == "score":
        score(sys.argv[2], Path(sys.argv[3]), Path(sys.argv[4]))
    elif len(sys.argv) == 6 and sys.argv[1] == "speed":
        speed(sys.argv[2], Path(sys.argv[3]), sys.argv[4], Path(sys.argv[5]))
    elif len(sys.argv) == 4 and sys.argv[1] == "compare":
        compare(sys.argv[2], sys.argv[3])
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

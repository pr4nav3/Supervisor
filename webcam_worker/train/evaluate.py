#!/usr/bin/env python3
"""Score a model the way the app runs it. Run in .venv-train after `dataset.py build`.

  python evaluate.py select BASE.pt CANDIDATE.pt ...  picks among runs, on the GPU (selection set only)
  python evaluate.py score NAME model.onnx model.pt    writes data/results/NAME.json
  python evaluate.py speed BASE base.onnx NEW new.onnx  times both in turns (idle machine)
  python evaluate.py compare BASE NEW                  prints the pass checks as a table

Every threshold is set on the selection set, 3,000 COCO training photos of people with no phone
that nothing trains on: each model raises as many false alarms there as the shipped one does at
0.15. Validation pictures come from the training sources, so a fine-tuned model is quieter on them
than anywhere else and they cannot set a fair threshold. Runs are picked with `select`, by
validation phones caught at that threshold; the test sets are scored once, at the end.

Test scores come from the worker's own detector (detectors.py, ONNX on CPU), and a picture counts
as "phone" if any phone box clears the threshold, as in RESULTS.md. Person and phone box accuracy
on COCO val comes from Ultralytics' validator on the .pt weights.
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
DESK = "desk"  # the one test set in the app's own view, relabelled by eye (desk-labels.csv)


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


def matched_threshold(select: list, budget: float) -> float:
    """The lowest threshold that raises no more false alarms on the selection set than the budget."""
    grid = [round(0.05 + 0.01 * i, 2) for i in range(91)]
    return next((t for t in grid if false_alarms(select, t) <= budget), grid[-1])


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


def yolo_set(root: Path) -> tuple[list[Path], list[int]]:
    """A YOLO folder's val pictures, and whether each has a phone box."""
    images = sorted((root / "images" / "val").iterdir())
    truth = []
    for img in images:
        label = root / "labels" / "val" / (img.stem + ".txt")
        truth.append(int(any(line.split()[0] == "67" for line in label.read_text().splitlines() if line)))
    return images, truth


def image_set(root: Path) -> tuple[list[Path], list[int], list[str]]:
    rows = list(csv.DictReader((root / "labels.csv").open()))
    return [root / "images" / r["image"] for r in rows], [int(r["phone"]) for r in rows], [r["kind"] for r in rows]


def score(name: str, onnx: Path, pt: Path) -> dict:
    """Every picture's highest phone score (val, each test set), and COCO val box accuracy."""
    detector = UltralyticsYoloDetector(onnx, phone_score=0.05, person_score=0.99, threads=4, device="cpu")
    result: dict = {"name": name, "onnx": str(onnx), "pt": str(pt), "scores": {}}
    images, truth = yolo_set(DATA / "yolo")
    result["scores"]["val"] = [[t, round(sc, 4), ""] for t, sc in zip(truth, phone_scores(detector, images))]
    images, truth, _ = image_set(DATA / "select" / "coco")
    result["scores"]["select"] = [[t, round(sc, 4), ""] for t, sc in zip(truth, phone_scores(detector, images))]
    for root in sorted((DATA / "test").iterdir()):
        images, truth, kinds = image_set(root)
        result["scores"][root.name] = [[t, round(sc, 4), k] for t, sc, k in zip(truth, phone_scores(detector, images), kinds)]
    images, truth = yolo_set(DATA / "cocoval")  # every COCO val photo with a person or a phone
    result["scores"]["cocoval"] = [[t, round(sc, 4), ""] for t, sc in zip(truth, phone_scores(detector, images))]

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


def select(weights: list[str]) -> None:
    """Candidate runs side by side on the GPU (Ultralytics, the same one-to-many head as the app's
    ONNX): each at the threshold matching the first model's false alarms on the selection set at
    0.15, and the validation phones it then catches, desk-webcam and COCO ones apart: a checkpoint is
    picked by the sum of those two. Test sets are not touched."""
    from ultralytics import YOLO

    val_images, val_truth = yolo_set(DATA / "yolo")
    sel_images, _, _ = image_set(DATA / "select" / "coco")
    budget = None
    print("| Model | threshold | selection false alarms | validation phones caught | validation false alarms |\n|---|---|---|---|---|")
    for w in weights:
        model, scores = YOLO(w), []
        images = [str(p) for p in val_images + sel_images]
        for start in range(0, len(images), 32):
            for r in model.predict(images[start:start + 32], imgsz=640, conf=0.05, classes=[CELL_PHONE_CLASS], verbose=False):
                scores.append(float(r.boxes.conf.max()) if len(r.boxes) else 0.0)
        val = [[t, sc, ""] for t, sc in zip(val_truth, scores[:len(val_images)])]
        sel = [[0, sc, ""] for sc in scores[len(val_images):]]
        if budget is None:
            budget, thr = false_alarms(sel, SHIPPED_THRESHOLD), SHIPPED_THRESHOLD
        else:
            thr = matched_threshold(sel, budget)
        desk = [r for r, p in zip(val, val_images) if p.name.startswith("online-proct")]
        coco = [r for r, p in zip(val, val_images) if p.name.startswith("coco")]
        print(f"| {w} | {thr} | {false_alarms(sel, thr):.4f} | {at(val, thr)['recall']} | desk {at(desk, thr)['recall']} ({sum(r[0] for r in desk)}) | coco {at(coco, thr)['recall']} ({sum(r[0] for r in coco)}) | {false_alarms(val, thr):.4f} |")


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
    budget = false_alarms(base["scores"]["select"], SHIPPED_THRESHOLD)
    tb, tn = SHIPPED_THRESHOLD, matched_threshold(new["scores"]["select"], budget)
    tests = sorted(k for k in new["scores"] if k not in ("val", "select", "coco605", "cocoval", DESK))
    webcam = {n: [r for k in tests for r in m["scores"][k]] for n, m in ((base_name, base), (new_name, new))}
    rows = []

    def row(label: str, b, n, ok: bool | None = None) -> None:
        rows.append(f"| {label} | {b} | {n} | {'' if ok is None else 'pass' if ok else 'FAIL'} |")

    row("Threshold (same false alarms on the selection set)", tb, tn)
    wb, wn = at(webcam[base_name], tb), at(webcam[new_name], tn)
    row("Webcam tests, phones caught", wb["recall"], wn["recall"], wn["recall"] > wb["recall"])
    row("  phones caught by one model only", "", paired(webcam[base_name], webcam[new_name], tb, tn, lambda r: r[0] == 1))
    for k in tests:
        row(f"  {k}, phones caught", at(base["scores"][k], tb)["recall"], at(new["scores"][k], tn)["recall"])
    db, dn = base["scores"][DESK], new["scores"][DESK]
    row("Desk webcam test, phones caught", at(db, tb)["recall"], at(dn, tn)["recall"], at(dn, tn)["recall"] >= at(db, tb)["recall"])
    row("  phones caught by one model only", "", paired(db, dn, tb, tn, lambda r: r[0] == 1))
    row("Desk webcam test, false alarms", round(false_alarms(db, tb), 4), round(false_alarms(dn, tn), 4))
    row("  false alarms by one model only", "", paired(db, dn, tb, tn, lambda r: r[0] == 0))

    # The held-out check on false alarms: 2,900 COCO val photos with no phone. Then both models set to
    # the same number of false alarms there, so a threshold that drifted cannot flatter either one.
    cocob, coconew = base["scores"]["cocoval"], new["scores"]["cocoval"]
    fb, fn = false_alarms(cocob, tb), false_alarms(coconew, tn)
    row("COCO val photos with no phone, false alarms", round(fb, 4), round(fn, 4), fn <= fb * 1.15)
    row("  false alarms by one model only", "", paired(cocob, coconew, tb, tn, lambda r: r[0] == 0))
    allowed = sum(1 for r in cocob if not r[0] and r[1] >= tb)
    same = [sorted((r[1] for r in m if not r[0]), reverse=True)[allowed] + 1e-6 for m in (cocob, coconew)]
    sb, sn = at(webcam[base_name], same[0]), at(webcam[new_name], same[1])
    row(f"Webcam phones caught at {allowed} COCO val false alarms each", sb["recall"], sn["recall"], sn["recall"] > sb["recall"])
    row("  phones caught by one model only", "", paired(webcam[base_name], webcam[new_name], *same, lambda r: r[0] == 1))

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
    print(f"\nSelection-set false alarms allowed: {budget:.4f} (shipped model at {SHIPPED_THRESHOLD})")


def main() -> int:
    if len(sys.argv) >= 3 and sys.argv[1] == "select":
        select(sys.argv[2:])
    elif len(sys.argv) == 5 and sys.argv[1] == "score":
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

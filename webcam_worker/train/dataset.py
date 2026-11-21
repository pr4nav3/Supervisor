#!/usr/bin/env python3
"""Fetch the public sources and build the fine-tuning set. Run in .venv-train.

  python dataset.py fetch    downloads everything into data/raw (resumable)
  python dataset.py build    pseudo-labels, dedupes, splits; writes data/yolo, data/test, data/cocoval

Every picture carries all 80 COCO classes, in COCO numbering so the app's detector is
unchanged: COCO photos as COCO drew them, the rest from the source's own boxes where it has the
class and YOLO26x everywhere else. Sources and licences are in README.md.
"""

from __future__ import annotations

import csv
import io
import json
import os
import random
import re
import shutil
import sys
import time
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
RAW = DATA / "raw"
KEY_FILE = Path.home() / ".supervisor-train" / "roboflow.key"
PHONE = 67
SEED = 42

# Roboflow (workspace, project, role). Train: desk-webcam frames with phone and person boxes.
# Test: four unrelated sources, scored only on "is there a phone in this picture".
ROBOFLOW = [
    ("project-2morrow-software-limited", "online-proctoring-system-x27ou", "train"),
    ("detection-gbx6c", "laptop-and-phone-detection", "train"),
    ("hackhounds", "phone_detection-txozd", "test"),
    ("college-aivcu", "mobile_detection-leiya", "test"),
    ("dwarkadas-j-sanghvi", "phone-usage-detection", "test"),
    ("rose-epnzt", "mobile-usage-detection-so4ig", "test"),
]
# Class names in the Roboflow sets that mean a phone is in the picture, or a person.
PHONE_NAMES = {"cell phone", "phone", "mobile", "person_with_phone", "person_talking_on_phone", "person_using_phone"}
PHONE_BOX_NAMES = {"cell phone", "phone", "mobile"}  # names whose box is the phone itself

COCO_ANN = "http://images.cocodataset.org/annotations/annotations_trainval2017.zip"
COCO_IMG = "http://images.cocodataset.org/{split}/{name}"
COCO_PERSON, COCO_PHONE = 1, 77
# COCO category ids (1-90, ten unused) to the 0-79 class index the model uses.
COCO_INDEX = {cid: i for i, cid in enumerate(c for c in range(1, 91) if c not in {12, 26, 29, 30, 45, 66, 68, 69, 71, 83})}
COCO_LOOKALIKES = {65: "remote", 64: "mouse", 73: "book", 41: "cup", 76: "keyboard", 39: "bottle", 74: "clock"}

OI_CSV = "https://storage.googleapis.com/openimages/v5/{split}-annotations-bbox.csv"
OI_CLASSES = "https://storage.googleapis.com/openimages/v5/class-descriptions-boxable.csv"
OI_IMG = "https://s3.amazonaws.com/open-images-dataset/{split}/{id}.jpg"
OI_PHONE = "Mobile phone"
OI_LOOKALIKES = ["Remote control", "Computer mouse", "Mug", "Coffee cup", "Calculator", "Computer keyboard", "Book"]

CAPS = {"oi_phone": 2000, "oi_lookalike": 1000, "coco_phone": 4803, "coco_lookalike": 1500, "coco_person": 1000}
TEACHER = "yolo26x.pt"  # labels every class a source left unboxed


def log(*parts: object) -> None:
    print(*parts, file=sys.stderr, flush=True)


def download(url: str, dest: Path, quiet: bool = False) -> Path:
    if dest.is_file() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "supervisor-train/1"})
            with urllib.request.urlopen(req, timeout=120) as resp, part.open("wb") as out:
                shutil.copyfileobj(resp, out, 1 << 20)
            part.replace(dest)
            return dest
        except OSError as exc:
            if attempt == 3:
                raise
            if not quiet:
                log(f"retry {dest.name}: {exc}")
            time.sleep(2 * (attempt + 1))
    return dest


def fetch_many(jobs: list[tuple[str, Path]]) -> None:
    from concurrent.futures import ThreadPoolExecutor

    todo = [(u, d) for u, d in jobs if not (d.is_file() and d.stat().st_size > 0)]
    log(f"  {len(jobs) - len(todo)} cached, {len(todo)} to fetch")
    failed = 0
    with ThreadPoolExecutor(16) as pool:
        for future in [pool.submit(download, u, d, True) for u, d in todo]:
            try:
                future.result()
            except OSError:
                failed += 1
    if failed:
        log(f"  {failed} failed; run fetch again to retry")


# ---------------------------------------------------------------- Roboflow


def roboflow_fetch() -> None:
    key = KEY_FILE.read_text(encoding="utf-8").strip()
    for ws, project, _ in ROBOFLOW:
        out = RAW / "roboflow" / project
        if (out / "data.yaml").is_file():
            continue
        base = f"https://api.roboflow.com/{ws}/{project}"
        with urllib.request.urlopen(f"{base}?api_key={key}", timeout=60) as r:
            info = json.load(r)
        version = max(int(v["id"].rsplit("/", 1)[1]) for v in info["versions"])
        for _ in range(60):  # an export not built yet is generated on request
            with urllib.request.urlopen(f"{base}/{version}/yolov8?api_key={key}", timeout=120) as r:
                export = json.load(r).get("export", {})
            if export.get("link"):
                break
            time.sleep(5)
        log(f"roboflow {project} v{version}")
        archive = download(export["link"], RAW / "roboflow" / f"{project}.zip")
        with zipfile.ZipFile(archive) as zf:
            zf.extractall(out)
        archive.unlink()


def roboflow_names(root: Path) -> list[str]:
    text = (root / "data.yaml").read_text(encoding="utf-8")
    match = re.search(r"names:\s*\[(.*?)\]", text, re.S)
    if match:
        return [n.strip().strip("'\"").lower() for n in match.group(1).split(",")]
    return [m.strip().strip("'\"").lower() for m in re.findall(r"^\s*-\s*(.+)$", text.split("names:")[1], re.M)]


def roboflow_items(project: str) -> list[dict]:
    """Every image of a Roboflow export, keeping the boxes of COCO classes in COCO numbering.
    People are left to the teacher: these sources draw them looser than COCO does."""
    root = RAW / "roboflow" / project
    names = roboflow_names(root)
    index = {n: PHONE if n in PHONE_BOX_NAMES else COCO_NAMES.index(n)
             for n in names if (n in PHONE_BOX_NAMES or n in COCO_NAMES) and n != "person"}
    items = []
    for image in sorted(root.glob("*/images/*")):
        label = image.parent.parent / "labels" / (image.stem + ".txt")
        boxes, phone_seen = [], False
        for line in label.read_text().splitlines() if label.is_file() else []:
            parts = line.split()
            if len(parts) != 5:  # polygons and empty lines carry no box here
                continue
            name = names[int(parts[0])]
            phone_seen |= name in PHONE_NAMES
            cls = index.get(name)
            if cls is not None:
                boxes.append((cls, *map(float, parts[1:])))
        # Roboflow appends "_jpg.rf.<hash>"; augmented copies of a frame share what comes before.
        original = re.sub(r"_(jpg|jpeg|png)\.rf\.[0-9a-f]+$", "", image.stem)
        # Frames cut from a video ("final-2_mp4-0123"): neighbours are near copies, so a stretch
        # of 300 frames (roughly one person's sitting) is the unit for de-duplication and the split.
        frame = re.match(r"^(.*)_mp4-(\d+)$", original)
        group = f"{frame.group(1)}:{int(frame.group(2)) // 300}" if frame else original
        items.append({"path": image, "boxes": boxes, "phone": phone_seen, "original": original,
                      "group": f"{project}:{group}", "source": project, "labelled": set(index.values())})
    return items


# ---------------------------------------------------------------- COCO


def coco_json(split: str) -> dict:
    target = RAW / "coco" / "annotations" / f"instances_{split}.json"
    if not target.is_file():
        archive = download(COCO_ANN, RAW / "coco" / "annotations_trainval2017.zip")
        with zipfile.ZipFile(archive) as zf:
            for name in ("annotations/instances_train2017.json", "annotations/instances_val2017.json"):
                zf.extract(name, RAW / "coco")
        archive.unlink()
    return json.loads(target.read_text(encoding="utf-8"))


def coco_index(data: dict) -> tuple[dict, dict]:
    images = {img["id"]: img for img in data["images"]}
    anns = defaultdict(list)
    for ann in data["annotations"]:
        anns[ann["image_id"]].append(ann)
    return images, anns


def coco_boxes(img: dict, anns: list[dict]) -> list[tuple]:
    out = []
    for ann in anns:
        cls = COCO_INDEX[ann["category_id"]]
        if ann.get("iscrowd"):
            continue
        x, y, w, h = ann["bbox"]
        out.append((cls, (x + w / 2) / img["width"], (y + h / 2) / img["height"], w / img["width"], h / img["height"]))
    return out


def coco_605(val: dict) -> list[tuple[int, int, str]]:
    """The 605-photo set from RESULTS.md, rebuilt exactly as the old eval builder did (seed 42)."""
    phone_images, person_images, hard = set(), set(), {}
    for ann in val["annotations"]:
        img_id, cat = ann["image_id"], ann["category_id"]
        if cat == COCO_PHONE:
            phone_images.add(img_id)
        if cat == COCO_PERSON:
            person_images.add(img_id)
        if cat in COCO_LOOKALIKES:
            hard.setdefault(img_id, set()).add(COCO_LOOKALIKES[cat])
    hard_only = [i for i, tags in hard.items() if i not in phone_images and tags]
    person_no_phone = [i for i in person_images if i not in phone_images]
    rng = random.Random(42)
    phone_pool = list(phone_images)
    rng.shuffle(phone_pool)
    rng.shuffle(hard_only)
    neg = hard_only[:250]
    rng.shuffle(person_no_phone)
    rows = [(i, 1, "phone") for i in phone_pool] + [(i, 0, "lookalike") for i in neg]
    rows += [(i, 0, "person") for i in person_no_phone[:150] if i not in neg]
    return rows


def coco_fetch() -> None:
    train, val = coco_json("train2017"), coco_json("val2017")
    jobs = []
    for split, data, ids in (("train2017", train, coco_replay_ids(train)), ("val2017", val, coco_val_ids(val))):
        images = {img["id"]: img for img in data["images"]}
        for i in ids:
            name = images[i]["file_name"]
            jobs.append((COCO_IMG.format(split=split, name=name), RAW / "coco" / split / name))
    log(f"coco: {len(jobs)} images")
    fetch_many(jobs)


def coco_replay_ids(train: dict) -> list[int]:
    """Training replay, fully labelled by COCO: every photo with a phone, photos of phone
    look-alikes (remote, mouse, book...) with no phone, and photos of people with no phone."""
    images, anns = coco_index(train)
    phone = sorted(i for i, a in anns.items() if any(x["category_id"] == COCO_PHONE for x in a))
    look = sorted(i for i, a in anns.items() if i not in set(phone) and any(x["category_id"] in COCO_LOOKALIKES for x in a))
    person = sorted(i for i, a in anns.items() if i not in set(phone) and any(x["category_id"] == COCO_PERSON for x in a))
    rng = random.Random(SEED)
    chosen = rng.sample(phone, min(CAPS["coco_phone"], len(phone)))
    chosen += rng.sample(person, CAPS["coco_person"])
    picked = set(chosen)
    return chosen + rng.sample([i for i in look if i not in picked], CAPS["coco_lookalike"])


def coco_val_ids(val: dict) -> list[int]:
    """All val2017 photos with a person or a phone, the 605 set, and 300 with neither."""
    _, anns = coco_index(val)
    keep = {i for i, a in anns.items() if any(x["category_id"] in (COCO_PERSON, COCO_PHONE) for x in a)}
    keep |= {i for i, _, _ in coco_605(val)}
    rest = sorted(img["id"] for img in val["images"] if img["id"] not in keep)
    return sorted(keep) + random.Random(SEED).sample(rest, 300)


# ---------------------------------------------------------------- Open Images


def oi_fetch() -> None:
    names = {}
    for row in csv.reader(io.StringIO(download(OI_CLASSES, RAW / "oi" / "classes.csv").read_text(encoding="utf-8"))):
        names[row[0]] = row[1]
    wanted = {mid for mid, name in names.items() if name in OI_LOOKALIKES + [OI_PHONE]}
    per_image: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for split in ("validation", "test"):
        path = download(OI_CSV.format(split=split), RAW / "oi" / f"{split}-bbox.csv")
        with path.open(encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                if row["LabelName"] in wanted:
                    per_image[(split, row["ImageID"])].append(row)
    phone, look = [], []
    for key, rows in per_image.items():
        labels = {names[r["LabelName"]] for r in rows}
        if any(r["IsDepiction"] == "1" for r in rows):
            continue  # drawings and screens of phones are not what a webcam sees
        (phone if OI_PHONE in labels else look).append(key)
    rng = random.Random(SEED)
    phone, look = sorted(phone), sorted(look)
    chosen = rng.sample(phone, min(CAPS["oi_phone"], len(phone))) + rng.sample(look, min(CAPS["oi_lookalike"], len(look)))
    log(f"open images: {len(phone)} phone photos, {len(look)} look-alike photos available; taking {len(chosen)}")
    keep = {k: per_image[k] for k in chosen}
    (RAW / "oi" / "chosen.json").write_text(json.dumps({f"{s}/{i}": rows for (s, i), rows in keep.items()}))
    fetch_many([(OI_IMG.format(split=s, id=i), RAW / "oi" / s / f"{i}.jpg") for s, i in keep])


def oi_items() -> list[dict]:
    chosen = json.loads((RAW / "oi" / "chosen.json").read_text())
    items = []
    for key, rows in chosen.items():
        split, image_id = key.split("/")
        path = RAW / "oi" / split / f"{image_id}.jpg"
        if not path.is_file():
            continue
        boxes = []
        for r in rows:
            if r["LabelName"] == "/m/050k8":  # Mobile phone
                x1, x2, y1, y2 = (float(r[k]) for k in ("XMin", "XMax", "YMin", "YMax"))
                boxes.append((PHONE, (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1))
        items.append({"path": path, "boxes": boxes, "phone": bool(boxes), "original": image_id,
                      "group": f"oi:{image_id}", "source": "openimages", "labelled": {PHONE},
                      "lookalike": not boxes})
    return items


# ---------------------------------------------------------------- build

def box_iou(a: tuple, b: tuple) -> float:
    ax1, ay1, ax2, ay2 = a[0] - a[2] / 2, a[1] - a[3] / 2, a[0] + a[2] / 2, a[1] + a[3] / 2
    bx1, by1, bx2, by2 = b[0] - b[2] / 2, b[1] - b[3] / 2, b[0] + b[2] / 2, b[1] + b[3] / 2
    inter = max(0.0, min(ax2, bx2) - max(ax1, bx1)) * max(0.0, min(ay2, by2) - max(ay1, by1))
    return inter / (a[2] * a[3] + b[2] * b[3] - inter + 1e-9)


def phone_box_guard(items: list[dict]) -> list[dict]:
    """Keep a Roboflow picture only if the teacher also sees each of its phones, even faintly
    (a teacher phone at confidence 0.1 or more overlapping it by IoU above 0.3), and give each
    box the teacher's tighter, COCO-style outline. Checked by eye on 2026-11-20: the boxes the
    teacher cannot confirm include office chairs, books held up to the camera and hands, and a
    model trained on them took calculators and paperbacks for phones. Dropping just the box would
    leave a real phone unlabelled, so the whole picture goes."""
    from ultralytics import YOLO

    check = [it for it in items if it["source"] not in ("coco", "openimages") and any(b[0] == PHONE for b in it["boxes"])]
    model = YOLO(TEACHER)
    bad = set()
    for start in range(0, len(check), 32):
        batch = check[start:start + 32]
        for it, res in zip(batch, model.predict([str(i["path"]) for i in batch], classes=[PHONE],
                                                 conf=0.1, imgsz=640, verbose=False)):
            seen = res.boxes.xywhn.tolist()
            boxes = []
            for b in it["boxes"]:
                best = max(seen, key=lambda t: box_iou(b[1:], t), default=None)
                if b[0] != PHONE:
                    boxes.append(b)
                elif best is not None and box_iou(b[1:], best) > 0.3:
                    boxes.append((PHONE, *best))
                else:
                    bad.add(id(it))
            it["boxes"] = boxes
    by_source = defaultdict(lambda: [0, 0])
    for it in check:
        by_source[it["source"]][0] += 1
        by_source[it["source"]][1] += id(it) in bad
    log("phone-box check, pictures dropped: " + ", ".join(f"{k} {v[1]} of {v[0]}" for k, v in sorted(by_source.items())))
    return [it for it in items if id(it) not in bad]


def ahash(path: Path) -> int | None:
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        return None
    small = cv2.resize(img, (16, 16), interpolation=cv2.INTER_AREA)
    bits = (small > small.mean()).flatten()
    return int("".join("1" if b else "0" for b in bits), 2)


def dedupe(items: list[dict], max_bits: int = 12) -> list[dict]:
    """One copy per original frame, then drop frames within `max_bits` of 256 of a kept one in the
    same group (neighbouring video frames). Hamming search is per group, so it stays small."""
    by_original = {}
    for it in items:
        by_original.setdefault((it["source"], it["original"]), it)
    kept, seen = [], defaultdict(list)
    for it in by_original.values():
        h = ahash(it["path"])
        if h is None:
            continue
        it["hash"] = h
        if any(bin(h ^ other).count("1") <= max_bits for other in seen[it["group"]]):
            continue
        seen[it["group"]].append(h)
        kept.append(it)
    return kept


def teacher_fill(items: list[dict]) -> None:
    """Boxes a source never drew, from the big model at confidence 0.5: every COCO class the
    source has no boxes for, people included. Left unboxed, a laptop or a remote is taught as
    background, and the model forgets it (the first run lost 4.5 points of person mAP and took
    18 % of COCO's look-alikes for phones)."""
    from ultralytics import YOLO

    need = [it for it in items if len(it["labelled"]) < len(COCO_NAMES)]
    if not need:
        return
    model = YOLO(TEACHER)
    log(f"teacher {TEACHER} on {len(need)} images")
    for start in range(0, len(need), 32):
        batch = need[start:start + 32]
        for it, res in zip(batch, model.predict([str(i["path"]) for i in batch], conf=0.5, imgsz=640,
                                                 verbose=False)):
            for (cx, cy, w, h), cls in zip(res.boxes.xywhn.tolist(), res.boxes.cls.int().tolist()):
                if cls not in it["labelled"]:
                    it["boxes"].append((cls, cx, cy, w, h))
                    it["phone"] |= cls == PHONE


def teacher_lookalike_guard(items: list[dict]) -> list[dict]:
    """Look-alike photos are only useful if they really have no phone: drop any the big model
    sees a phone in, since Open Images leaves unverified phones unboxed."""
    from ultralytics import YOLO

    model = YOLO(TEACHER)
    clean = []
    for start in range(0, len(items), 32):
        batch = items[start:start + 32]
        for it, res in zip(batch, model.predict([str(i["path"]) for i in batch], classes=[PHONE],
                                                 conf=0.35, imgsz=640, verbose=False)):
            if len(res.boxes) == 0:
                clean.append(it)
    log(f"look-alikes: kept {len(clean)} of {len(items)} with no phone the teacher can see")
    return clean


def place(item: dict, split: str, root: Path, index: int) -> None:
    name = f"{item['source'][:12]}_{index:06d}"
    img_dir, lbl_dir = root / "images" / split, root / "labels" / split
    img_dir.mkdir(parents=True, exist_ok=True)
    lbl_dir.mkdir(parents=True, exist_ok=True)
    dest = img_dir / (name + item["path"].suffix.lower())
    if not dest.exists():
        try:
            os.link(item["path"], dest)
        except OSError:
            shutil.copy2(item["path"], dest)
    lines = [f"{c} {x:.6f} {y:.6f} {w:.6f} {h:.6f}" for c, x, y, w, h in item["boxes"]]
    (lbl_dir / (name + ".txt")).write_text("\n".join(lines) + ("\n" if lines else ""))


def build() -> None:
    os.chdir(DATA)  # the teacher's weights download here, not next to the scripts
    rng = random.Random(SEED)
    train_items = []
    for ws, project, role in ROBOFLOW:
        if role == "train":
            train_items += roboflow_items(project)
    train_items += oi_items()
    looks = [it for it in train_items if it.get("lookalike")]
    train_items = [it for it in train_items if not it.get("lookalike")] + teacher_lookalike_guard(looks)

    coco_train = coco_json("train2017")
    images, anns = coco_index(coco_train)
    for i in coco_replay_ids(coco_train):
        img = images[i]
        path = RAW / "coco" / "train2017" / img["file_name"]
        if path.is_file():
            boxes = coco_boxes(img, anns[i])
            train_items.append({"path": path, "boxes": boxes, "phone": any(b[0] == PHONE for b in boxes),
                                "original": img["file_name"], "group": f"coco:{i}", "source": "coco",
                                "labelled": set(range(len(COCO_NAMES)))})

    before = len(train_items)
    train_items = dedupe(train_items)
    log(f"train pool: {before} files, {len(train_items)} after one copy per frame and near-duplicate removal")

    # Test sets: unrelated sources. Any test image that matches a training image is dropped.
    train_hashes = {it["hash"] for it in train_items}
    tests: dict[str, list[dict]] = {}
    for ws, project, role in ROBOFLOW:
        if role == "test":
            items = dedupe(roboflow_items(project), max_bits=0)
            tests[project] = [it for it in items if all(bin(it["hash"] ^ h).count("1") > 6 for h in train_hashes)]
            log(f"test {project}: {len(tests[project])} images, {sum(i['phone'] for i in tests[project])} with a phone")

    train_items = phone_box_guard(train_items)
    teacher_fill(train_items)

    # Split by group (a video, or one photo): 90 % train, 10 % val.
    groups = sorted({it["group"] for it in train_items})
    rng.shuffle(groups)
    val_groups = set(groups[: max(1, len(groups) // 10)])
    yolo = DATA / "yolo"
    if yolo.exists():
        shutil.rmtree(yolo)
    counts = defaultdict(lambda: defaultdict(int))
    for n, it in enumerate(train_items):
        split = "val" if it["group"] in val_groups else "train"
        place(it, split, yolo, n)
        counts[split][it["source"]] += 1
        counts[split]["phone images"] += it["phone"]
    names = "\n".join(f"  {i}: {n}" for i, n in enumerate(COCO_NAMES))
    (yolo / "data.yaml").write_text(f"path: {yolo.as_posix()}\ntrain: images/train\nval: images/val\nnames:\n{names}\n")

    # Image-level test sets: a folder of images and a CSV of phone yes/no.
    test_root = DATA / "test"
    if test_root.exists():
        shutil.rmtree(test_root)
    for project, items in tests.items():
        write_image_set(test_root / project, [(it["path"], int(it["phone"]), "") for it in items])
    val = coco_json("val2017")
    vimages, vanns = coco_index(val)
    write_image_set(test_root / "coco605", [(RAW / "coco" / "val2017" / vimages[i]["file_name"], phone, kind)
                                            for i, phone, kind in coco_605(val)])

    # COCO val boxes for the forgetting check (person and phone mAP).
    cocoval = DATA / "cocoval"
    if cocoval.exists():
        shutil.rmtree(cocoval)
    for n, i in enumerate(coco_val_ids(val)):
        img = vimages[i]
        path = RAW / "coco" / "val2017" / img["file_name"]
        if path.is_file():
            place({"path": path, "boxes": coco_boxes(img, vanns[i]), "source": "cocoval"}, "val", cocoval, n)
    (cocoval / "data.yaml").write_text(f"path: {cocoval.as_posix()}\ntrain: images/val\nval: images/val\nnames:\n{names}\n")

    summary = {split: dict(c) for split, c in counts.items()}
    summary["test"] = {p: {"images": len(v), "with phone": sum(i["phone"] for i in v)} for p, v in tests.items()}
    (DATA / "summary.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary, indent=1))


def write_image_set(root: Path, rows: list[tuple[Path, int, str]]) -> None:
    (root / "images").mkdir(parents=True, exist_ok=True)
    with (root / "labels.csv").open("w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["image", "phone", "kind"])
        for n, (path, phone, kind) in enumerate(rows):
            if not path.is_file():
                continue
            dest = root / "images" / f"{n:05d}{path.suffix.lower()}"
            try:
                os.link(path, dest)
            except OSError:
                shutil.copy2(path, dest)
            writer.writerow([dest.name, phone, kind])


COCO_NAMES = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light",
    "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
    "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
    "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard",
    "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
    "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
    "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard",
    "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase",
    "scissors", "teddy bear", "hair drier", "toothbrush",
]


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in ("fetch", "build"):
        print(__doc__)
        return 2
    if sys.argv[1] == "fetch":
        roboflow_fetch()
        coco_fetch()
        oi_fetch()
    else:
        build()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Ultralytics YOLO ONNX detector for phone (COCO cell phone) and person, on CPU or GPU."""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple

import cv2
import numpy as np
import onnxruntime as ort

# COCO class indices (Ultralytics / YOLO training order).
PERSON_CLASS = 0
CELL_PHONE_CLASS = 67
INPUT_SIZE = 640

# Windows ships onnxruntime-directml (any DirectX 12 GPU); macOS onnxruntime includes CoreML.
GPU_PROVIDERS = {
    "win32": ("DmlExecutionProvider", {}),
    "darwin": ("CoreMLExecutionProvider", {"ModelFormat": "MLProgram"}),
}


def create_session(onnx_path: Path, device: str, threads: int) -> ort.InferenceSession:
    """CPU, or the platform GPU provider. GPU mode fails loudly instead of running on CPU."""
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = threads
    opts.inter_op_num_threads = 1
    if device == "cpu":
        return ort.InferenceSession(str(onnx_path), sess_options=opts, providers=["CPUExecutionProvider"])

    if sys.platform not in GPU_PROVIDERS:
        raise RuntimeError(f"GPU mode is not supported on {sys.platform}")
    name, options = GPU_PROVIDERS[sys.platform]
    if name not in ort.get_available_providers():
        raise RuntimeError(f"GPU mode needs {name}, which this onnxruntime build does not include")
    # DirectML cannot use memory patterns or parallel execution.
    opts.enable_mem_pattern = False
    opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    session = ort.InferenceSession(
        str(onnx_path), sess_options=opts, providers=[(name, options), "CPUExecutionProvider"]
    )
    if session.get_providers()[0] != name:
        raise RuntimeError(f"GPU mode: {name} could not start on this computer (no usable GPU?)")
    return session


@dataclass(frozen=True)
class Box:
    x: float
    y: float
    w: float
    h: float
    score: float
    class_id: int


def letterbox(bgr: np.ndarray, size: int, pad: int = 114) -> Tuple[np.ndarray, float]:
    height, width = bgr.shape[:2]
    scale = min(size / height, size / width)
    new_w = int(round(width * scale))
    new_h = int(round(height * scale))
    resized = cv2.resize(bgr, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    canvas = np.full((size, size, 3), pad, dtype=np.uint8)
    canvas[:new_h, :new_w] = resized
    return canvas, scale


def nms_per_class(boxes: List[Box], iou: float = 0.45) -> List[Box]:
    kept: List[Box] = []
    for class_id in {b.class_id for b in boxes}:
        group = [b for b in boxes if b.class_id == class_id]
        keep = cv2.dnn.NMSBoxes(
            [[b.x, b.y, b.w, b.h] for b in group], [b.score for b in group], 0.0, iou
        )
        kept.extend(group[int(i)] for i in np.array(keep).reshape(-1))
    return kept


class UltralyticsYoloDetector:
    """YOLO11 / YOLO26 ONNX export with raw (1, 84, anchors) output; NMS done here."""

    def __init__(
        self,
        onnx_path: Path,
        phone_score: float,
        person_score: float,
        threads: int,
        device: str,
    ):
        self._session = create_session(onnx_path, device, threads)
        self.provider = self._session.get_providers()[0]
        self._thresholds: Dict[int, float] = {
            CELL_PHONE_CLASS: phone_score,
            PERSON_CLASS: person_score,
        }
        self._input_name = self._session.get_inputs()[0].name

    def _decode(self, raw: np.ndarray, scale: float) -> List[Box]:
        # (1, 4 + classes, anchors) -> (anchors, 4 + classes). Each class is scored on
        # its own column so a phone next to a face is not hidden by a stronger "person".
        preds = raw[0].T
        out: List[Box] = []
        for class_id, thresh in self._thresholds.items():
            scores = preds[:, 4 + class_id]
            keep = scores >= thresh
            for (cx, cy, w, h), score in zip(preds[keep, :4], scores[keep]):
                out.append(
                    Box(
                        float((cx - w / 2.0) / scale),
                        float((cy - h / 2.0) / scale),
                        float(w / scale),
                        float(h / scale),
                        float(score),
                        class_id,
                    )
                )
        return out

    def _run_view(self, bgr: np.ndarray) -> List[Box]:
        padded, scale = letterbox(bgr, INPUT_SIZE)
        rgb = padded[:, :, ::-1].astype(np.float32) / 255.0
        blob = np.ascontiguousarray(np.transpose(rgb, (2, 0, 1))[None])
        raw = self._session.run(None, {self._input_name: blob})[0]
        return self._decode(raw, scale)

    def detect(self, bgr: np.ndarray) -> List[Box]:
        height, width = bgr.shape[:2]
        boxes: List[Box] = []
        for box in self._run_view(bgr):
            x1 = min(max(box.x, 0.0), float(width - 1))
            y1 = min(max(box.y, 0.0), float(height - 1))
            x2 = min(box.x + box.w, float(width))
            y2 = min(box.y + box.h, float(height))
            if x2 - x1 < 8 or y2 - y1 < 8:
                continue
            boxes.append(Box(x1, y1, x2 - x1, y2 - y1, box.score, box.class_id))
        return nms_per_class(boxes)

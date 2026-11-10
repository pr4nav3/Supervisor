#!/usr/bin/env python3
"""Supervisor Chatterbox Nano phrase generator.

CLI one-shot still works. `--serve` keeps the model loaded and reads one JSON
request per stdin line until stdin closes. The desktop app owns the process.
"""

from __future__ import annotations

import argparse
import json
import multiprocessing
import os
import re
import sys
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, TextIO, Tuple


WORKER_API_VERSION = 1


class WorkerError(Exception):
    """Expected input/setup failure."""


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", value.strip().lower()).strip("_")
    return slug or "phrase"


def read_json(path: Path) -> Dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError as exc:
        raise WorkerError(f"File not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise WorkerError(f"Invalid JSON in {path}: {exc}") from exc

    if not isinstance(data, dict):
        raise WorkerError(f"Expected a JSON object in {path}")
    return data


def write_json(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, sort_keys=True)
        handle.write("\n")


def load_phrases(path: Path) -> List[Dict[str, str]]:
    data = read_json(path)
    return normalize_phrases(data.get("phrases"))


def normalize_phrases(phrases: Any) -> List[Dict[str, str]]:
    if not isinstance(phrases, list) or not phrases:
        raise WorkerError("request must contain a non-empty 'phrases' list")

    normalized: List[Dict[str, str]] = []
    seen_ids = set()
    for index, item in enumerate(phrases, start=1):
        if not isinstance(item, dict):
            raise WorkerError(f"Phrase {index} must be an object")
        phrase_id = str(item.get("id") or "").strip()
        tone = str(item.get("tone") or "").strip()
        text = str(item.get("text") or "").strip()
        if not phrase_id:
            raise WorkerError(f"Phrase {index} is missing 'id'")
        if not tone:
            raise WorkerError(f"Phrase {index} is missing 'tone'")
        if not text:
            raise WorkerError(f"Phrase {index} is missing 'text'")
        if phrase_id in seen_ids:
            raise WorkerError(f"Duplicate phrase id: {phrase_id}")
        seen_ids.add(phrase_id)
        normalized.append({"id": phrase_id, "tone": tone, "text": text})
    return normalized


def patch_perth_watermarker() -> None:
    try:
        import perth
    except Exception:
        return

    class NoOpWatermarker:
        def apply_watermark(self, wav: Any, sample_rate: int, **_: Any) -> Any:
            return wav

    perth.PerthImplicitWatermarker = NoOpWatermarker


def load_model(args: argparse.Namespace) -> tuple[Any, Any]:
    try:
        import torch
        from chatterbox.tts_turbo import ChatterboxTurboTTS
    except Exception as exc:
        raise WorkerError(f"Could not import the Chatterbox Nano runtime: {exc}") from exc

    if args.seed is not None:
        torch.manual_seed(args.seed)

    patch_perth_watermarker()
    model = ChatterboxTurboTTS.from_local(str(args.model_dir), device=args.device, nano=True)
    return model, torch


def configure_runtime_environment(cache_dir: Path) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    hf_home = cache_dir / ".hf_cache"
    os.environ.setdefault("HF_HOME", str(hf_home))
    os.environ.setdefault("HF_HUB_CACHE", str(hf_home / "hub"))
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", str(hf_home / "hub"))
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("NUMBA_CACHE_DIR", str(cache_dir / ".numba_cache"))


def generate_clip(
    args: argparse.Namespace,
    model: Any,
    torch_module: Any,
    phrase: Dict[str, str],
    output_path: Path,
) -> Dict[str, Any]:
    import torchaudio as ta

    wav = model.generate(
        phrase["text"],
        temperature=args.temperature,
        top_p=args.top_p,
        top_k=args.top_k,
        repetition_penalty=args.repetition_penalty,
    )
    save_wav = wav.detach().cpu() if hasattr(wav, "detach") else torch_module.as_tensor(wav).detach().cpu()
    if len(save_wav.shape) == 1:
        save_wav = save_wav.unsqueeze(0)

    ta.save(str(output_path), save_wav, model.sr, encoding="PCM_S", bits_per_sample=16)
    return {"phrase_id": phrase["id"], "path": str(output_path.resolve())}


def generate_phrases(
    args: argparse.Namespace,
    model: Any,
    torch_module: Any,
    phrases: List[Dict[str, str]],
    out_dir: Path,
    reference: Path,
    current_reference: Optional[Path],
    overwrite: bool,
) -> Tuple[List[Dict[str, Any]], Path]:
    if not reference.exists():
        raise WorkerError(f"Reference audio not found: {reference}")
    if out_dir.exists() and any(out_dir.iterdir()) and not overwrite:
        raise WorkerError(f"Output directory is not empty: {out_dir}")

    clips_dir = out_dir / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)

    resolved = reference.resolve()
    if resolved != current_reference:
        model.prepare_conditionals(str(resolved))

    clips: List[Dict[str, Any]] = []
    for index, phrase in enumerate(phrases, start=1):
        output_path = clips_dir / f"{index:02d}_{slugify(phrase['id'])}.wav"
        if output_path.exists() and not overwrite:
            raise WorkerError(f"Clip already exists: {output_path}")
        clips.append(generate_clip(args, model, torch_module, phrase, output_path))
    return clips, resolved


def run(args: argparse.Namespace) -> int:
    if not args.model_dir.exists():
        raise WorkerError(f"Model directory not found: {args.model_dir}")
    phrases = load_phrases(args.phrases)
    configure_runtime_environment(args.cache_dir or args.out_dir)

    model, torch_module = load_model(args)
    clips, _ = generate_phrases(
        args,
        model,
        torch_module,
        phrases,
        args.out_dir,
        args.reference,
        None,
        args.overwrite,
    )
    # The starter-clip scripts read this to find each take.
    write_json(args.out_dir / "worker_report.json", {"clips": clips})
    return 0


def reply(stream: TextIO, payload: Dict[str, Any]) -> None:
    stream.write(json.dumps(payload, separators=(",", ":")) + "\n")
    stream.flush()


def serve(args: argparse.Namespace) -> int:
    # The app speaks UTF-8 JSON, but a frozen Windows build defaults to the ANSI code page
    # (cp1252), which garbles accented paths and line text. PYTHONUTF8 does not reach a
    # PyInstaller build, so set it here.
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    if not args.model_dir.exists():
        raise WorkerError(f"Model directory not found: {args.model_dir}")
    configure_runtime_environment(args.cache_dir or args.model_dir)

    # Libraries print to stdout. Keep JSON replies on the original pipe.
    replies = sys.stdout
    sys.stdout = sys.stderr

    model = None
    torch_module = None
    current_reference: Optional[Path] = None

    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            reply(replies, {"ok": False, "id": None, "error": f"invalid json: {exc}"})
            continue
        if not isinstance(request, dict):
            reply(replies, {"ok": False, "id": None, "error": "request must be an object"})
            continue

        request_id = request.get("id")
        op = str(request.get("op") or "generate")
        if op != "generate":
            reply(replies, {"ok": False, "id": request_id, "error": f"unknown op: {op}"})
            continue

        try:
            phrases = normalize_phrases(request.get("phrases"))
            reference = Path(str(request.get("reference") or "")).expanduser()
            out_dir = Path(str(request.get("out_dir") or "")).expanduser()
            if not str(reference) or not str(out_dir):
                raise WorkerError("generate requires reference and out_dir")
            overwrite = bool(request.get("overwrite", True))

            if model is None:
                model, torch_module = load_model(args)

            _, current_reference = generate_phrases(
                args,
                model,
                torch_module,
                phrases,
                out_dir,
                reference.resolve(),
                current_reference,
                overwrite,
            )
            reply(replies, {"ok": True, "id": request_id, "loaded": True})
        except WorkerError as exc:
            reply(
                replies,
                {
                    "ok": False,
                    "id": request_id,
                    "error": str(exc),
                    "loaded": model is not None,
                },
            )
        except Exception as exc:
            # The model is still good; keep serving so the app's "loaded" flag stays true.
            traceback.print_exc(file=sys.stderr)
            reply(
                replies,
                {
                    "ok": False,
                    "id": request_id,
                    "error": str(exc),
                    "loaded": model is not None,
                },
            )
    return 0


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Supervisor voice clips with Chatterbox Nano.")
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--reference", type=Path)
    parser.add_argument("--phrases", type=Path)
    parser.add_argument("--out-dir", type=Path)
    parser.add_argument("--cache-dir", type=Path)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--seed", type=int)
    parser.add_argument("--temperature", type=float, default=0.8)
    parser.add_argument("--top-p", type=float, default=0.95)
    parser.add_argument("--top-k", type=int, default=1000)
    parser.add_argument("--repetition-penalty", type=float, default=1.2)
    args = parser.parse_args(argv)
    args.model_dir = args.model_dir.expanduser().resolve()
    if args.cache_dir:
        args.cache_dir = args.cache_dir.expanduser().resolve()
    if args.serve:
        return args
    if not args.reference or not args.phrases or not args.out_dir:
        raise WorkerError("--reference, --phrases, and --out-dir are required unless --serve")
    args.reference = args.reference.expanduser().resolve()
    args.phrases = args.phrases.expanduser().resolve()
    args.out_dir = args.out_dir.expanduser().resolve()
    return args


def self_check() -> int:
    phrases = normalize_phrases(
        [{"id": "hi", "tone": "gentle", "text": "Back to the task."}]
    )
    assert phrases[0]["id"] == "hi"
    try:
        normalize_phrases([])
        raise AssertionError("empty phrases should fail")
    except WorkerError:
        pass
    request = json.loads(
        '{"op":"generate","id":"1","reference":"ref.wav","out_dir":"out","phrases":[{"id":"a","tone":"gentle","text":"Hi."}]}'
    )
    assert request["op"] == "generate" and len(normalize_phrases(request["phrases"])) == 1
    print("self-check ok")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    multiprocessing.freeze_support()
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv == ["--self-check"]:
        return self_check()
    try:
        args = parse_args(argv)
        return serve(args) if args.serve else run(args)
    except WorkerError as exc:
        print(f"voice worker error: {exc}", file=sys.stderr)
        return 2
    except Exception:
        traceback.print_exc(file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

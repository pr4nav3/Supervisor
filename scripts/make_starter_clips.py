"""Make the bundled starter clips: the lines in scripts/starter_lines.json, for Derek and Elise.

Each line is generated once per seed; the take whose length sits closest to what its word count
predicts is kept (the model sometimes drops or doubles a word, and those takes come out short or
long). Output: src-tauri/voices/<voice>/<line id>.wav. Without --ids every clip is remade; with
--ids only those lines are made and the rest are kept. Either way, a clip whose id is no longer in
the list is removed.

    .venv-voice-runtime-windows/Scripts/python scripts/make_starter_clips.py --model-dir ... --work ...
    .venv-voice-runtime-windows/Scripts/python scripts/make_starter_clips.py ... --ids mom_grounded
"""
import argparse
import json
import pathlib
import shutil
import subprocess
import sys
import wave

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKER = ROOT / "voice_worker" / "chatterbox_nano_worker.py"
LINES = ROOT / "scripts" / "starter_lines.json"
VOICES = ROOT / "src-tauri" / "voices"
SECONDS_PER_WORD = 0.36


def seconds(path: pathlib.Path) -> float:
    with wave.open(str(path)) as clip:
        return clip.getnframes() / clip.getframerate()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=pathlib.Path, required=True)
    parser.add_argument("--work", type=pathlib.Path, required=True, help="scratch folder for the takes")
    parser.add_argument("--seeds", type=int, nargs="+", default=[11, 22, 23])
    parser.add_argument("--voices", nargs="+", default=["derek", "elise"])
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--ids", nargs="*", help="only these line ids; the other clips are kept")
    args = parser.parse_args()

    phrases = json.loads(LINES.read_text(encoding="utf-8"))["phrases"]
    wanted = [p for p in phrases if not args.ids or p["id"] in args.ids]
    lines_file = LINES
    if args.ids:
        missing = set(args.ids) - {p["id"] for p in wanted}
        if missing:
            raise SystemExit(f"not in {LINES.name}: {sorted(missing)}")
        args.work.mkdir(parents=True, exist_ok=True)
        lines_file = args.work / "lines.json"
        lines_file.write_text(json.dumps({"phrases": wanted}, indent=1), encoding="utf-8")
    for voice in args.voices:
        takes = {}
        for seed in args.seeds:
            out = args.work / voice / str(seed)
            if not (out / "worker_report.json").exists():
                shutil.rmtree(out, ignore_errors=True)
                subprocess.run([
                    sys.executable, str(WORKER), "--model-dir", str(args.model_dir),
                    "--reference", str(VOICES / f"{voice}.wav"), "--phrases", str(lines_file),
                    "--out-dir", str(out), "--cache-dir", str(args.work / "cache"),
                    "--device", args.device, "--seed", str(seed),
                ], check=True)
            for clip in json.loads((out / "worker_report.json").read_text(encoding="utf-8"))["clips"]:
                takes.setdefault(clip["phrase_id"], []).append(pathlib.Path(clip["path"]))
        dest = VOICES / voice
        if not args.ids:
            shutil.rmtree(dest, ignore_errors=True)
        dest.mkdir(exist_ok=True)
        keep = {p["id"] for p in phrases}
        for stale in sorted(dest.glob("*.wav")):
            if stale.stem not in keep:
                stale.unlink()
                print(f"{voice} {stale.stem}: removed, no longer a line")
        for phrase in wanted:
            expected = 0.3 + SECONDS_PER_WORD * len(phrase["text"].split())
            best = min(takes[phrase["id"]], key=lambda path: abs(seconds(path) - expected))
            shutil.copyfile(best, dest / f"{phrase['id']}.wav")
            print(f"{voice} {phrase['id']}: {seconds(best):.2f}s (expected {expected:.1f}s) <- {best.parent.parent.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Make the bundled starter clips: the lines in scripts/starter_lines.json, for Derek and Elise.

Each line is generated once per seed; the take whose length sits closest to what its word count
predicts is kept (the model sometimes drops or doubles a word, and those takes come out short or
long). Output: src-tauri/voices/<voice>/<line id>.wav. Without --ids every clip is remade; with
--ids only those lines are made and the rest are kept. Either way, a clip whose id is no longer in
the list is removed.

--intros makes each voice's hello instead, played from its card: src-tauri/voices/<voice>-intro.wav.
The text per voice is in STARTER_INTROS in src/screens/voice.ts, repeated in INTROS here.

    .venv-voice-runtime-windows/Scripts/python scripts/make_starter_clips.py --model-dir ... --work ...
    .venv-voice-runtime-windows/Scripts/python scripts/make_starter_clips.py ... --ids mom_grounded
    .venv-voice-runtime-windows/Scripts/python scripts/make_starter_clips.py ... --intros
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
INTROS = {
    "derek": "Hey, I'm Derek. Good to meet you.",
    "elise": "Hi, I'm Elise. Nice to meet you.",
}


def seconds(path: pathlib.Path) -> float:
    with wave.open(str(path)) as clip:
        return clip.getnframes() / clip.getframerate()


def best_take(takes: list, text: str) -> pathlib.Path:
    expected = 0.3 + SECONDS_PER_WORD * len(text.split())
    best = min(takes, key=lambda path: abs(seconds(path) - expected))
    print(f"{seconds(best):.2f}s (expected {expected:.1f}s) <- seed {best.parent.parent.name}")
    return best


def generate(args, voice: str, lines_file: pathlib.Path, work: pathlib.Path) -> dict:
    """Every seed's take of each line in `lines_file`, by line id."""
    takes = {}
    for seed in args.seeds:
        out = work / str(seed)
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
    return takes


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=pathlib.Path, required=True)
    parser.add_argument("--work", type=pathlib.Path, required=True, help="scratch folder for the takes")
    parser.add_argument("--seeds", type=int, nargs="+", default=[11, 22, 23])
    parser.add_argument("--voices", nargs="+", default=["derek", "elise"])
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--ids", nargs="*", help="only these line ids; the other clips are kept")
    parser.add_argument("--intros", action="store_true", help="make each voice's hello instead of its lines")
    args = parser.parse_args()
    args.work.mkdir(parents=True, exist_ok=True)

    if args.intros:
        for voice in args.voices:
            lines_file = args.work / f"{voice}-intro.json"
            lines_file.write_text(json.dumps({"phrases": [{"id": "intro", "tone": "gentle", "text": INTROS[voice]}]}), encoding="utf-8")
            takes = generate(args, voice, lines_file, args.work / f"{voice}-intro")
            print(f"{voice} intro: ", end="")
            shutil.copyfile(best_take(takes["intro"], INTROS[voice]), VOICES / f"{voice}-intro.wav")
        return 0

    phrases = json.loads(LINES.read_text(encoding="utf-8"))["phrases"]
    wanted = [p for p in phrases if not args.ids or p["id"] in args.ids]
    lines_file = LINES
    if args.ids:
        missing = set(args.ids) - {p["id"] for p in wanted}
        if missing:
            raise SystemExit(f"not in {LINES.name}: {sorted(missing)}")
        lines_file = args.work / "lines.json"
        lines_file.write_text(json.dumps({"phrases": wanted}, indent=1), encoding="utf-8")
    for voice in args.voices:
        takes = generate(args, voice, lines_file, args.work / voice)
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
            print(f"{voice} {phrase['id']}: ", end="")
            shutil.copyfile(best_take(takes[phrase["id"]], phrase["text"]), dest / f"{phrase['id']}.wav")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

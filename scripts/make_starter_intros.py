"""Make each starter voice's hello, played from its card: src-tauri/voices/<voice>-intro.wav.

Three takes per voice; the one whose length sits closest to what its word count predicts is
kept, as make_starter_clips.py does for the lines. The text per voice is in STARTER_INTROS in
src/main.ts, repeated here.

    .venv-voice-runtime-windows/Scripts/python scripts/make_starter_intros.py --model-dir ... --work ...
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
VOICES = ROOT / "src-tauri" / "voices"
SECONDS_PER_WORD = 0.36
INTROS = {
    "derek": "Hey, I'm Derek. Good to meet you.",
    "elise": "Hi, I'm Elise. Nice to meet you.",
}


def seconds(path: pathlib.Path) -> float:
    with wave.open(str(path)) as clip:
        return clip.getnframes() / clip.getframerate()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=pathlib.Path, required=True)
    parser.add_argument("--work", type=pathlib.Path, required=True)
    parser.add_argument("--seeds", type=int, nargs="+", default=[11, 22, 23])
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()
    for voice, text in INTROS.items():
        lines = args.work / f"{voice}.json"
        args.work.mkdir(parents=True, exist_ok=True)
        lines.write_text(json.dumps({"phrases": [{"id": "intro", "tone": "gentle", "text": text}]}), encoding="utf-8")
        takes = []
        for seed in args.seeds:
            out = args.work / voice / str(seed)
            if not (out / "worker_report.json").exists():
                shutil.rmtree(out, ignore_errors=True)
                subprocess.run([
                    sys.executable, str(WORKER), "--model-dir", str(args.model_dir),
                    "--reference", str(VOICES / f"{voice}.wav"), "--phrases", str(lines),
                    "--out-dir", str(out), "--cache-dir", str(args.work / "cache"),
                    "--device", args.device, "--seed", str(seed),
                ], check=True)
            report = json.loads((out / "worker_report.json").read_text(encoding="utf-8"))
            takes += [pathlib.Path(clip["path"]) for clip in report["clips"]]
        expected = 0.3 + SECONDS_PER_WORD * len(text.split())
        best = min(takes, key=lambda path: abs(seconds(path) - expected))
        shutil.copyfile(best, VOICES / f"{voice}-intro.wav")
        print(f"{voice}: {seconds(best):.2f}s (expected {expected:.1f}s) <- seed {best.parent.parent.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

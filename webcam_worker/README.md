# Webcam worker

Shipped inside the app. It reports whether a phone is in frame and whether the user is present.

The model is YOLO26s fine-tuned on desk-webcam pictures (`models/yolo26s.onnx`; how, and how it compares with the stock model, in `train/README.md`) plus YuNet for faces. `RESULTS.md` is the bakeoff that chose the size.

## Dev setup

```powershell
python -m venv .venv-webcam
.\.venv-webcam\Scripts\python -m pip install -r webcam_worker\build-requirements.txt
.\.venv-webcam\Scripts\python webcam_worker\download_models.py
.\.venv-webcam\Scripts\python webcam_worker\run_tracker.py --preview
.\.venv-webcam\Scripts\python webcam_worker\run_tracker.py --self-test --device gpu
```

On macOS the venv path is `.venv-webcam/bin/python`. macOS 14 or newer.

`download_models.py` only checks the pinned files. It downloads YuNet if that file is missing.

`models/yolo26s.onnx` (38 MB) is **not in git**: `.gitignore` ignores `webcam_worker/models/`. A fresh checkout must get it before the worker will start. Either:

- copy it from an earlier build, e.g. `~/.cargo-target/supervisor/release/webcam/models/yolo26s.onnx`, or
- export it from the fine-tuned checkpoint with `train/train.py export` (the checkpoint is not in git either; see `train/README.md`).

Either way, `download_models.py` must then pass: it pins the one sha256 of the export that was judged and shipped (`d62da80a…`, Windows, 2026-11-22). An export with other tool versions gives different bytes and is rejected; change the pin only after the unit tests and both self-tests pass with the new file. `export_models.py` exports the stock model, which the pin no longer accepts; it stays for the bakeoff in `RESULTS.md`.

## Freeze it into the installer

```powershell
.\.venv-webcam\Scripts\python scripts\build_webcam_runtime.py
npm run build -- --config src-tauri/tauri.bundle.conf.json
```

Build on the OS you ship. PyInstaller cannot cross-compile. The script refuses to finish if the frozen worker fails its CPU or GPU self-test.

## Checks

```powershell
.\.venv-webcam\Scripts\python webcam_worker\test_labels.py
.\.venv-webcam\Scripts\python webcam_worker\test_detectors.py
```

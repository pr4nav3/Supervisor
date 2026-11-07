# Webcam worker

Shipped inside the app. It reports whether a phone is in frame and whether the user is present. Gaze is off.

The model is YOLO26s (`models/yolo26s.onnx`) plus YuNet for faces. See `RESULTS.md`.

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

`models/yolo26s.onnx` (38 MB) is **not in git**: `webcam_worker/.gitignore` ignores `models/`. A fresh checkout must get it before the worker will start. Either:

- copy it from an earlier build, e.g. `~/.cargo-target/supervisor/release/webcam/models/yolo26s.onnx`, or
- export it with `export_models.py` in `.venv-webcam-tools` (Ultralytics, telemetry off).

Either way, `download_models.py` must then pass. It accepts the pinned sha256s listed in it: the Windows export that was benchmarked (`ad1008fe…`) and the Mac re-exports of the same weights (`00db196e…` from 2026-10-25, `2d70a7fb…` from 2026-10-31, `a1cdf3f7…` from 2026-11-05; the same ultralytics 8.4.188 / onnx 1.23.2 pins, a different onnxslim). A fresh export with other tool versions gives a new hash and is rejected; add it to `also_sha256` only after the unit tests and both self-tests pass with it.

On a Mac the export is `python3 -m venv .venv-webcam-tools && .venv-webcam-tools/bin/pip install ultralytics onnx onnxslim onnxruntime && (cd webcam_worker && ../.venv-webcam-tools/bin/python export_models.py)`. A python.org Python needs its `Install Certificates.command` run once first, or every download fails with `CERTIFICATE_VERIFY_FAILED`.

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

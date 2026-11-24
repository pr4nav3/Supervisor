# Third-party work in Supervisor

What the app ships or downloads that other people made, and the terms it comes under. The app's own code is MIT (`LICENSE`); the webcam worker is AGPL-3.0 (`webcam_worker/LICENSE`).

## Downloaded on first use (the voice engine)

- **Chatterbox-Nano**, Resemble AI. The voice model: [ResembleAI/chatterbox-nano](https://huggingface.co/ResembleAI/chatterbox-nano), revision `71ccd1d0081b430592cea481f4307e764e07bc64`, [MIT](https://huggingface.co/ResembleAI/chatterbox-nano/blob/main/README.md). The app fetches byte-for-byte copies from this repo's `voice-runtime` release so it does not depend on huggingface.co; `src-tauri/src/voice.rs` pins each file's size and sha256. Resemble's Perth watermark is turned off in `voice_worker/chatterbox_nano_worker.py`, so generated lines do not carry it.
- **Chatterbox** code, Resemble AI. [resemble-ai/chatterbox](https://github.com/resemble-ai/chatterbox), [MIT](https://github.com/resemble-ai/chatterbox/blob/master/LICENSE). Frozen into the voice engine zip together with the Python packages it needs (PyTorch and friends, each under its own licence), per `voice_worker/requirements.txt`.

## Bundled with the installer (the webcam worker)

- **YOLO26s**, Ultralytics. The phone detector is Ultralytics' YOLO26s fine-tuned in `webcam_worker/train/` and exported to ONNX. Ultralytics licenses its models and code under the [AGPL-3.0](https://github.com/ultralytics/ultralytics/blob/main/LICENSE), which is why the worker is a separate AGPL program. Training data and their licences are listed in `webcam_worker/train/README.md`.
- **YuNet** face detector, OpenCV Zoo. `face_detection_yunet_2023mar.onnx` from [opencv/face_detection_yunet](https://huggingface.co/opencv/face_detection_yunet), [MIT](https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/LICENSE) (Shiqi Yu).
- **Python packages** frozen into the worker: numpy ([BSD-3-Clause](https://github.com/numpy/numpy/blob/main/LICENSE.txt)), opencv-python-headless ([MIT](https://github.com/opencv/opencv-python/blob/4.x/LICENSE.txt) wrapper around OpenCV, [Apache-2.0](https://github.com/opencv/opencv/blob/4.x/LICENSE)), onnxruntime ([MIT](https://pypi.org/project/onnxruntime/)). Exact versions in `webcam_worker/requirements.txt`.

## Website

- **Inter** typeface, Rasmus Andersson. `website/assets/fonts/inter-variable.woff2`, [SIL Open Font License 1.1](https://github.com/rsms/inter/blob/master/LICENSE.txt).

The Rust and npm libraries the app is built from are pinned in `src-tauri/Cargo.lock` and `package-lock.json`, each under its own licence.

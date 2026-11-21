# Fine-tuning the phone detector

The shipped detector is Ultralytics' YOLO26s, trained on COCO. These scripts fine-tune it on
desk-webcam pictures so it catches a phone held the way people hold one at a laptop, without
losing what it already knew. Every picture is labelled with all 80 COCO classes, in COCO's
numbering, so the worker's detector code does not change.

## Run it

Python 3.11, in its own environment (torch with CUDA; the worker's environment stays as it is):

```bash
py -3.11 -m venv .venv-train
.venv-train/Scripts/python -m pip install ultralytics onnxruntime onnx onnxslim
.venv-train/Scripts/python -m pip install --force-reinstall --no-deps torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124
```

A Roboflow API key goes in `~/.supervisor-train/roboflow.key`, outside the repo. Then, from this folder:

```bash
python dataset.py fetch
python dataset.py build
python evaluate.py score base ../models/yolo26s.onnx data/yolo26s.pt
python train.py phone4
python evaluate.py score phone4 runs/phone4/yolo26s-phone.onnx runs/phone4/weights/best.pt
python train.py blend phone4 0.7
python evaluate.py score phone4-0.7 runs/phone4/blend-0.7.onnx runs/phone4/weights/blend-0.7.pt
python evaluate.py speed base ../models/yolo26s.onnx phone4-0.7 runs/phone4/blend-0.7.onnx
python evaluate.py compare base phone4-0.7
```

`data/` and `runs/` are ignored by git.

## Data

| Source | Use | Licence |
|---|---|---|
| [Online Proctoring System](https://universe.roboflow.com/project-2morrow-software-limited/online-proctoring-system-x27ou), Project 2morrow | train, val | CC BY 4.0 |
| [laptop and phone detection](https://universe.roboflow.com/detection-gbx6c/laptop-and-phone-detection) | train, val | CC BY 4.0 |
| [Open Images V7](https://storage.googleapis.com/openimages/web/index.html), mobile phones and look-alikes (validation and test splits) | train, val | annotations CC BY 4.0, images CC BY 2.0 |
| [COCO](https://cocodataset.org) train2017: every photo with a phone, and photos of look-alikes and of people | train, val | CC BY 4.0 |
| [Phone_detection](https://universe.roboflow.com/hackhounds/phone_detection-txozd), hackhounds | test | public domain |
| [mobile_detection](https://universe.roboflow.com/college-aivcu/mobile_detection-leiya), College | test | CC BY 4.0 |
| [Phone Usage Detection](https://universe.roboflow.com/dwarkadas-j-sanghvi/phone-usage-detection), Dwarkadas J Sanghvi | test | CC BY 4.0 |
| [Mobile Usage Detection](https://universe.roboflow.com/rose-epnzt/mobile-usage-detection-so4ig), Rose | test | CC BY 4.0 |
| COCO val2017: the 605 photos in `../RESULTS.md`, and every photo with a person or a phone | test | CC BY 4.0 |

How the set is built, and why:

- **One copy of each frame.** Roboflow exports a frame several times with flips and rotations. Training adds its own.
- **No near-identical video frames.** Neighbouring frames from the same video are dropped, so the count is of different pictures.
- **Split by stretch of video, not by frame.** The proctoring set is one long recording of many sittings, so it is cut into stretches of 300 frames and whole stretches go to validation. Otherwise a frame's neighbour lands in validation and flatters the score.
- **Tested on other people's data.** The four test sets come from unrelated sources. Any test picture that matches a training picture is removed.
- **Nothing left unboxed.** A source's boxes are kept for the COCO classes it has (phone, laptop, book, TV); YOLO26x draws every other class at confidence 0.5, people included, since these sources draw people looser than COCO. The first run labelled only people and phones, so every laptop and remote was taught as background: it caught more phones but lost 4.5 points of person mAP and took 18 % of COCO's look-alikes for phones.
- **Every phone box is confirmed.** A Roboflow picture stays only if YOLO26x also sees each of its phones, even faintly (confidence 0.1), and the box takes YOLO26x's tighter outline. Unconfirmed boxes included office chairs, books held up to the camera and hands, and a model trained on them took calculators and paperbacks for phones. What the human labels add is the phones YOLO26x is only 10 to 50 % sure of, which the small model learns to be sure of.
- **Look-alikes are checked for phones.** A remote or a mug photo is dropped if YOLO26x sees a phone in it, since Open Images leaves unverified objects unboxed.
- **COCO replay.** 7,303 COCO training photos with COCO's own boxes: all 4,803 with a phone, 1,500 of look-alikes (remote, mouse, book, cup, keyboard, bottle, clock) with no phone, and 1,000 of people with no phone. They keep the model's sense of people and phones in general, and teach what is not a phone.

## How it is trained

Only the detection head learns (`freeze=23`); the backbone and neck stay as Ultralytics trained them, with their BatchNorm statistics fixed. SGD at lr 0.002 falling to a tenth, one warm-up round with the bias warm-up off: Ultralytics' default (0.1) is meant for training from scratch, and with it on, the second run lost two points of person mAP in its first round. Letting the neck learn too (`freeze=10`) lost person accuracy as it trained.

The fine-tuned head is then blended with the stock one (WiSE-FT, Wortsman et al. 2022): `train.py blend NAME SHARE` moves SHARE of the way from the stock weights to the fine-tuned ones. Blends at 0.3, 0.5 and 0.7 are scored, and the one with the best validation F1 at the shared false-alarm rate is kept; 0.7 won, ahead of the full fine-tune. A run with 5,000 COCO look-alikes and 2,000 people instead of 1,500 and 1,000 lost the webcam gain altogether.

## How it is judged

`evaluate.py` scores a picture as "phone" when any phone box clears the threshold, through the worker's own `detectors.py`, as in `../RESULTS.md`. Each model gets the threshold with the best validation F1 that raises no more false alarms on validation pictures with no phone than the shipped model does at 0.15, so models are compared at the same rate of wrong reminders. Thresholds are never tuned on a test set, and `compare` gives McNemar's exact test on the pictures the two models disagree on, so a gap of a few pictures is not read as a change. A fine-tuned model replaces the shipped one only if every check in `evaluate.py compare` passes: better phone F1 on the webcam test sets, no more look-alikes taken for phones, phone F1 on the 605 COCO photos within a point of the shipped model's, person accuracy on COCO val within half a point, and the same speed.

The fine-tuned weights are a derivative of Ultralytics' AGPL-3.0 model, like the rest of this folder.

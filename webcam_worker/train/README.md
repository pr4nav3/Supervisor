# Fine-tuning the phone detector

The shipped detector is Ultralytics' YOLO26s, trained on COCO. These scripts fine-tune it on
desk-webcam pictures so it catches a phone held the way people hold one at a laptop, without
losing what it already knew. Every picture is labelled with all 80 COCO classes, in COCO's
numbering, so the worker's detector code does not change.

The teacher is YOLO26x, the same family's largest model. Set to raise as many false alarms on
COCO photos with no phone as YOLO26s does at the app's threshold, it catches 78 % of the webcam
test phones against YOLO26s's 66 %, and more on desk-webcam pictures labelled by people (63 %
against 53 % on laptop-and-phone). Running YOLO26s on a bigger picture (960 or 1280) does not
help. So the small model is taught to see phones the way the big one does: distillation.

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
python train.py distil2-head
python train.py distil2-neck freeze=16 distill_model=yolo26x.pt lr0=0.001 batch=8
python evaluate.py select data/yolo26s.pt runs/distil2-head/weights/epoch*.pt runs/distil2-neck/weights/epoch*.pt
python train.py blend distil2-head epoch12 0.5
python train.py export distil2-head epoch12-blend-0.5
python evaluate.py score base ../models/yolo26s.onnx data/yolo26s.pt
python evaluate.py score distil2 runs/distil2-head/epoch12-blend-0.5.onnx runs/distil2-head/weights/epoch12-blend-0.5.pt
python evaluate.py speed base ../models/yolo26s.onnx distil2 runs/distil2-head/epoch12-blend-0.5.onnx
python evaluate.py compare base distil2
```

`data/` and `runs/` are ignored by git.

## Data

| Source | Use | Licence |
|---|---|---|
| [Online Proctoring System](https://universe.roboflow.com/project-2morrow-software-limited/online-proctoring-system-x27ou), Project 2morrow | train, val | CC BY 4.0 |
| [laptop and phone detection](https://universe.roboflow.com/detection-gbx6c/laptop-and-phone-detection), relabelled by eye (`desk-labels.csv`) | desk test (the app's own view) | CC BY 4.0 |
| [Open Images V7](https://storage.googleapis.com/openimages/web/index.html), mobile phones and look-alikes (validation and test splits) | train, val | annotations CC BY 4.0, images CC BY 2.0 |
| [COCO](https://cocodataset.org) train2017: every photo with a phone, photos of look-alikes and of people, hard negatives | train, val | CC BY 4.0 |
| COCO train2017: 3,000 other photos of people with no phone | selection set | CC BY 4.0 |
| [Phone_detection](https://universe.roboflow.com/hackhounds/phone_detection-txozd), hackhounds | test | public domain |
| [mobile_detection](https://universe.roboflow.com/college-aivcu/mobile_detection-leiya), College | test | CC BY 4.0 |
| [Phone Usage Detection](https://universe.roboflow.com/dwarkadas-j-sanghvi/phone-usage-detection), Dwarkadas J Sanghvi | test | CC BY 4.0 |
| [Mobile Usage Detection](https://universe.roboflow.com/rose-epnzt/mobile-usage-detection-so4ig), Rose | test | CC BY 4.0 |
| COCO val2017: the 605 photos in `../RESULTS.md`, and every photo with a person or a phone | test | CC BY 4.0 |

How the set is built, and why:

- **One copy of each frame.** Roboflow exports a frame several times with flips and rotations. Training adds its own.
- **No near-identical video frames.** Neighbouring frames from the same video are dropped, so the count is of different pictures.
- **Split by stretch of video, not by frame.** The proctoring set is one long recording of many sittings, so it is cut into stretches of 300 frames and whole stretches go to validation. Otherwise a frame's neighbour lands in validation and flatters the score.
- **Tested on other people's data.** The test sets come from unrelated sources. Any test picture that matches a training picture is removed. The four webcam sets are mostly phones in the hand at arm's length or across a courtyard.
- **A desk test in the app's own view.** Laptop-and-phone is one five-minute video of people at a laptop webcam, held out of training. Its own labels were wrong too often to judge by (most of its "phones" the teacher never saw were chair backs and scarves), so every frame was relabelled by eye: one upright copy per frame, two independent labellers, and the 22 frames they were unsure of or disagreed on left out. 569 frames, 195 with a phone, in video order, so the app's reminder rule can be replayed over them.
- **Webcam frames are restored to 16:9.** Roboflow exported both webcam videos squashed into 640x640 squares. The app sees 16:9 frames with padding, so the frames go back to 640x360 before labelling, training and testing; otherwise every desk phone is 1.78 times too tall.
- **Nothing left unboxed.** A source's boxes are kept for the COCO classes it has (phone, laptop, book, TV); YOLO26x draws every other class at confidence 0.5, people included, since these sources draw people looser than COCO. The first run labelled only people and phones, so every laptop and remote was taught as background: it caught more phones but lost 4.5 points of person mAP and took 18 % of COCO's look-alikes for phones.
- **Outside COCO, the phones are YOLO26x's.** Every teacher phone at confidence 0.15 or more is a phone box (0.15 is where YOLO26x raises as many false alarms on COCO photos as the app's model does at its own 0.15). A picture is left out if the teacher sees a phone it is unsure of (0.05 to 0.15), or if a phone the source's labellers drew has no sure teacher phone on it. An earlier run kept the human boxes whenever the teacher saw them at 0.1; in the proctoring room people hold laptops, tablets and paper up to the camera, and that model learned that anything small in a hand is a phone. A cut at 0.5 was tried too (run D below) and changed nothing.
- **Hard negatives.** COCO photos of people with no phone in which YOLO26s sees a phone (0.1 or more) and YOLO26x sees none, mined from 20,000 (223 found): the mistakes themselves, rather than random look-alike photos. Adding a fine-tuned model's own 477 false phones from the same pool (run D) changed nothing either.
- **COCO replay.** 9,303 COCO training photos with COCO's own boxes: all 4,803 with a phone, 3,000 of people holding a look-alike (remote, mouse, book, cup, keyboard, bottle, clock) with no phone, and 1,500 of people with no phone. They keep the model's sense of people and phones in general, and teach what is not a phone. Another 3,000 people photos with no phone are the selection set, and 20,000 the mining pool; none of the three overlaps.

## How it is trained

Only the detection head learns (`freeze=23`); the backbone and neck stay as Ultralytics trained them, with their BatchNorm statistics fixed. SGD at lr 0.002 falling to a tenth, one warm-up round with the bias warm-up off: Ultralytics' default (0.1) is meant for training from scratch, and with it on, the second run lost two points of person mAP in its first round.

YOLO26 trains two heads, and the app's ONNX runs the one-to-many one (with the worker's own NMS). Ultralytics shifts the loss from that head to the other over a run, 0.8 down to 0.1, which in a short fine-tune sends about half the learning to a head the app never uses; `train.py` holds the app's head at 0.8. Early stopping is off and a checkpoint is kept every two rounds, because Ultralytics picks `best.pt` by all-class accuracy on validation and that is not the question; `evaluate.py select` picks the checkpoint by phones caught at a fixed false-alarm rate. A second run lets the neck learn too (`freeze=16`) with Ultralytics' feature distillation from YOLO26x, since matching the teacher may need more than the head.

A run can be blended with the stock weights (WiSE-FT, Wortsman et al. 2022): `train.py blend NAME SHARE` moves SHARE of the way from the stock weights to the fine-tuned ones, which keeps more of what the stock model knew.

## How it is judged

`evaluate.py` scores a picture as "phone" when any phone box clears the threshold, through the worker's own `detectors.py`, as in `../RESULTS.md`. Three kinds of pictures, kept apart:

- **Selection set:** 3,000 COCO training photos of people with no phone that nothing trains on. Each model's threshold is the one at which it raises as many false alarms there as the shipped model does at 0.15. Validation pictures cannot do this: they come from the training sources, and a fine-tuned model is quieter on them than anywhere else, which is how an earlier run looked better than it was.
- **Validation:** picks among runs and blends (`evaluate.py select`), by phones caught at that threshold.
- **Tests:** scored once, at the end, through the app's ONNX path.

`compare` gives McNemar's exact test on the pictures the two models disagree on. A fine-tuned model replaces the shipped one only if every check passes: more phones caught on the webcam tests, at least as many on the desk-webcam test, no more than 15 % more false alarms on the 2,929 COCO val photos with no phone, more webcam phones caught when both models raise the same number of those, no more look-alikes taken for phones, phone F1 on the 605 COCO photos within a point of the shipped model's, person accuracy on COCO val within half a point, and the same speed.

## Where it stands

No fine-tuned model has passed, so the app ships the stock YOLO26s.

Every run so far raises the phone scores of photos with no phone in them. At the app's threshold the stock model alarms on 45 of the 3,000 selection photos; the distilled heads alarm on 107 to 160, and the new alarms are Wii remotes, TV remotes and other things held up like a phone, on which neither the stock model nor the teacher sees a phone. So each fine-tune has to run at a threshold of 0.3 to 0.45 to be as quiet as the stock model at 0.15, and there it catches fewer COCO phones (62 to 67 % of the validation ones against 69 %) and a few more desk-webcam ones (at best 74 % against 68 % of 121, run C round 8; blends in between). On the 569-frame desk test, at five false alarms each, the fine-tunes catch 65 to 73 % of the phones against the stock model's 70 %, and the order changes with the budget: noise. Four runs on the rebuilt set:

| Run | Change | At the stock model's false-alarm rate |
|---|---|---|
| A `distil2-head` | head only, teacher phones at 0.15 | desk 70 %, COCO 64 % (stock 69 / 70) |
| B `distil2-neck` | neck too, feature distillation from YOLO26x, 10 rounds | desk 64 to 68 %, COCO 61 to 63 % |
| C `distil3-head` | A plus 3,000 COCO photos of people holding look-alikes and 500 more of people | desk 74 %, COCO 62 % at round 8; blends 0.3 and 0.5 a wash |
| D `distil4-head` | C plus teacher phones at 0.5 only and run C's own 477 false phones as hard negatives | below the stock model on both |

Neither cleaner labels nor more, or more targeted, pictures of what is not a phone move the threshold, so the shift is not label noise and not a shortage of negatives. The likeliest remaining cause is the mix itself: a third of the training pictures have a phone in them, large and close, against one in twenty-five in COCO, so the head learns a higher prior for "phone" wherever a person is. YOLO26x at the same false-alarm rate catches 78 % of the webcam test phones and 78 % of the desk test ones with one false alarm, so the gain exists; hard labels from the teacher do not carry it over to the small model. Next things worth trying, in order: a phone share near COCO's (keep every negative, sample the phone pictures down), the teacher's soft scores as targets, and a 16:9 input (832x480) so the desk view is not padded.

The fine-tuned weights are a derivative of Ultralytics' AGPL-3.0 model, like the rest of this folder.

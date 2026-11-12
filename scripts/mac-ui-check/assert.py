"""Fail on what breaks a screen: overflow, a modal taller than its window, an overlay card
taller than its window, or a state that did not render."""
import json, sys

states = json.load(open(sys.argv[1]))
if not states:
    sys.exit("no states were laid out")
problems = []
for s in states:
    name = s.get("name")
    if "error" in s:
        problems.append(f"{name}: {s['error']}")
        continue
    w, h = s["viewport"]
    if s["hOverflow"]:
        problems.append(f"{name}: horizontal overflow")
    modal = s["sizes"].get(".modal-panel")
    if modal and modal[1] > h:
        problems.append(f"{name}: modal {modal[1]}px taller than the {h}px window")
    shell = s["sizes"].get(".overlay-shell")
    if shell and shell[1] > h:
        problems.append(f"{name}: overlay card {shell[1]}px taller than the {h}px window")
    # Home is sized to fit the window it opens in (920x760) exactly; any scroll there is a layout
    # bug. A shorter window, down to the 600 px minimum for small laptop screens, scrolls by design.
    if name.startswith("home") and h >= 760 and s["docH"] > h:
        problems.append(f"{name}: Home scrolls ({s['docH']}px in {h}px)")
    for clip in s.get("clipped", []):
        problems.append(f"{name}: text cut off: {clip}")
    for row in s.get("misaligned", []):
        problems.append(f"{name}: row out of line: {row}")
    if s.get("startBottom") and s["startBottom"] > h:
        problems.append(f"{name}: Start button below the window ({s['startBottom']}px in {h}px)")
print(f"{len(states)} states laid out in WebKit at {states[0]['viewport'][0]}x{states[0]['viewport'][1]}")
if problems:
    print("\n".join(problems))
    sys.exit(1)
print("ok: no overflow, cut-off text or row out of line, every modal and overlay card fits, Start is reachable, Home does not scroll")

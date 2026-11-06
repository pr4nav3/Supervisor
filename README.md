# Supervisor

The focus app that talks back. Start a session, and when you open a distraction a voice you recorded tells you to get back to work. Turn the webcam on and it notices your phone too.

Everything runs on your computer. No account, no servers, nothing uploaded. Download it at [supervisorfocus.com](https://supervisorfocus.com). Free, for macOS and Windows.

## How it works

- Supervisor watches which app and window is in front and, in a browser, which site is open. It takes no screenshots and reads nothing on screen. You keep a list of distractions.
- Reminders are spoken lines in a voice you choose. Two voices come with the app, Derek and Elise. Record anyone for twenty seconds, with their consent, and the app generates lines in their voice.
- Each voice has personalities: Gentle, Mom, Gen Z, Stern, and ones you write yourself.
- The webcam, when you turn it on, reports whether a phone is in frame and whether you are present. Frames never leave the machine.

## Repo layout

| Folder | What it is |
|---|---|
| `src/` | The app's UI (TypeScript, Vite) |
| `src-tauri/` | The app itself (Rust, Tauri 2), the starter voice clips and the voice recordings |
| `voice_worker/` | The voice engine: a Python worker the app runs out of process |
| `webcam_bakeoff/` | The webcam worker and its model setup |
| `scripts/` | Build, release and install scripts; `starter_lines.json` is the set of built-in lines |
| `docs/` | The website at supervisorfocus.com, served by GitHub Pages. Not documentation. |

## Developing

You need Node 22, Rust stable and Python 3.11.

```bash
npm ci
npm run dev
```

`npm run check` type-checks and builds the UI. `cargo test` in `src-tauri/` runs the Rust tests. CI runs both on macOS and Windows.

The voice and webcam workers need their own Python environments and model files, which are not in git. `voice_worker/` and `webcam_bakeoff/README.md` say how to set them up. Without them the app still runs; it just can't generate lines or watch the webcam.

## Rules of the road

`AGENTS.md` holds the project's conventions: local-first, plain words in anything a user sees, no dependency without a reason.

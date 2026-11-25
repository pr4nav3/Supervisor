# Supervisor

The focus app that talks back. Start a session, and when you open a distraction a voice you recorded tells you to get back to work. Turn the webcam on and it notices your phone too.

Everything runs on your computer. No account, no servers, nothing uploaded. Download it at [supervisorfocus.com](https://supervisorfocus.com). Free, for macOS and Windows.

The Windows installer is not signed, so Windows shows "Windows protected your PC" when you open it; click "More info", then "Run anyway". Uninstalling leaves your data: on Windows, sessions in `%APPDATA%\app.supervisor.desktop` and voices with the voice engine (about 4 GB) in `%LOCALAPPDATA%\app.supervisor.desktop`; on the Mac, all of it in `~/Library/Application Support/app.supervisor.desktop`; unless you tick "Delete the application data" in the uninstaller.

## How it works

- Supervisor watches which app and window is in front and, in a browser, which site is open. It takes no screenshots and reads nothing on screen. You keep a list of distractions.
- Reminders are spoken lines in a voice you choose. Two voices come with the app, Derek and Elise. Record anyone for twenty seconds, with their consent, and the app generates lines in their voice.
- Each voice has personalities: Gentle, Mom, Gen Z, Stern, and ones you write yourself.
- The webcam, when you turn it on, reports whether a phone is in frame and whether you are present. Frames never leave the machine.

## Privacy

Nothing leaves your computer. There is no account, no analytics, no crash reporting and no remote font. The only network calls the app makes are for updates: downloading the voice engine the first time you turn voices on, and a once-a-day check for a newer voice engine and a newer Supervisor. A new Supervisor installs only when you click Update. Voice generation and phone detection run as local processes on your machine.

## Repo layout

| Folder | What it is |
|---|---|
| `src/` | The app's UI (TypeScript, Vite) |
| `src-tauri/` | The app itself (Rust, Tauri 2), the starter voice clips and the voice recordings |
| `voice_worker/` | The voice engine: a Python worker the app runs out of process |
| `webcam_worker/` | The webcam worker: phone and presence detection, also out of process |
| `scripts/` | Build, release and install scripts; `starter_lines.json` is the set of built-in lines |
| `website/` | The website at supervisorfocus.com, deployed to GitHub Pages by `.github/workflows/pages.yml` |
| `AGENTS.md` | Conventions for anyone, person or coding agent, working in this repo; `.claude/` holds only `launch.json`, the browser-pane preview for the dev server |

## Developing

You need Node 22, Rust stable and Python (3.11 for the voice engine, 3.12 for the webcam worker).

```bash
npm ci
npm run dev
```

On a Mac, `npm run dev` hands the Accessibility and Camera grants to the terminal, not the app. Run `sh scripts/make_mac_dev_cert.sh` once, then `npm run bundle:mac-dev` and `open src-tauri/target/debug/bundle/macos/Supervisor.app`.

`npm run check` type-checks and builds the UI and runs the UI tests in `scripts/ui.test.mjs`. `cargo test` in `src-tauri/` runs the Rust tests. CI runs both on macOS and Windows on every push, plus the Python tests of the two workers' scripts; on macOS it also bundles the app and lays out every screen in WebKit with `scripts/mac-ui-check/check.sh`.

The two workers need their own Python environments and model files, which are not in git. Without them the app still runs; it just can't generate lines or watch the webcam.

- Voice: `voice_worker/requirements.txt` into a Python 3.11 environment, plus the voice engine's model files. `scripts/build_voice_runtime.py` builds the runtime zip the app downloads.
- Webcam (Python 3.12): `webcam_worker/README.md` has the five commands, including fetching the model. `scripts/build_webcam_runtime.py` builds it into `build/webcam/`, which the installer bundles.

## Contributing

Issues and pull requests are welcome. Two things to know before you open one:

- `AGENTS.md` holds the project's conventions: local-first, no new dependency without a reason, and plain words in anything a user sees. Say "line", not "clip"; "reminder", not "nudge"; "personality", not "tone".
- Keep commits small, with a short message that says what changed in plain language.

Found a security or privacy problem? Email karthik.pranav88@gmail.com rather than opening a public issue.

## Licence

The app is under the [MIT licence](LICENSE).

`THIRD_PARTY.md` lists what the app ships or downloads from others (the voice model, the detection models, the app and website font) and their licences.

The webcam worker in `webcam_worker/` is a separate program under the [GNU AGPL v3](webcam_worker/LICENSE), because the detection model it runs is an Ultralytics YOLO export and Ultralytics licenses its models under the AGPL. It ships beside the app as its own program, and the app talks to it over a pipe, so the rest of the project stays MIT. If you ship a fork, keep that boundary or swap the model.

# Working on Supervisor

Rules for anyone, person or coding agent, changing this repo.

## The app

- Local-first. No telemetry, analytics, remote fonts or cloud processing. The only network calls are the ones the user asks for.
- Prefer what the OS already knows (the front window, the app name, the browser's address) over screenshots, OCR or models.
- Voice generation runs out of process. The main app plays cached audio only.
- No new dependency unless the current work needs it.
- Non-trivial logic gets one runnable check: a test, or a script that proves it.

## Words users see

Plain words, never internal names: line (not clip or phrase); reminder (not nudge); personality (not tone); Generate and Regenerate for making a line's audio; voice engine (not model pack, runtime or worker); recording (not reference); Allow once and Always allow (not exception, Not today or Never a distraction); start screen (not preflight). GPU and vision models keep their names. Code identifiers keep theirs.

## Code

The laziest solution that works: standard library and native features first, one line before fifty, nothing speculative. Commits are small, with a short message in plain language and no trailers.

## Agents

Project notes, the tracker and the mockups are in a private companion repo, cloned at `notes/` and ignored by git; its tracker is `notes/plans/STATUS.md`.

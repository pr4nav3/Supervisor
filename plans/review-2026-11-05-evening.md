# Second review, 2026-11-05 evening: what the first one missed, and why

Pranav's own Mac got no reminder card with Brave on a listed site, hours after the 2026-11-04
review had called the code base clean. This file is the honest record: what was wrong, why a
whole-codebase read did not find it, what changed tonight, and what is proved versus only read.

## Why the first review missed it

The first review read the app's own code, feature by feature, from Windows. It took three
things as given that were not:

- **The operating system and the libraries.** tao's `show()` on a Mac is `makeKeyAndOrderFront`,
  which shows nothing while the app is hidden; macOS 14 suspends a hidden webview after about
  five minutes unless `backgroundThrottling` is off; monitor areas come in physical pixels per
  monitor while a window position converts through the window's own scale. None of that is in
  our code, and none of it was questioned.
- **What changes between a build and a release.** The Mac release was signed with a
  re-minted certificate the same day. macOS keys an Accessibility grant to the signature, so
  every Mac that had allowed an earlier build kept Supervisor listed and on while every read
  failed: every site became Other websites and no website card could ever come. The review
  record never asked "what does this release do to an existing install".
- **Rendered reality.** The start screen slider's marks were read as markup, never measured
  against the thumb. They were 2 px off at the ends and more in the middle.

And the biggest one: nothing was *run*. Code reading says "this should work"; only a session in
the real app, with a listed app in front and a clock, says "this works". Tonight's rule, kept
from here on: a feature is reported working only after it was driven in the running app and
the result checked. "Reads fine" is reported as exactly that.

## How tonight's pass was built

Five reviewers (Opus), each scoped and told to assume the code is wrong until the library
source or a measurement proves it right: macOS lifecycle scenarios; Windows lifecycle scenarios;
the session engine with timelines computed second by second (and throwaway tests run);
the frontend measured in the running mock at three window sizes in both themes; the storage
layer with queries run on copies of the real databases. Then three Opus agents applied the
fixes, each owning its own files, with tests. In parallel the debug build was driven through
its automation hook on this Windows machine: a strict session, Notepad as the distraction,
the card at 30 s, Back to my task, pause, resume, mute, the tray items, End session, the
Session done card, the report, History, Settings, Voice, Webcam, a 2-round Pomodoro (round
over, break, break over, the automatic start of round 2, the end), the quit confirm.

## Fixed tonight (commit b1a8d72 and the one after it)

Mac, the card itself
- A stale Accessibility grant is named, on the start screen, in the running session's
  Distractions card and in Getting started, with the only fix that works (remove Supervisor
  from the list and add it again). The app remembers it was granted once (`accessibility-granted`
  marker file) to tell this from a fresh Mac.
- A hidden app (Cmd-H, Hide Others) is unhidden without activation before any card and before
  the session-end raise.
- Both webviews run with background throttling off.
- The card and the corner timer are placed on the display the pointer is on, in points, from
  AppKit's own screen list; works from the async start command too (main-thread hop); the top
  row of a screen counts as that screen.
- Session end brings the main window forward with `orderFrontRegardless`, not by activating.
- The Mac install script's TERM is handled: the ticker turns it into a proper quit, so an
  update mid-session saves the session instead of abandoning it.
- The lock check needs every display asleep.
- The browser reader drops a remembered web-area path that no longer carries an http(s)
  address (a side panel, DevTools), asks Chromium for its tree again after a failed search,
  and takes a browser's title from its focused window rather than the first window in the
  list (a picture-in-picture video).

Windows
- The main window's minimum is 800x560 (was 920x760, taller than a 1080p laptop's work area at
  150 %), it opens centred and shrinks to the work area.
- The session timer cannot be destroyed from Task View or Alt-Tab (close hides it), is moved
  to the virtual desktop in use before a card, and is put topmost again (tao skips a flag that
  is already set, so a picture-in-picture window could cover the card).
- Cards are sized at the target display's scale.
- The display-off signal is the session's (`GUID_SESSION_DISPLAY_STATUS`), not the console's,
  so Remote Desktop work is not written off as the machine's own monitor sleeping.
- `supervisor --quit` ends the app properly through the single-instance handler; the install
  script uses it before it would kill.
- The frozen webcam worker loads the face model from bytes, so a user folder with an accented
  letter works (rebuilt: `build/webcam`; self-tested from a `José` folder).
- The install script no longer closes the user's PowerShell window on an error, and fetches a
  fixed-name asset with no GitHub API call (60 calls an hour per IP). The fixed-name copy of
  the current installer is on the release already, so the line keeps working.

Session engine (each with a test)
- A second on another window no longer restarts a distraction's grace and first reminder:
  the place keeps its clock for one cooldown. Before: 25 s on YouTube, 1 s elsewhere, repeated,
  gave zero reminders in ten minutes.
- Pause and resume keep the place's clock and the reminder cooldown instead of rebuilding the
  engine.
- Phone reminders: the first one still plays with its card, but only once per cooldown, so a
  phone picked up again (or a detector dropout) no longer brings a reminder every nine seconds.
- The break-over wait runs from when the break was seen to be over after a sleep, so a round
  does not start itself one second after the lid opens.
- The round-over line is picked by the round, not by a counter that also counts break ends.
- A rule edit no longer drops a second from the live Focused tile.
- The ticker takes the lock before reading the clock, so a long command is not mistaken for
  sleep.

Frontend
- Supervisor in front is titled On task (its time is work) instead of the stale Distracted.
- A dismissed card returns for a different distraction; Back to my task and Allow once act on
  the card's own distraction; the main window reads the fresh snapshot before playing a line.
- Rules saved from the timer window reach the main window (`rules-changed` event) and are
  re-read before any edit, so a list edit cannot delete them.
- The report's rename popup closes with the report; the delete confirm closes it too.
- The slider's fill and marks follow the thumb exactly; the Start button stays reachable at
  the new minimum size; the Break over card counts down; the storage notice shows mid-session
  and its Failed state can be dismissed, in plain words; durations in History read as spans;
  the week title carries both years across New Year; the start screen resets strictness to the
  default; Enter starts the session; the goal field matches the backend's 120 characters;
  screen readers no longer hear the timer every second; error banners clear on a tab change;
  reused session ids after a delete still get their Session done card.
- Settings › Webcam does not turn the camera on when the switch is off.

Storage
- An index on events (History queries went from seconds to milliseconds on a long history;
  a query longer than 15 s would have been written down as the machine sleeping).
- Delete all history truncates the write-ahead log, so the deleted text is gone from disk;
  secure delete on; a 2 s busy timeout; the Trends loop cannot run forever on a broken clock.

Voice and webcam
- The voice worker reads and writes UTF-8 (an accented folder or line was mangled on Windows).
- No generation starts while the engine downloads; a partial download is named after the file
  it belongs to and a 416 starts over.
- "The camera stopped" no longer overwrites the real camera error; no "worker" in user text.

Site and notes
- The hero never scrolls sideways; the Gen Z demo line is one the app ships; the site
  generator is gone (docs/ is edited by hand); release notes say what the engine really does.

## Proved versus read

Proved in the running app on this Windows machine (debug build, automation hook): everything
in "How tonight's pass was built". Proved by tests: the engine changes, the storage changes,
the 416 path. Proved by measurement in the mock: the slider, the layouts at 800x560, 1280x672,
920x760, 1100x820 and 1440x900.

Read, not run, because it needs a Mac: every Mac item above. The Mac must pull, `cargo test`,
rebuild, and run the list at the top of `plans/mac-handoff.md` before the Mac zip is replaced.

Not fixed, written down in `plans/known-issues.md`: the card over a full-screen app on macOS
(untested; an NSPanel is the fix if it fails), a card click activating Supervisor on macOS,
Vivaldi and Arc addresses on Windows, days bucketed in the current time zone, the day card's
20-session cache, orphaned audio of deleted lines, and the missing LICENSE.

## What still has to happen before anyone installs

`plans/release-2026-11-05.md`, "Rebuild list": the voice engine zips (both OSes, the worker
script changed), the webcam worker (done here for Windows), the app on both OSes, the
release body. Until then the published 1.0 assets carry none of this.

# Windows pass, 2026-11-06: every workflow in the real build

Driven through the debug build's automation hook (same code as the release build, plus the
hook) on this Windows 11 machine, each result read back from the app or the database. The
release build was installed from the published installer, launched, and quit with `--quit`.
"Seen" below means it happened in the running app; nothing here is from reading code.

## Browsers, for real

Each browser was installed, opened on youtube.com during a Strict session with youtube.com on
the list, and watched for 36 s; then closed. Firefox, Brave, Vivaldi, Opera and Arc were put on
the machine for this and removed after.

| Browser | How it is read | Seen |
|---|---|---|
| Chrome | address bar | YouTube named, Distracted at 5 s, card and line at 30 s |
| Edge | address bar | same |
| Firefox | address bar | same |
| Brave | address bar | same |
| Opera | address bar | same (it is now called "Opera", not "Opera Internet Browser") |
| Vivaldi | window title only (no address) | YouTube named from the title, card at 30 s; a page whose title does not name the site counts as Other websites, and after 20 s of that the session says "Supervisor can't read the address bar in Vivaldi" |
| Arc | not reached | Arc opens a sign-in window first and needs an account; that window is invisible to Windows' own window list, which the app now treats like the desktop (the previous window keeps the time) instead of writing the minutes off |

The notice for an unreadable browser: after 20 s on pages the app cannot name, the running
session's Distractions card says which browser, that its websites count as work, and that
Chrome, Edge, Brave and Firefox can be read. One line goes into the session's event log.

## Sessions

- Start screen: goal capped at 120, empty goal refused with "Name the session", slider 15 to
  90 with the fill and marks under the thumb, three strictness options, Pomodoro rhythms 25/5,
  50/10, 90/20 with rounds 1 to 8 and "Done around", Allow once chips update the summary,
  Escape and Cancel close it, Enter starts, a double click starts one session.
- Distraction list: a website, an app, a pasted link (x.com from a twitter.com link), a
  browser refused with its reason, blank and nonsense refused, duplicates (case-insensitive)
  not added twice. In Settings: add, rename a site, delete with Keep it then Delete.
- Reminders, Notepad on the list: Gentle 90 s, Normal 60 s, Strict 30 s after arriving. A
  one-second look at another window keeps the clock (reminder still at 30 s of Notepad time).
  Pause and resume keep the clock. Mute from the button and from the tray: no reminder while
  muted, the corner timer says MUTED, no card; the reminder due during the mute plays on unmute.
- Allow once from the card: the state turns On task, the chip shows it allowed. Taking it
  back from the chip did nothing (the card stored the rule lower-cased and the chip sent it as
  typed); fixed with a test, 450cff0.
- The camera's away rule fired during unattended runs: nobody in view for a minute turned the
  session Away and stopped reminders, as designed. The engine timings above were taken with the
  camera off.
- Session end by the button, by the tray, by running out, by `--quit`, and by killing the
  process (comes back abandoned with its checkpointed 16 s). The Session done card, the report,
  the review. The main window does not take the keyboard when a session ends.
- Pomodoro 5/1x2: round over, break, break over with its countdown, the automatic start of
  round 2 one break later, the end.

## History with nine seeded weeks (98 synthetic sessions)

Week arrows through nine weeks and back, the week picker, Trends (weeks and months, both
charts), both share cards copied, the reports for a five-hour session, a session with no
timeline, one with sixty apps, one crossing midnight, an abandoned one; rename a row and set
it to count as a distraction (the rule appears on the list); delete a session; delete all
history.

## Still open

- A 90-minute session started by itself once, 20 s after a Pomodoro ended, while the debug
  build sat on the desktop during an unattended run. Not reproduced in nine further sessions.
  Every start now records what started it (`start` event), so a repeat will say.
- Arc beyond its sign-in window, and the webcam's phone detection (one 3-second false
  positive was seen while nobody was in view), need a person at the desk.

Supervisor is a focus timer that talks back. Start a session, and when a distraction stays open it pops a card and a voice you picked tells you to get back to work.

Everything runs on this computer. No account, no server, no analytics. It reads which app is in front and the address in the browser's address bar, never the page. History stays in a local database you can delete from Settings.

**In this release**

- Sessions with Gentle, Normal and Strict reminders, Pomodoro rounds, a small session timer in the corner.
- Two starter voices, Derek and Elise, with lines in four personalities: Gentle, Stern, Gen Z and Mom. Every line is text you can rewrite.
- Record anyone's voice and generate the lines in it. The voice engine is a download of about 2 GB the first time; when the engine is updated it downloads again. It runs only while lines are being generated and for a couple of minutes after.
- Optional webcam: a phone or watch in view counts as a distraction, and nobody at the desk for a minute counts as away. Frames are read and thrown away.
- History by day, week and month, with session reports.

**Install**

- macOS 14 or later, Apple Silicon: one line in Terminal installs it and the same line updates it.
  `curl -fsSL https://raw.githubusercontent.com/pr4nav3/Supervisor/main/scripts/install-mac.sh | sh`
- Windows 10 or later, 64-bit: one line in PowerShell installs it and the same line updates it.
  `irm https://raw.githubusercontent.com/pr4nav3/Supervisor/main/scripts/install-win.ps1 | iex`
  Or run `Supervisor-windows-x64-setup.exe` yourself. The installer is not code-signed yet, so a downloaded copy shows "Windows protected your PC" the first time: choose More info, then Run anyway.

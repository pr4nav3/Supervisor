# Landing page: audit and plan

Written 2026-11-03. The site is `docs/` on GitHub Pages (`index.html`, `styles.css`, `site.js`,
self-hosted fonts, no scripts from outside, no analytics). The name is still open
(`plans` has nothing on it; the naming thread lives in a chat), so every "Supervisor" on the
page is a token to swap, and the domain comes after the name. None of the work below waits
on either.

## Part 1: where the site breaks the app's rules

Checked against `plans/SUPERVISOR_UI_GUIDELINES.md`, `src/styles.css` (the tokens the app
really uses), `AGENTS.md` (the words users see) and the app as it runs today.

### Tokens and type

| On the site | In the app | Fix |
|---|---|---|
| Dark canvas `#14120e`, panel `#221f18`, soft white `#2c2820`, muted `#a89e89` | Charcoal `#40403c`, `#353530`, `#4c4b46`, muted `#ddd5c5`. The guideline says charcoal, never near-black, so black hard shadows stay visible | Copy the app's dark tokens exactly |
| Dark border `#f6ecd8` (cream) | `#151512` (near-black on every surface) | Same |
| Cobalt `#3267ff` for the Away state and every focus ring | No blue anywhere; the guideline forbids it. Away is panel-alt cream `#eadfc9` with ink text | Drop cobalt; Away goes cream; focus rings in ink |
| Green `#a8eb37` | `#a8eb37` | Keep (the guideline's `#b7ff3c` is older than the app) |
| Radius 5px cards, 4px controls | 7px cards, 6px controls | Match |
| Shadows `rgba(17,16,14,.68)` light, `rgba(0,0,0,.8)` dark, plus a 7px "big" shadow | Same light value; dark is `#0b0b09`; the app never uses a 7px offset (4px cards, 2px controls, 3px lifted) | Match; retire the big shadow |
| Archivo for headlines and the wordmark | Inter only, weight 750, tracking -0.03em for titles | Inter everywhere; one font file fewer |
| Grid line `rgba(16,16,16,.045)` | `rgba(16,16,16,.1)` light, `rgba(255,255,255,.12)` dark | Match |
| Buttons 46px, mono uppercase, hover lifts 1px | 40px, mono uppercase, no hover lift, press sinks 2px with the shadow gone | Match the press; drop the hover lift |
| Accent surfaces override `--panel` to translucent white | Colored surfaces get `#141410` ink and keep their color in both themes; nothing translucent | Same rule, plain values |

### Words users see (`AGENTS.md`)

| On the site | Rule or fact | Fix |
|---|---|---|
| "Snooze the reminders" | The control is "Mute for 5 min" | Mute |
| "Always allow" on the live card mock | Removed from the card on 2026-10-31; the list in Settings is the way out | "Allow once" and "Back to my task" |
| "Mum" voice | The starter voices are Derek and Elise; the personality is "Mom" | Use the real names |
| "Elapsed 36:40 · Reminders 0" on the state card | The card shows time left, the goal, the live strip; "Locked in" is now "On task" | Draw today's card |
| "Idle time: so it stays quiet when you've walked away" | The idle rule is gone (2026-10-30). Away comes from the webcam or sleep only | Say so, or drop the line |
| "The window title: what tells a work tab from a distraction" | It reads the address bar (UI Automation on Windows, Accessibility on a Mac), never the title or the page | "The address of the page in front" |
| "Record about twenty five seconds" | The app says about twenty seconds | Twenty |
| "12 lines · ready" | A personality ships 20 lines; the Phone set has four | Real counts, or none |
| "Five common ones are on the list" | True: youtube, netflix, tiktok, instagram, reddit | Keep, and name them |
| "V1 · October 2026", "October 2026" in the header, both download buttons, the title tag | It is November and nothing shipped | Replace with a real state (see Part 3) |
| "Early builds are unsigned, Windows will warn you" | Mac builds are signed with the Supervisor Dev certificate and install by one `curl` line; Windows is undecided and will show SmartScreen | Tell each OS its own truth |
| "Runs on CPU" chip | True, and the GPU is optional; the voice engine is 2 GB | Keep |
| "Read the source" → github.com/pr4nav3/stealth-startup | The repo is public (the Mac installer depends on it) | Keep; link to the release page too |
| Nothing about Pomodoro, the streak calendar, the day card, the report, the Getting started practice | All shipped since the page was written | Part 3 decides what earns a place |

### Structure that is off-system

- The hero mock is a made-up screen (chips "Distraction open / Normal", an elapsed meter). The
  real card is a colored slab with the state as its title, the goal, a big timer and the live
  strip, and the real timer window is the small card in the corner. Mocks must be the app.
- The "Camera check" panel draws a face box and a phone box with a verdict row. The app's webcam
  page shows a preview and a single phone verdict; there is no face label on screen.
- The page is 4,335px tall at 1280 wide and 670 words; seven sections before the download.

## Part 2: research

Two passes on 2026-11-03: one on the evidence (studies, large-sample conversion data,
practitioner opinion, each labelled), one a survey of the best indie app pages read that day.
Sources sit in the chat that produced them; the claims below carry their label.

### What has evidence behind it (strongest first)

1. **Speed.** Bounce odds rise 32% as load goes from 1 s to 3 s (Google/SOASTA, mobile); a
   0.1 s gain moved retail conversion 8% and lead-form progression 22% (Deloitte/55, 30M
   sessions). Large vendor samples, consistent with each other. No autoplay video in the hero;
   one light image; fonts already self-hosted.
2. **The first screen carries the page.** Eye tracking: 57% of viewing time is above the fold,
   74% in the first two screens (NN/g, 120 people). What it is, who it is for and the one action
   must all be in that screen.
3. **Plain beats clever.** MECLABS' repeated tests: the plain headline won by 44% to 330%.
   Unbounce's 41k-page benchmark: software pages at a 5th-7th grade reading level converted
   at 12.9% against 2.1% for professional-level copy; the best band was 250-725 words
   (correlational, vendor). Our page is 670 words; keep it under ~600 and simpler.
4. **Looks decide credibility in 50 ms** (Lindgaard 2006) and 46% of credibility comments cite
   design (Fogg, 2,684 people). The app's own system, done exactly, is the credibility.
5. **Signing.** macOS 15 removed the right-click-Open bypass: an unnotarized app now takes a
   trip through System Settings and two dialogs. Windows SmartScreen warns on unsigned files
   on every new version and Smart App Control can block them outright. Documented by Apple and
   Microsoft; the size of the loss is anecdotal. Our Mac path (one `curl` line, no quarantine
   flag) sidesteps Gatekeeper and must be explained in one sentence; Windows is undecided.
6. **No form before the download.** Each field costs a little (HubSpot, 40k pages, old); a
   waitlist loses about half its signups past a month of waiting (second-hand benchmarks).
7. **Privacy as a short checkable list, not prose.** Label-style notices beat policies on
   accuracy and speed (Kelley et al., CHI 2010, N=789). People trust what they can verify
   themselves: webcam covers beat LEDs (CHI 2018, 2015). "All local" alone did not save
   Microsoft Recall; opt-in, off-by-default and a visible switch did.
8. **Phones arrive.** About 80% of software landing visits are mobile (vendor). Nobody has
   measured the fix; Session (stayinsession.com) shows a QR code beside the Mac download.
9. **Contrast, labels, alt text.** 95% of top homepages fail WCAG checks; conversion impact
   unmeasured; cheap.
10. **Social proof near the action, never a tiny number.** Norm research says "join 12 others"
    backfires. Every focus app shows a number or a press row; with none yet, a real quote or
    nothing.

### What the evidence does not support

- An explainer or autoplay video in the hero (the Dropbox +10% has no source; one 2026 scan
  of 2,000 pages found autoplay heroes at -7%).
- "Exactly one call to action" as a law (choice-overload meta-analysis of 50 experiments: mean
  effect about zero). One primary action plus a quiet secondary is fine.
- Interactive or playable heroes lifting downloads (only B2B vendor engagement data exists).
- Humour or a mascot driving installs (humour raises attention and liking of the ad, Eisend
  2009; Duolingo's numbers are its own).
- A pre-launch waitlist when a build exists.
- Precise rules on page length or section count. Moz's 6x longer page won; Highrise's short
  page beat its long one. Length follows how much explaining the product needs, and a free
  download needs little.

### What the leaders do above the fold (checked 2026-11-03)

Polished, not playful. The playful touches are small: Forest's sapling, Sukha's "Nah, distract
me" button next to the real one. Primary action is a direct download or a store badge
(Opal, Forest, Session, Raycast at the page bottom); only the subscription apps gate on an
account (Freedom, Rize, Sukha). Privacy, where it appears, is one line in the subhead (Rize:
"No surveillance") or a mid-page claim (Cold Turkey, Obsidian). Nobody shows install-warning
instructions on the homepage; they live on the download page or in docs.

### What the best indie pages are built from (37 pages read 2026-11-03)

The skeleton shared by the strongest (Screen Studio, CleanShot, Rize, Mimestream, Obsidian,
Dato, Timing):

1. Slim nav: Features, Pricing, Download, Changelog or Help.
2. Hero: a one-line promise with a twist ("Stay on top of your time. Without timers."), one
   line on how it works, one button that names the platform, a quiet second action, and small
   print under the button (requirements, "no credit card").
3. Proof straight under the hero: logos, a count, a rating, or a quote.
4. Four to eight feature sections, each a short verb heading, one sentence, one visual.
5. A privacy section written as itemised facts, not a policy link (Rize: what it reads by
   default, what it never reads; Screen Studio: "Offline first." then every exception named).
6. Named, linked testimonials.
7. One price, plainly ("$18, one-time purchase").
8. An FAQ for platforms, data, refunds.
9. The download button again, with requirements again.
10. A footer with changelog, privacy, support, press kit, and maker artefacts (roadmap, older
    versions, "three people in North Texas").

What the top pages do that weak ones never do: requirements beside the button; a way out for
phone visitors ("Email me a link", a QR code); privacy as specific claims; one plain price;
tabbed or interactive demos instead of a hero video; something that shows a maker is home.

Playful touches in the focus niche are few and all name an enemy or laugh at the user's own
lapse: Forest's trees that die, Sukha's "Nah, distract me" button to TikTok, Cold Turkey's
"Big Tobacco Tech" and its mascot, Opal's "No way out" hard mode. Nobody in the niche puts
audio on the page. Nobody shows a voice. That is the gap this product fills by itself.

Pages to copy structure from: Screen Studio (skeleton, download block), Rize (privacy for an
app that watches you), Obsidian (values trio, OS-detected button with "More platforms"), Cold
Turkey (the enemy, local-first, three-step install), Mimestream (compact, requirements under
the button, a footer that shows the makers). Dead or changed since they were famous: Serene,
Centered, Rewind, Arc (sunset 2026-12-22), Klokki (on hold).

## Part 3: the plan

**Built 2026-11-03.** Items 1-16 are in `docs/` (137 KB in all: page, one font, two clips,
the icon). Decisions taken: the name stays "Supervisor" for now and is plain text, so the
rename is one line (`grep -l Supervisor docs/index.html docs/site.js` then sed; the theme
key `supervisor-theme` and the mailto subject are the only non-copy uses); the button is
honest ("Free. Not out yet.") with the Releases link and no third-party list; Windows small
print says SmartScreen until `plans/distribution.md` decides; two starter clips are on the
page (Elise, Gen Z: "Respectfully, get back to it."; Derek, Stern: "That isn't the work.
Close it."), MP3 at 64 kb/s from the app's own WAVs; the page says Free. Skipped: a QR code
(no domain yet; add one when there is), real screenshots (the cards are the app's markup in
the app's tokens, which is sharper than a PNG and themes itself). When a build ships, fill
`RELEASES` at the top of `site.js` and the hero button links straight to it.

Ordered by what the evidence weighs most, then by cost. Each item says what changes and why.
Sizes: S under an hour, M a few hours, L a day.

### A. The first screen (highest weight)

1. **One plain headline, one line of how, one button.** [M]
   Headline candidates (5th-grade words, the twist last): "A focus timer that talks back." /
   "Get distracted and someone you know tells you off." / "The focus timer with your mom's
   voice." Subhead: "Start a session. Open YouTube for too long and a voice you recorded tells
   you to get back to work. Everything stays on your computer." Cut the current 60-word lead
   to two sentences.
2. **The real app in the hero, not an invented screen.** [M]
   Today's mock is a fake card. Replace with the actual timer window (the small corner card:
   "On task", the goal, "29:58 left", the bar, pause/stop/More) drawn from the app's own CSS
   tokens, with the reminder card beside it ("You opened YouTube." with the play orb, "Back to
   my task", "Allow once"). Both are the real markup; both exist in `mock.html` already.
3. **The gimmick: let the page catch you.** [M]
   The product's whole pitch is a voice, and no page in the niche has sound. Under the hero
   buttons, a second, quieter button in Sukha's spirit: "Or open YouTube instead". Clicking it
   slides the real reminder card into the corner of the page and plays one of Elise's or
   Derek's actual lines ("Hey, that's not what we're working on."), from a clip in
   `src-tauri/voices/`, served from `docs/assets/`. Click-to-play only (autoplay is the one
   hero element with evidence against it); a "Hear a reminder" play orb does the same for
   people who skip the joke. This is the 5-second test and the demo in one, with no video.
4. **The button says what you get on your OS.** [S]
   `navigator.platform` picks "Download for macOS" or "Download for Windows", with "Other
   platform" beside it, as Obsidian does. Until a build is public (see decision 2), the button
   is honest: "Coming to macOS first", with the GitHub Releases link for people who want to
   watch. No October 2026 anywhere.
5. **Small print under the button, like every top page.** [S]
   "macOS 14 or later on Apple Silicon · Windows 10 or 11 · free · no account". Requirements
   are what weak pages never state.
6. **Phones.** [S]
   On a phone the download button becomes "Email me the link" (a `mailto:` to the visitor
   themself is enough: it opens their mail app with the link in the body; no server) plus a QR
   code to the page. Four of five visitors from a shared link will be on a phone and cannot
   install.

### B. Proof

7. **No fake numbers, no empty testimonial wall.** [S]
   There are no users yet, and "join 12 others" research says small numbers hurt. Use what is
   true and checkable: "Open source" with the GitHub link, "No account, no analytics, no
   servers: check the network tab", the model sizes, and a one-line "who made this".
   Add real quotes the day there are real quotes; leave the slot out until then.

### C. Sections: cut, keep, add

8. **Cut to five sections after the hero.** [L, part of the rebuild]
   Today: Features grid, pause/snooze split, Voice, Camera, Privacy, Download, plus notes,
   seven in all, 4,335 px. The page needs little explaining (free download), and the top two
   screens get 74% of attention. Proposed order:
   1. **How it works**, three steps in the app's own cards: Start a session (the start screen
      chip row) → Drift (the reminder card) → See how it went (the report with its live strip).
      Each step is a real screenshot or the real markup. Replaces the four-card feature grid
      and the pause/snooze split.
   2. **The voice**: record twenty seconds, pick a personality (Gentle, Mom, Gen Z, Stern),
      lines generated once and played instantly offline. Show the real voice card and three
      real lines as play orbs.
   3. **The phone** (camera, optional): one sentence that it is off until turned on, counts a
      phone only when it sees one, frames read and thrown away. The real webcam page screenshot.
   4. **What it sees**, the privacy table (item 9).
   5. **Download**, the block from A, repeated, with the install note per OS (item 10).
   Pomodoro, the streak calendar and the day card get one line each inside step 3 ("Rounds and
   breaks, a streak, a card you can share"), not sections of their own.
9. **Privacy as a two-column table of checkable facts.** [S]
   Label-style notices beat prose in a controlled study. Columns: *What it reads* (the app in
   front; the address of the page in front, read from the browser's address bar, never the
   page; whether the webcam sees a phone, only if you turn it on; sleep) and *What it never
   touches* (what you type; your screen; page contents or history; your microphone outside a
   recording you start; anything off this computer). Then one line: "Everything lives in one
   folder. Delete a voice, a session or all of it." Replace "idle time" (gone) and "window
   title" (wrong) with the true items.
10. **Install honesty per OS, on the download block, not the hero.** [S]
    Mac: the one `curl` line and why it is one line (no App Store, so no Gatekeeper trip);
    Windows: whatever decision 3 lands on, with the SmartScreen "More info → Run anyway"
    sentence if it is a direct download. Both as small print, as Cold Turkey's three steps.
11. **Footer that shows a maker is home.** [S]
    Changelog (GitHub Releases), source, privacy page, contact, "built with Tauri and Rust".
    Drop the nav duplication.

### D. Make it the app's system, exactly (Part 1)

12. **Replace `docs/styles.css` tokens with the app's.** [M]
    Dark charcoal canvas and panels, `#151512` borders, `#0b0b09` shadows, no cobalt, Inter
    only (drop Archivo and its font file), 7/6 px radii, the app's grid line, buttons that
    press without a hover lift, the colored-surface ink rule as plain values. The cleanest
    path: the site's stylesheet imports the token block from `src/styles.css` verbatim (copied,
    since Pages serves `docs/` alone) and builds only page layout on top.
13. **Words.** [S]
    Mute, Allow once, Back to my task, reminder, line, personality, voice engine, start screen;
    Derek and Elise, not Mum; twenty seconds; real line counts; "On task". Title tag and meta
    description rewritten with the new headline.

### E. Speed and basics (cheap, well evidenced)

14. **Keep it under 150 KB and one request per asset.** [S] One font file, SVG icons, PNG
    screenshots compressed, audio clips as the app ships them (short OGG/WAV, a few KB each),
    no video. Preload the font, inline the critical CSS for the first screen.
15. **WCAG basics.** [S] Contrast on every chip in both themes (the muted dark `#ddd5c5` passes
    where the site's `#a89e89` does not), labels on the theme button and the play orbs,
    `prefers-reduced-motion` kept, focus rings in ink.
16. **Dark mode stays, follows the OS, no forcing.** [S] Already so; just the right tokens.

### Decisions needed before coding (none block the structure)

1. **The name.** Every "Supervisor" is a token in one template string; the domain follows.
2. **What the button does today.** A: honest "Coming" with Releases link (no form, no service).
   B: a mailing list through a third party (Buttondown etc.), which is the first outside
   request the site would make. Evidence says a build beats a waitlist; I would take A and
   ship the Mac installer line the day the name lands.
3. **Windows distribution** (`plans/distribution.md`: undecided). Direct download with
   SmartScreen, or Microsoft Store. The page's Windows small print depends on it.
4. **Voice on the page.** Starter clips are the app's assets; putting two of them on the site
   is the gimmick. Yes or no.
5. **Price.** Free, and say "free"? The page should say one word about money; today it says
   nothing.

### What I would not do

- A hero video or an autoplay anything.
- A mascot or a cartoon. The app's system is restrained neo-brutalism; the voice is the
  character.
- A features grid of twelve cards, a comparison table, a FAQ accordion of fifteen entries.
- Any third-party script: analytics, fonts, widgets. The site's own rules are the app's.
- Numbers that are not true yet.

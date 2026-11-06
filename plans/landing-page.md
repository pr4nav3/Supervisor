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
| "Read the source" → github.com/pr4nav3/Supervisor | The repo is public (the Mac installer depends on it) | Keep; link to the release page too |
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

## Part 4: beauty pass (2026-11-03)

The built page is on-system but it is still a page of sections and 760 words. The brief now:
very little to look at, each thing exactly right, motion that feels like the app. A second
research pass (27 sites measured in the browser for computed motion, plus the primary writing
on motion craft: Emil Kowalski, Rauno Freiberg, Josh Comeau, Vercel's guidelines, Apple HIG,
Material 3) says the beautiful minimal sites share ten traits:

1. 30-80 words on the first screen, often under 700 on the page (Vercel 95, Once 68,
   Lapse 59, Arc's farewell 7 above the fold).
2. One display face, large and tight: 56-140 px, tracking -2% to -7%. Our Inter 750 at
   -0.035em is already this.
3. A big jump in the type scale (headline 3-4x body) with few sizes between.
4. One accent against neutrals; two or three greys; a warm off-black beats pure black.
5. Hover is a colour or a 1-4 px nudge in 100-180 ms; presses are 80-160 ms; nothing scales
   past 1.05. The app's lift (1-2 px, shadow grows the same, 120 ms ease-out) is textbook.
6. One ambient loop per screen (a marquee, a cursor blink, a voice meter), never two.
7. One entrance choreography, then stillness: rise 6-20 px with a fade, 300-700 ms ease-out,
   stagger 30-80 ms. The app's cal-pop (6 px, 320 ms, 70 ms stagger) fits.
8. The real artefact as the hero (Linear's app frame, Clerk's account UI), not illustration.
9. A single signature interaction (Figma's rolling label, Arc's keycap press, Granola's voice
   bars, Gumroad's lift).
10. Animate transform and opacity only; exits faster than enters; `prefers-reduced-motion`
    keeps fades and drops movement; hover effects gated on `(hover: hover)`.

Neo-brutalism specifically: Gumroad is the only famous site with hard offset shadows, and it
reads as beautiful because the shadow means "pressable" (only interactive things carry one),
there is one shadow size per element class, the element moves exactly the shadow distance on
hover, padding is generous (24-32 px), and nothing else moves. The app already obeys all of
this; the old site did not (a 7 px shadow, a hover lift on everything, blue).

Skipped on the evidence: magnetic buttons, parallax, scroll-progress bars, autoplay video.

### Three directions, mocked up in `plans/landing-mockups/`

All three share `base.css` (the app's tokens, cards and motion) and `mock.js` (the orbs and
a theme switch). Each is about 80-110 words. Open them at
`http://localhost:1420/plans/landing-mockups/<file>` with the UI dev server running.

**A · The corner** (`a-corner.html`). The first screen is a desktop: the headline at the left,
the real timer card top right where it lives, counting down for real (the one ambient loop).
Scrolling tells the story in the card: it holds still at the left while three short lines
pass on the right, and each line swaps the card's state (On task → the reminder with the orb
→ Session done), with the app's 6 px rise. Then one line on privacy and the download.
Signature: the card is alive and the page is the demo. Risk: sticky storytelling is the most
code and must never feel like scroll-jacking; the mock uses a sticky column and an
intersection observer, no scroll hijack.

**B · Three cards** (`b-cards.html`). Everything centred: the headline, one sentence, two
buttons, then the three cards the app is made of in a row (session, reminder, report), each
with a four-word mono caption, arriving staggered and lifting on hover exactly as the app's
share card does. Then the privacy line and the download. Signature: the composition itself,
and the orb that plays. The least code, the most whitespace, the easiest to get perfect.

**C · The poster** (`c-poster.html`). A headline at poster size (up to 7.4 rem), under it a
slow marquee of the lines the voices say as chips in the personality's colour (click the two
with audio to hear them; the rest to come as more clips are added), then two colour blocks,
green with the timer and coral with the reminder, one line each, then the download.
Signature: the marquee of lines, which is the product's humour on the page. Risk: the loudest
of the three; the marquee is the one loop and must stay slow (40 s) and pause on hover.

**Recommendation.** B as the base, with A's live countdown in its first card and C's marquee
as the only thing below the cards if the page wants one more beat. That gives one entrance
(the stagger), one ambient loop (the ticking timer), one signature (the lift and the orb),
under 100 words, and the whole app visible without a scroll.

## Part 5: Latent, read in full (2026-11-03)

trylatent.co, the user's reference. Read from its HTML, `site.css` and `site.js` (GSAP,
ScrollTrigger and Lenis vendored; one 60 KB stylesheet; 1,650 words, most of them inside the
replicas and quotes; 16,000 px tall).

**Shape.** Hero 760vh with a pinned stage → "How it works" as three pinned steps (360, 320,
320vh) → a lead quote that lights word by word, then two quote marquees at a steady pace →
FAQ with a sticky heading → a close with a giant line over a drifting mosaic → footer.

**The hero is a film.** One framed timelapse of a real session with the copy beside it. Over
the scroll the clip zooms out exponentially (so every stretch of scroll feels the same) to
reveal a wall of everyone's sessions, columns drifting at 10-16 px/s with the centre column
still. A radial scrim darkens, and the word "la·tent" and its definition develop word by word
(blur 9 px → 0, sepia and brightness lifting, a 10 px rise) "like a print in the tray", then
"Your work was always there. Latent makes it visible." Nothing is pinned by a library here:
the stage is `position: sticky`, a scroll trigger reports progress, and one `render(p)`
function maps it through a smoothstep.

**Three steps, three feels, one noun each.** 01 Record: pinned phone, 80 JPEG frames scrubbed
on a canvas, a 60-tick dial lighting up, three beats on the left, chips appearing. 02 Track: a
rail slides sideways from "Your history" to "Your numbers" (translate -50% over progress 0.3
to 0.7), numbers count up, a heatmap fills. 03 Share: a sheet folds up over the one below
(translateY 102% → 0), its corners flatten and its tone matches the page as it lands; the
sheet beneath scales to 0.94 and fades to 0.3.

**One easing everywhere:** `cubic-bezier(.22, 1, .36, 1)`. Transitions 0.35-0.9 s; reveals
as opacity and transform with staggered delays; the button arrow nudges 3 px on hover and the
button scales 0.985 on press. Lenis lerp 0.09. A thin line pulsing under "Scroll".

**Type and colour.** One serif at weight 400 for every headline (44-160 px, tracking -2% to
-3%), system sans body, a mono for labels; one accent (yellow #E8C95F) on a warm near-black;
1 px inset rings at 8% white instead of borders; step numerals in the accent at up to 124 px.

**Craft underneath.** Each column moves as one style write per frame; videos play only when
on screen; frames load only when near; Reduce Motion collapses every scene to a still page
with the name's definition in a band of its own; phones go to a separate page.

**What to take.** (1) The page is a film with one idea per scene, pinned, scrubbed, one line
per beat. (2) The product's own artefact is the hero: theirs is the timelapse, ours is the
voice and the card. (3) The name's definition as the brand beat, which fits a real-word name
exactly. (4) Three steps, one noun each, each with a different motion. (5) One easing, one
accent, numerals as graphics. (6) Reduced motion designed, not bolted on.

**What not to copy.** 16,000 px and 100 KB of libraries; dark only; a separate phone page;
the pointer tilt (no primary source recommends it); count-ups; the testimonial wall before
there are testimonials.

### Where that leaves the directions

The feedback on A, B and C: the card that changes is right but must be smooth and must not
be a screenshot; B's use of space is right but flat; C's colour and card feel is closest to
the app. So the next mock-ups abstract the app into its card language (a coloured slab with
one line and, on the reminder, the orb; no window chrome, no buttons, no dots) and borrow
Latent's film structure in the app's own system.

**D · The film.** Pinned hero: one coral card centred, "You opened YouTube." with the orb.
Scroll and it zooms out to a wall of cards on the app's grid, coral, green and yellow, each a
line in a voice ("Bro, lock in.", "Your phone is out.", "That isn't the work."), columns
drifting slowly, the centre one still. A cream scrim rises and the name's definition develops
word by word, then "A focus timer that talks back." and the button. Then three pinned
scenes, one noun each: Start (the chips assemble, the length fills), Drift (the card turns
coral, the line develops as the clip plays on click), Done (the strip draws itself, the tiles
fill). One privacy line. A close with the headline over the drifting wall. About 120 words.
Motion: the app's ease and lifts, hard shadows, no tilt, no count-ups, GSAP-free (sticky
stage, one progress function, smoothstep). Reduced motion and phones get E.

**E · The desk.** The same card language without pinning: headline and button over the wall
of cards drifting as the one ambient loop (click any orb to hear it), then three colour
blocks with one slab and one line each, then the close. C's structure, D's hero, half the code.

## Part 6: how to show the features (2026-11-03)

Clicky (heyclicky.com) read the same way: a playful desktop as the hero, its mascot blinking
on a 7 s loop, feature demos as draggable video windows, each feature one lowercase sentence
and a short clip, a founder's note, tweets, pricing, FAQ; 935 words, Inter and a mono,
transitions 120-620 ms on one ease-out curve. Its lesson is not the layout: it is that the
page is a stage where the product is already running, and you poke it.

**The order a stranger needs:** a focus timer (familiar in a second) → it watches the window
in front and a voice you recorded tells you off when you drift (the twist, and the only thing
worth a demo) → your phone counts if the webcam is on → you see your day after → everything
stays local → free, Mac and Windows.

**Principles.** Show the moment, not the screen. One sense per feature: the voice is audio on
click, the watching is the card changing colour as "you" change windows, the report is a strip
drawing itself, the streak is a calendar filling. The visitor is the subject, second person,
present tense: they drift by clicking the thing they shouldn't. The UI is abstracted to the
app's atoms (a coloured slab with one line, the orb, the strip, the chips), never a screenshot.

**Why D, the film, is wrong for us.** Latent's artefact is a video wall, which is beautiful at
any zoom; ours would be a wall of text. A pinned film needs six to eight scenes to earn its
libraries and we have three ideas. The dictionary beat needs a real-word name, and Supervisor
is a job title. What survives of D: one pinned card telling the story in colour, and the
strip as the scroll's own progress bar.

**Direction 1 · The catch.** The hero is a small stage in the app's system: a row of window
chips (Docs, YouTube, Reddit, Instagram, Phone) and the green card ("On task · philos 241
midterm · 29:58", counting). Click YouTube: a beat, the card turns coral, Elise speaks, the
line develops word by word. Click Docs or Back to my task: green again. The visitor plays the
product in five seconds and the headline sits beside it: "A focus timer that talks back."
Below, three rows, one moment each, one slab each: the voice (four personality chips, click to
hear), the phone (yellow slab "Your phone is out."), the day (the strip and a streak row
filling in). One privacy line. Download. About 90 words.

**Direction 2 · The day.** One card pinned centre; the page is one session. Scrolling runs the
timer and the card tells the story in colour: green → coral with the voice → green → yellow
break → "Session done" yellow. One line of copy per beat beside it. The live strip across the
bottom fills with the scroll, so the report draws itself and is the page's progress bar. At
the end the strip becomes the report card, then the day card, then download. About 80 words.
All colour changes 200 ms, the line develops word by word, nothing snaps. The one scrubbed
scene, no libraries; phones and reduced motion get the beats stacked.

**Direction 3 · The lines.** The product is the voice, so the page is its script: one giant
centred line that changes ("Why is it open?", "Bro, lock in.", "That isn't the work. Close
it.") with the speaker and the orb, the four personality chips switching it. Everything else
small. Then three slabs in a row for start, drift, done. The boldest type, the least to look
at.

**Recommendation.** 1 as the hero, 3's changing line as the voice section, 2's strip only if
the page wants one scroll moment. Keeps everything the user kept from A (the thing that
changes), B (space), and C (colour, cards).

## Part 8: why the simulated-app hero is wrong, and what replaces it (2026-11-04)

The user's instinct, before the research came back: they do not want visitors getting the
app experience on the website. My diagnosis of the current hero (a drawn browser with tabs,
the corner card, and the catch you trigger):

1. **It asks for work before it has given a reason.** The payoff (the card turning coral,
   the voice) sits behind reading a fake desktop, finding the tabs, guessing they are
   clickable, clicking, and waiting. Most visitors will not; what they see is a mock browser
   with a green box beside a headline, which is the most generic software hero there is.
2. **It is a tutorial, not a promise.** A first screen's job is to make someone feel
   something in a second. A simulated UI explains mechanics: tabs, cards, buttons. Mechanics
   belong on the second screen, after the visitor cares.
3. **Fake UI reads as fake.** A drawn Chrome with grey lines is neither the real thing (so it
   earns no credibility) nor an object (so it earns no beauty). It sits in the uncanny middle.
4. **It makes the site about the app's interface, which is deliberately plain.** The
   product's magic is the voice and the moment of being caught. The UI is a small card by
   design. Showing the UI undersells the product.
5. **It spends the surprise.** The catch is the product's one moment of surprise. Previewing
   it at a third of its size, on a click, before the download, takes it away from the first
   real session. The site's job is desire; the app's job is the experience.
6. **Two focal points.** The headline and a busy stage compete; the eye has nowhere to land.
7. **It is fragile.** Measured positions, a scroll-driven state machine, a phone layout that
   hides half of it, reduced motion as an afterthought. A composition degrades gracefully; a
   simulation breaks.
8. **It fixes the brand as a utility** ("a desktop app with tabs") at the moment the naming
   work is moving toward a real-word brand with a feeling attached.

Where it does work, for others: Stripe's "seven lines of code", tldraw and Excalidraw (the
product is the canvas), Clerk's live components (the product is the component). In each the
product's whole value is the thing on screen. Ours is not; ours is a voice and a feeling.

### What the research added (three passes, 2026-11-04)

**The evidence against a demo hero.** Appeal is judged in about 50 ms and the most prominent
element decides the verdict (Lindgaard 2006; Fogg 2002; NN/g 2017). The homepage is an
elevator pitch, and NN/g says not to animate the headline or put moving things beside it:
users read moving panels as ads, and one missed 98-point text because the panel next to it
moved (Nielsen 2013). A field of equal-weight controls causes strain (NN/g 2017). 37signals'
short page built on a feeling beat the explaining page by 47%, and adding explanation back
cost 22%. Demo heroes work only when the demo is the real product and pays off in seconds
(Stripe's seven lines, tldraw, Clerk); a desktop app reading window titles cannot be real in
a browser. Sound: never autoplay (Chrome policy, WCAG 1.4.2); one labelled click-to-play
line near the headline is fine, with the words shown as text.

**What the best first screens are (65 read live).** Across all 65, 37% show the UI literally
and these are the conversion-style SaaS pages. In the design-celebrated twenty (Linear,
Raycast, Family, Cosmos, Fey, Readwise, mymind, Are.na, Things, Teenage Engineering, Pitch,
Stripe, Vercel, Clay, PostHog, Zed, Resend, Cal.com, Dia, Arc) 17 evoke the product rather
than show it; of five current Awwwards winners, none shows a UI. What the evokers do: a
product fragment inside the headline (Cal.com's three chips between the words, Notion's
pill, mymind's coloured outline words); content or outputs instead of chrome (Readwise's
highlight cards, Figma's artifacts, Pitch's slides); fragments scattered at the viewport
edges with the type in the centre, rotated 2-6°, cropped, static (Capacities, Family); one
object as a monument (Vercel, Things, Teenage Engineering); type alone with a 600-1300 ms
entrance (Raycast, Fey, Pitch), ambient loops at 30-63 s.

**Cards, measured.** The beautiful card pages have one focal object (Linear one frame,
Notion one pile, Mercury one cycling deck), the focal card about 1.5x the others and in the
strongest colour, satellites smaller and partly covered, one shared border and shadow size,
a load sequence under 600 ms, one ambient motion. The busy ones have two marquees, the same
loud shadow on everything, big shadows plus rotation, cards crossing the headline, and
springy long eases on hard-shadow UI. Gumroad's hover is translate(-2,-2) with the shadow
growing 4→6; press is +4 with the shadow gone; 150 ms.

### Six replacements, in the app's system

All are scenes you look at, not stages you operate. The only interaction on the first screen
is one click-to-play line. Nothing simulates the app.

1. **Caught: one card and two satellites.** A large coral card, about a third of the width,
   "You opened YouTube." with the line underneath and the orb. Behind it up-left the green
   "On task · 24:13" card at two-thirds size, rotated -2°, overlapping 24 px. Tucked bottom-
   right a small voice card with waveform bars, +1.5°. The satellites rise first (0 and
   70 ms), the coral last (140 ms), 320 ms each on the app's curve. The timer ticks; nothing
   else loops. Hover lifts a card 2 px with the shadow growing to 6. Clicking the coral card
   plays the line. Headline at the left, one button. The product reads in five seconds:
   timer, catch, voice.
2. **The line in the headline (Cal.com).** "A focus timer [green timer chip] that talks
   back [coral chip: "Why is it open?"]". The chips are the app's atoms at 0.86 em, sitting
   between the words, bordered and shadowed. The coral chip's line swaps every few seconds
   with a 200 ms crossfade; click plays it. Nothing else on the screen but the subline and
   the button. The cheapest and the most distinctive.
3. **Fragments at the edges (Capacities).** Centred headline and button; six to eight of
   the app's atoms scattered at the viewport edges, each cropped by the edge, rotated 2-6°:
   the green timer card, a coral line card, the yellow Session done bar, a streak row of
   squares, two distraction chips, the voice card. Static, hover lift only. Costs nothing,
   degrades perfectly, and the page is instantly "full".
4. **Travelling lines (Readwise, in cards).** Five to seven cards carrying lines of speech
   in their personality's colour drift along a curve from bottom-right to top-left behind
   the type, one loop a minute, no skew, no blur, the app's borders and shadows. The one
   ambient motion on the page. Beautiful if the cards are sparse; busy if there are more
   than seven.
5. **Type with the line (Fey, Raycast).** Headline, and under it one line of speech that
   blurs in word by word in the personality's colour and swaps every six seconds; speaker's
   name in mono; click plays. Nothing else. Boldest and emptiest; the voice section below
   has to carry the visual weight.
6. **Converge on scroll (Granola).** On load, three cards sit scattered (timer, line, report)
   at the edges; as you scroll they slide together into one status window, then fade. CSS
   scroll timelines, no JS. The one scroll trick worth keeping, if any.

**Recommendation.** 1 as the hero, with 2's behaviour on the coral card (the line cycles,
click to hear) and 3's cropped fragments only if the screen still feels empty after the
trio is in. Below: the voice box as it is; "how it works" as the three-card story strip
(On task → You opened YouTube → Session done, left to right, 80 ms stagger, the bar filling
once); the close. No browser mock, no tabs, no scroll-driven stage.

### Mocked up: `plans/landing-mockups/caught.html` (2026-11-04)

The recommendation, built. Hero: words at the left (headline, one line, Download, "Free ·
macOS and Windows"); at the right the trio in a 440 px field: the green On task card at the
top-left (250 px, -2°), the coral "You opened YouTube." card as the focal object (420 px,
with the orb and the line), the voice card bottom-right (230 px, +1.5°, name and waveform).
They rise in at 60, 130 and 200 ms, the focal last. One shared border and shadow (4 px);
hover lifts a card 2 px with the shadow at 6. The timer ticks. The focal card's line cycles
every six seconds through four speakers and personalities (title, speaker, line and the
voice card's name all change together, the line developing word by word); clicking the
card plays the two lines the site has clips for, and both the orb and the waveform go
green while it plays. No browser, no tabs, nothing to operate but that one click.

Below: "How it works" as one panel of one sentence, then three cards left to right (On
task → You opened YouTube, with Derek's line → Session done, with the bar drawing itself
once) arriving 80 ms apart when they scroll in, each with a short caption. Then the voice
box, then the green close with the themed Download button below it. 110 words on the page.

Checked at 1280 and 375 wide, light and dark: the trio sits inside its field, nothing
overflows, the click plays, the strip arrives once.

## Part 9: the demo goes second (2026-11-04)

The user prefers the demo mock-up to the caught trio, but as the second screen, Latent's
way: one opening animation beside the headline, then the demo on scroll, then the voice and
the download. `ideal.html` rebuilt once more:

- **First screen: one card on a loop.** Beside the headline, one status card the size of a
  hand: green "On task", the goal, the time left and its bar ticking down. After about four
  seconds it turns coral, "You opened YouTube.", and Elise's line develops word by word with
  the orb; five seconds later it is green again, and the next time round it is Reddit and
  Derek. The card is exactly as tall as what it shows and animates between the two heights.
  Click it to hear the line. Nothing else moves on the first screen.
- **The demo, with every card alone.** No frame around the status card, no frame around the
  desk, no grid-on-grid: the browser window, the webcam thumbnail and the status card sit on
  the page's own canvas. The four bars of the rail sit under the desk with no card, start
  empty and fill one per beat. The status card has the app's own "29:58 left" line and bar;
  the report card's bar is green for work, coral for the distraction, grey for away; the
  "Session done" card is the slab alone. The page inside the browser window is a rounded
  sheet inset from the frame, like Chrome, so the YouTube mark's corner no longer meets a
  square edge. The webcam thumbnail says only "Webcam".
- **The bottom, packed.** Two columns: left, the voice intro, the green promise and the
  Download button; right, the voice box and a small "This week" card whose squares fill
  green as it arrives, "Day 6 kept". The voice box's cards, chips and line card arrive one
  after another; the waveform draws itself bar by bar and sways green while a line plays;
  the "Record a voice" card carries a slow coral recording dot.

## Part 10: the deck, tab cards, and the bottom split (2026-11-04, later)

- **First screen: the deck.** The one loop card was weak. Now the reminders land one after
  another: the timer sits low at the left, ticking; a coral card drops onto the pile in front
  of it with the app's own drop (from above, a touch over size, settle, 450 ms), the older
  ones step back and fade (3 deep), a new one every 4.8 s, the lines developing word by word.
  Click any to hear it. The hero is 78vh so the demo's top edge is already in view.
- **Tabs as cards.** The browser frame is gone: three tab cards (7 px radius, 2 px shadow,
  the front one yellow) with a 14 px gap above the screen, which is its own card (7 px radius,
  4 px shadow). Click a tab card and the screen changes.
- **The reminder in its window.** In the middle the card sits inside the status window's
  frame with its buttons under it, Allow once on the left and Back to my task on the right
  as in the app; the phone card has Back to my task alone. The corner timer stays bare; the
  Session done card is bare and its stats wrap instead of clipping. Heights are measured
  with every transition off, so no face is cut.
- **The bottom, split.** The voice first ("Reminders in a voice you know."), its box walking
  through the personalities on its own every 4.2 s until you pick one; the week card is a
  decoration cropped at the right edge, not a block in the flow. Then the promise as one green
  slab with three chips. Then Download at the very bottom: macOS or Windows as two cards,
  macOS showing the one-line Terminal command with Copy, Windows a download button; the
  visitor's own system is picked first.

## Part 11: one screen at a time (2026-11-04, evening)

The page is now a sequence of screens the scroll rests on: the words and the deck; the four
beats of the demo (a snap point at each beat's resting place inside the pinned scene); the
voice; the promise; the download, centred, with the footer under it. Native scroll snapping
(`y mandatory`, `scroll-snap-stop: always` on wide screens with motion allowed; off on
phones and under reduced motion), so a flick moves exactly one screen and nothing is ever
half-there, with no scroll hijacking. Each screen's contents rise into place when it arrives,
and the voice box starts its tour then. The week card is gone.

## Part 12: `scrub.html`, Latent's way (2026-11-04, night)

A separate build beside `ideal.html`, answering the empty-space problem the way the measured
sites do: scale, pinning and continuous scrub, no snapping.

- **Scale.** Shell 1240 px. The deck fills three quarters of the first screen's height, the
  catch cards 560 px wide, the timer 270. The demo's desk runs to 760 px tall in a 9-of-13
  column, slide text up to 2 rem. The voice box is as wide as the demo. The promise is a
  full-bleed green band with a 3.8 rem line. The download owns the last screen.
- **Continuous scrub.** The demo is one `render(p)` of scroll progress through the 460vh
  scene, every value a smoothstep over a range: 0.18-0.30 the card slides to the middle,
  widens from 240 to 380, turns green to coral, grows its frame and buttons, YouTube fades in
  front and the line's words arrive one by one; 0.44-0.56 coral to yellow, the phone face,
  the webcam rises, Docs returns; 0.70-0.82 the report, the screen dims, the buttons go, and
  each run of the bar draws in turn through 0.76-0.96. Copy slides cross over on the same
  curves. The rail fills continuously. Scrolling back reverses everything exactly.
- **No snapping anywhere;** parts 120 px apart at natural height.

## Part 13: the ending as a dealt stack (2026-11-04, late)

Verdict on the two endings so far: the one-screen-per-part version of `ideal.html` left dead
space between parts, and `scrub.html`'s natural-height run read as a plain page. Neither felt
like the first two screens. The ending now in `ideal.html` keeps the deck and the demo as they
were and replaces the three parts after them with three cards that deal onto each other.

- **The stack.** One `.stack` shell holds three `.deal` cards, each `position: sticky` with a
  top of 76 px plus 16 px per card and a height of the window minus 160 px, a 28vh gap under
  each. Scrolling slides the next card up over the one before, which stays put under it and
  drops its 4 px shadow once covered (the scroll handler toggles `.covered` when the next
  card's top reaches its own). No snapping anywhere: proximity snapping and the
  one-screen-per-part `.stop` sections are gone. The footer follows the last card directly.
- **The voice card** is two equal halves. The interactive half (voices, personalities, the line
  with its orb and waveform) is on the left, the words on the right in the soft white, a
  border between them. The tour still starts when the card arrives.
- **The promise** is a green card inside the shell, same frame and shadow as the others, not a
  full-bleed band. The headline runs to 3.8 rem on a wide window.
- **The download** is the last card: section head left, the two computer cards and the
  Terminal line or the Windows button on the right, all centred vertically.
- **Under 920 px** the cards stop being sticky and stack in flow with 24 px between them;
  the voice card goes to one column with the words under the controls.
- **Demo dim.** The desktop page now steps back to 0.7 opacity for every popup (caught, phone,
  session done), not only for the report at 0.45. A session with nothing to say stays at 1.

Second pass, same night. The first stack was too tall and too wide, and the voice card was one
card cut down the middle. Now: the stack is 880 px wide, each row is `min(480px, 64vh)` tall,
and a row is one card or two cards side by side with an 18 px gap (the voice controls left,
the words right, each in its own frame). Rows are spaced with grid gaps rather than margins,
because a sticky element's margin shrinks the box it may stick in and pushed the earlier
cards up out of the stair at the end. The stack ends with all three rows parked 18 px apart,
then the footer.

## Part 16: the watcher (2026-11-05, later)

Verdict on the first-screen visuals so far: the pile and the line card are both the
reminder card again, which the demo shows better one screen down; words alone leave the
claim unproven. The one object on the page people reacted to was the eye.

So the fourth variant (`?hero=eye`, now the default) is the app's eye at 300 px, the hard
6 px shadow, top-left of the right column. It follows the pointer across the whole page and
blinks. Leave the page (the pointer crosses the window edge, or the tab goes to the
background) or stop moving for seven seconds, and a coral reminder card pops bottom-right of
it: "You left." / "You switched away." / "You stopped.", the voice line underneath, the task
strip; the eye winks and turns to look at the card; a press plays the clip; it goes away
after nine seconds. Elise and Derek alternate. That is the product's sentence acted out
without a screenshot: it watches, you drift, it talks. On a phone there is no pointer, so
the eye blinks and the idle timer still fires once.

The eye now appears twice, here and on the promise card. Both follow the pointer. If that
feels like one trick too many, the promise eye could sit with its lid down (a closed eye
under "Everything stays on your computer" says the same thing), opening only on hover.

Also: every voice card lifts on hover, the picked one and the record card too; the record
card still does nothing on a press.

## Part 17: the log (2026-11-05, later)

The eye as first-screen visual was turned down. The next candidate takes a different
angle: not the moment of a catch (the demo owns that) and not a mascot, but the thing the
app leaves behind, one session's record.

`?hero=log` (now the default) is one cream card, 440 px, the task name and the time at the
top, the report strip under it, and a list that prints itself a line at a time: Started,
Opened YouTube with Elise's line, Back on task, Opened Reddit with Derek's, Back on task,
Phone out, Back on task, and a green Session done row with the total. Each line adds its
run to the strip (green for work, coral for a catch, yellow for the phone), the strip's
run grows for as long as the line holds, the list keeps the last five, and after the
summary it pauses and starts the session again. Lines with a clip are small lifted cards;
a press plays the voice. Reduced motion prints the whole log at once.

Why it might be the one: it is the product's whole story in one object, with time in it,
and nothing on it is a reminder card. Why it might not: a list is quieter than a face, and
the strip could be read as a loading bar.

## Part 18: two more first screens, and a cull (2026-11-05, later)

The eye and the log were turned down, with the note that the visual need not be a feature
at all, just an animation that works. Pile, Eye and Log are removed from the mockup; Line
and Words stay. Two new ones:

- **Flip (`?hero=flip`, default).** A split-flap clock: four cards, 104 by 144 px, the
  panel cream, the ink frame, a 1 px hinge line across the middle, the cards' 4 px shadow,
  Inter at 750. Every second the ones digit folds down (170 ms in, 190 ms out, the app's
  ease) and the next value is under it; a blinking colon between minutes and seconds; the
  app's green bar filling under the digits, and the task name and On task in mono under
  that. It counts a 25-minute session for real. It is a timer, which the headline says, and
  a motion people stop to watch, but it is not the app's own timer and claims nothing.
- **Shuffle (`?hero=shuffle`).** Three blank windows, soft white with a coloured dot and a
  few grey lines, in a fanned stack. Every 2.6 s one comes to the front with the app's land
  drop and the others step back. A tag above names what is in front: green for Google
  Docs, coral for YouTube or Reddit, and the front window takes a coral outline for that
  beat. It is the thing the app actually watches, the front window, drawn as shapes.

Also: the dim behind a popup is an ink overlay at 12 percent, so the page keeps its colour
and only steps back (the filter made it grey). Popups other than the timer sit in the exact
centre of the page card.

## Part 19: the fan (2026-11-05, night)

Headline is now "The focus app that talks back."

Thinking further about what the visual is for: the headline says it talks back; the only
question a visitor has left is *how*. The app's answer is four personalities, and that
range is where the charm lives. So the visual is the four of them as a hand of cards.

`?hero=fan` (default). Four cards, 270 by 330 px, fanned to the right from a pivot below
the hand: Gentle on cream, Mom on yellow, Gen Z on coral, Stern on green, each with the
personality and the voice's name in mono at the top, the line in large type in the middle,
the orb and the waveform at the foot. Every 3.8 s the front card lifts away and lands at
the back while the others step forward, and the new front card says its line word by word
with the waveform moving. Hover lifts a card; a click on a back card brings it to the
front; a click on the front card plays the clip where there is one (Gen Z and Stern).
It is a cool object on its own, a hand of coloured cards, and every element on it is a
true fact about the product. On a phone the fan is narrower and the first screen clips any
overhang.

## Part 20: header, footer, the end of the stack (2026-11-05, night)

- The header is fixed: the wordmark and the Dark button stay on screen the whole way down.
  The Download button is gone from it; the first screen's button and the last card do that.
- The stack's rows now park so that the last row, once parked, has only the footer under
  it: the parking height is worked out from the window and the last row's height, and the
  room under the stack is the small remainder. A row also counts as covered once the end of
  the stack has pushed it above its parking spot, which a tall row under a short last row
  needs.
- The footer is one line under the stack, the same width: "Developed by Pranav Karthik"
  and a Feedback button that opens a mail draft.
- Revised the same night: the top bar is a solid strip of canvas with a rule under it, so
  nothing passes beneath it. Each stacked row parks centred in the window (the footer's
  height counted in), a row counts as covered once the next has slid over half of it, and
  the footer sits right under the last row with as much room below it as there is above
  the row, so the pair reads as one centred group.

## Part 21: the invisible bar, the centred first screen, the credit line (2026-11-05, late)

- **First screen.** Its contents are centred in the window below the bar; before, with the
  header taken out of the block, they had slid to the top and left half a screen empty.
- **The bar** is a piece of the canvas: the same colour and the same 18 px grid, its lines
  slid on scroll so they always meet the page's, and no rule under it. Under its 72 px a
  54 px soft edge draws the same canvas through a gradient mask, so anything scrolling up
  fades out as it reaches the bar instead of being cut off or passing under the wordmark.
- **The credit line** lives inside the download card as its bottom band, soft white with
  a rule above: the eye, "Made by Pranav Karthik", and a Send feedback button with a mail
  glyph that opens a draft. No separate footer; the card is the last thing on the page, and
  the page keeps as much room under it as above it.

Later: the soft edge under the bar is 18 px, not 54, so things disappear at the bar's
line with only the cut taken off; a longer fade read as an effect. The stack has 30vh of
run after the demo before the voice row and 48vh between rows, so each part gets its own
stretch of scroll.

## Part 22: the fan's lines, the voice row rebuilt, the footer (2026-11-05, late)

- **Four lines, one per personality, each with its clip** (encoded from the starter set
  into `docs/assets/voice/`): Gentle, Derek: "Okay, that's enough of that. Back we go."
  Mom, Elise: "Don't make me come over there." Gen Z, Elise: "Lowkey not the assignment."
  Stern, Derek: "You know what you should be doing. So do it." The personality sits in a
  chip drawn in the card's own ink, Inter at 750, so it reads from the fan's edge; the
  voice's name stays small in mono.
- **How the fan plays.** Nothing plays on its own, ever: the cards cycle silently with
  their words. A click is the only way to hear one: a back card comes to the front and
  speaks, the front card speaks again. While a clip plays the fan holds still.
- **The voice row.** Left: a recording that becomes a voice. "Dad", a coral recording dot,
  a counter to 0:20 (told in five seconds), the waveform drawn in bar by bar, then
  "Building the voice", then Ready: the bars turn green and five chips arrive, Dad and the
  four personalities. It runs again after a pause, and a press on the dot records again.
  Right: the sentence, and Elise and Derek as two rows with a play orb each, the two older
  clips. The old voices-and-chips settings panel is gone; the fan already shows the four
  personalities.
- **Footer.** Under the card, one quiet mono line: "© 2026 Pranav Karthik" on the left,
  Source and Send feedback as small buttons on the right. The copyright line credits the
  maker without announcing it.

Later: the recording card is headed "Clone a voice." with "Record anyone once. Every
reminder after that is in their voice." under it, and once the voice is built it says a
line in each personality in turn (the chip lights, the line arrives word by word, the orb
bars move) before recording again, so one recording and many lines is what you see. Copy:
"Open a distraction and it speaks up." / "Add sites to your distractions list so we can
help you stay focused." / "Trends across weeks and months, so you can see where your focus
goes." / the Windows note reads "Windows may warn that the app is unrecognised. Choose More
info, then Run anyway." The footer is a card: the eye, the name large, "Made Supervisor ·
2026" under it, and Send feedback with the mail glyph. Source is gone until there is a
public repository to point at.

Later still: Elise and Derek moved into the clone card as two pressable cards under
"Comes with the app", so the left card holds everything you can press and the right card
is only the words: "Record anyone, with their consent, for twenty seconds. Then generate
any line you want in their voice, and make up personalities of your own." The chips and the
spoken line stay visible while recording, dimmed, and light up once the voice is ready, so
the card never has a hole in it. The Windows step is one sentence, the warning. The footer
card reads "© 2026 Pranav Karthik" at one size with Send feedback beside it.

## Part 23: the tagline in the bar, and a quieter clone card (2026-11-05, night)

- **The tagline.** Once the headline has scrolled under the bar, "The focus app that
  talks back." arrives beside the wordmark, small and muted, rising 8 px into place; it
  leaves the same way when the headline comes back. Hidden on phones.
- **The clone card** lost the personality chips and the spoken line: record, build, Ready,
  again. The recording dot breathes (a slow scale and fade, 1.6 s) rather than blinking; the
  app's own mic button simply turns coral while recording, so a breath is the nearest
  honest motion.
- **The words card** beside it sits at its own height, centred, in yellow.
- **The footer** card drops the eye: "© 2026 Pranav Karthik" and Send feedback.
- **The promise card** carries two plain facts under the sentence instead of three chips:
  "It reads window names, not your screen. Camera frames and voices never leave the
  laptop." Both are true of the app as built and say "local" without the word.

Later: the tagline is centred on the wordmark. The promise card's facts no longer name
what the app can see (that only plants the worry); they say what it does not do: "No
account, no servers, nothing uploaded. It works with the internet off." The recording is
louder: while recording the whole button is coral and beats once a second, the tape builds
in tall coral bars that pop in one by one over six seconds, "Building the voice" greys the
bars for a moment, then the button turns into a green play button and the bars go green,
held for four seconds before it all runs again.

## Part 24: the tape, and a colour audit (2026-11-05, night)

- **The tape** is drawn as the recording runs: each bar is new, a random height loudest in
  the middle of the take, in ink at 40 percent, popping in one every 150 ms. Nothing is
  pre-drawn. While the voice is built the bars go faint; when it is ready the button turns
  green with an ink play glyph on it.
- **Audit, light and dark.** Rule: a plain card is the inner colour (soft white) on the
  outer colour (panel); a button on a plain card takes the outer colour with ink for its
  glyph, the theme's border and shadow; a coloured surface keeps dark ink in both themes.
  Found and fixed: Elise and Derek's cards were the outer colour (now inner); their play
  buttons and the record button, and the orb on the cream fan card, were the hard-coded
  cream-and-ink of coloured-card orbs (now panel, ink, theme border and shadow, so in dark
  they are dark buttons with a light glyph). Everything else that is hard-coded sits on a
  coloured surface, where dark ink is the rule: the stat tiles and bar on the yellow report
  card, the chips on the coral speaker card, the yellow words card's text, the green
  promise card's facts, the front-tag's dot, the webcam thumbnail.

Later: the tape's forty bars each take a fortieth of the tape's width, and the stage's
second column is `minmax(0, 1fr)`, so the row can never push the stage past the card's
edge (fixed-width bars had made it wider than the card in the narrower dark-mode frame).

## Part 25: the fan's final four (2026-11-05, night)

Gentle, Derek: "Come on back, you were doing well." Mom, Elise: "Close it, or you're
grounded. Don't test me." Gen Z, Elise: "Bro, lock in." Stern, Derek: "You're wasting
your own time. Back to it." The first and third are starter-set clips re-encoded; the Mom
and Stern lines are not in the starter set, so they were generated with the app's own
voice engine (the chatterbox-nano pack already on this machine, two seeds each, the take
whose length sat closest to the word count kept) and encoded the same way. The four files
sit in `docs/assets/voice/` with the two older clips the voice row uses; the replaced ones
are deleted.

## Part 26: built into docs/ (2026-11-05)

`scripts/build_site.py` turns the mockup into the live site: it takes `ideal.html`, keeps
the fan as the first screen, drops the switch and the other first screens, splits the inline
styles and script into `docs/styles.css` (after `base.css`) and `docs/site.js`, rewrites
asset paths, points the Windows button at the GitHub releases page, and adds the head (title,
description, icon, the font preload, and a pre-paint script that applies the remembered
theme, or the system's). The theme button says what it switches to and remembers the choice.
To change the site: edit the mockup, run the script, commit `docs/`.

Checked in the browser from `docs/index.html`: every asset and all six clips load, the
self-hosted Inter is active, the fan, demo, stack and footer behave as in the mockup, dark
and light both render, and a phone width has no horizontal overflow.

## Part 27: captions (2026-11-06)

`docs/` is edited by hand now (the build script was retired on 2026-11-05 and the mockups
are history), so this went straight into the site. Elise's row had been pointed at the
fan's Gen Z clip once "Respectfully" left the starter set; it now has a line of its own,
"Caught in 4K. Close it.", encoded from the starter set. Both rows carry their line as a
caption under the name instead of "Play a line". And every clip on the page is captioned in
time: while it plays, the words of its line sit at 35 percent and come up one by one, spread
evenly over the clip's length (a 40 ms timer, so it keeps time in a background tab), and
clear when it ends. That covers the fan cards, the two rows and the reminder in the demo
with one mechanism, since they all already held their words as spans.

## Part 15: popups, the stack at content height, the eye (2026-11-05)

- **Popups.** The frame round a popup is the app's soft white, not the gridded canvas. The
  phone card shows Allow once and Back to my task side by side like the catch card. The
  session-done card ends in three small tiles (92% focused, 44 min longest, 1 reminder) that
  lift on hover and carry a one-line tooltip, the app's report tiles in miniature.
- **The stack** is only as tall as what each row holds (about 400, 350 and 320 px). Because
  rows now differ in height, a covered row fades out and steps back to 0.97 as the next one
  parks over it; otherwise a tall row would show under a short one. So yes, making the last
  card disappear is worth it, and it is the content-height rows that make it necessary. The
  page ends with the last row parked at its sticky top; the room under the stack is set from
  the window height so the footer follows immediately.
- **The promise card** carries the app's own eye above the sentence. Its iris follows the
  pointer, within the socket, and it blinks every five seconds. One ambient motion, and the
  one object on the page that says "watches" without a word.
- **Entrances.** Latent's page uses one reveal mechanism, `data-reveal` with a per-element
  delay of 80 to 200 ms; sections do not get different entrance styles (its site.css and
  site.js are not served at the paths the page links, so the keyframes themselves could not
  be read). The same holds here: one rise, staggered inside a card, and the app's land
  keyframe only for a card that is actually arriving (the catches on the first screen).
  Varying the entrance per section would be motion for its own sake.
- **The install line** wraps onto two rows in a full-width step under the heading and the
  two computer cards, so there is no horizontal scroll bar.

Later the same day: the dimmed page behind a popup used opacity, which let the grid show
through the page card. It now uses a filter (saturation 0.55, brightness 0.9), so the card
stays solid and only goes dull. The eye carries the cards' own shadow, a hard 4 px offset
via `drop-shadow`, which follows its round outline; it reads as an object sitting on the
green rather than a drawing printed on it, in both themes.

Later still: the "Record a voice" card is the same solid card as the two voices, with a
small yellow plus before its title instead of a dashed frame and a pulsing red dot (the app
has no dashed frames and no pulsing dots). The eye lifts on hover like a control and blinks
on a click; its blink is now a cream lid that drops inside the ring and lifts again, with a
thin ink edge, rather than the whole eye squashing. Every arrival is two-way: a card is "in"
while any of it is on screen and loses the state once it is fully out, so the rise, the voice
tour and the first screen's pop all replay on the way back up, and the demo's beats already
did.

## Part 14: what goes to the right of the headline (2026-11-04, later)

The pile of catch cards reads as decoration: it repeats the headline's claim without proving
it, and the demo below already shows a catch. Candidates, with the test "does it add
something the words don't":

1. **One reminder that speaks (built, `?hero=line`).** The coral card, two chips for the
   two starter voices, the line in large type, the orb and waveform, the task strip. It idles
   by swapping the two lines every six seconds; a press plays the real clip. Adds the one
   thing the words cannot: the voice. One object, one click to the product's proof.
2. **Nothing (built, `?hero=words`).** The headline alone, centred, at up to 6.2 rem, the
   sentence, the button. The demo under the fold is the proof. Cleanest; the "talks back"
   stays a claim until the visitor scrolls.
3. **A transcript.** A column of time-stamped lines from one session ("10:04 Respectfully,
   get back to it." …) scrolling up slowly. Shows range of personality; reads as a chat app.
4. **The timer with a speech bubble.** The green On task card and a bubble beside it that
   fills with a new line every few seconds. The product's shape plus the voice, but the
   bubble is a comic device the app never uses.
5. **A listening station.** Two large orbs, Elise and Derek, nothing else. Direct, but a bare
   play button with no words round it says less than the card in 1.
6. **A big waveform.** The app's bars across the column, drawing while a line plays under
   them. Abstract; needs a press to mean anything.

Recommendation: 1, with 2 as the fallback if the first screen should carry no object at
all. 3 to 6 each give less for the same space. The switch at bottom left of `ideal.html`
flips between Pile, Line and Words and remembers the choice; it is mockup-only.

## Part 7d: fourth pass (2026-11-03, evening)

Notes taken in: the story is a pinned scene (480vh of scroll, the viewport always full), one
beat on screen at a time: the copy slides out upward and the next slides in while the desktop
changes, five equal stretches of scroll pick the beat, the rail starts empty and fills a
square per beat (no numbers), a click on a square scrolls there. The corner card is as tall
as the face it shows (height animated, measured at the width it is heading for) so nothing
spills past its frame; it pops to the middle of the page area below the tabs and goes home
the same way. A shadow and radius pass: cards 4 px, controls 2 px, nothing blurred, the
Docs sheet a flat 1 px frame, search bars square, every drawn page in the theme's ink at low
strength so light and dark both read; the browser window, the webcam thumbnail, the rail and
the buttons follow the theme, only the coloured slabs keep dark ink. The webcam thumbnail
shows a figure, the phone, and the app's dashed yellow detection box with its label. The
close is a green slab for the sentence and one themed Download button on the canvas below it
("Free · macOS and Windows · Open source" under it). The voice line card carries the app's
waveform bars, green while the clip plays. Copy: 84 words.

## Part 7c: third pass (2026-11-03, later still)

Notes taken in: the wordmark much larger (the two header buttons unchanged); the timer small
and tucked top-right under the tabs; when it has something to say it pops to the middle of
the page area in one 380 ms transform (measured, re-measured once its width settles) and
grows from 200 to 340 px, never over the tab strip, so the tabs stay clickable; the Docs,
YouTube and Reddit pages drawn as recognisable abstractions (a toolbar and a white sheet with
a real title; the play mark, a player with a scrub bar, a title and a side column; a feed with
vote arrows); the stage wider (7 of 11 columns, up to 600 px tall) with a four-segment rail
along its bottom that fills as the beats pass and jumps to a beat on click; beats tightened
to 58vh with the active panel lifting and its number turning yellow; and a copy pass: no
"drift", no instructions to press anything, each panel says what the feature is in one line.
The copy in full is 86 words.

## Part 7b: second pass on the ideal (2026-11-03, later)

Feedback on the first pass: the stage was a button row; the phone and day panels repeated
the copy and showed nothing; text floated on the canvas where the app would use a panel; the
voice copy was unclear and "your mom doesn't come with the app" was odd. The rebuilt
`ideal.html`:

- **The stage is a desktop.** A browser window with real tab shapes (Google Docs, YouTube,
  Reddit) and an abstract page per tab (a doc of grey lines, a dark player with a coral play
  mark, a list of posts). The app's corner card sits over it top-right, where the status
  window really lives. A webcam thumbnail appears bottom-left only when the story turns it
  on, with a figure and a phone outlined in yellow.
- **The scroll runs the story in that one stage.** The stage is sticky; the copy scrolls past
  it as four small panels numbered 01-04 (the session, the reminder, the phone, the report),
  each in the app's panel style with the eyebrow and number, lighting up as it reaches the
  middle of the window. Each beat sets the stage's state: the tab in front switches with a
  220 ms crossfade of the page, the card changes colour in 220 ms and its face swaps with a
  6 px rise, the webcam slides in, and at the end the browser dims to 45% and the card becomes
  "Session done · 1h 40m focused" with the strip drawing itself. No scrubbing, no library:
  one state machine, an intersection observer with a 42% margin, and the app's transitions.
  Scrolling back up returns it to On task.
- **The tabs still work by hand** at any point: click YouTube or Reddit and the page switches
  at once, the card catches you after the app's 650 ms pause and the clip plays; Docs, Back
  to my task or Allow once return it. The hint under the stage says "Scroll, or open a tab".
- **The phone and day panels are gone**; both are beats in the stage now.
- **Cards carry the copy.** The headline and its one line float as the app's titles do;
  every other piece of copy is in a panel: the four beats, the voice intro, and the close,
  which is one green slab holding the privacy line and the buttons.
- **The voice, explained.** "Pick who tells you off." Two voices come with the app, record
  anyone for twenty seconds and it builds theirs on your computer, then pick a personality
  and rewrite any line. The box shows the app's own voice cards (Derek, Elise, a dashed
  "Record a voice"), the four personality chips, and the line card: speaker and personality
  switch the line, which develops word by word; the two clips on the site play, the others
  say "text only on the site".

Checked: every beat's state on scroll, the hand-driven catch, the done strip drawing, no
horizontal scroll at phone width (the close's buttons now wrap). On a phone the stage sits
sticky at the top at 46vh and the beats scroll under it.

## Part 7: the ideal, first pass (2026-11-03)

`plans/landing-mockups/ideal.html`, on `base.css`. One page, 96 words, five beats:

1. **Hero: the catch.** Headline, one line, one button, "Free · macOS and Windows". Beside it
   the stage: five window chips (Google Docs in front, yellow) over the card, green "On task",
   the goal, the timer counting down big at the bottom, as the app's card lays it out. Click a
   distraction: the chip goes yellow at once, the app's pause of 650 ms, then the card turns
   coral in 220 ms, the On task face fades and the caught face rises 6 px into place, the
   title says which window, the orb goes green with its bars and the line develops word by
   word (45 ms apart) while the clip plays. The task strip keeps the time. Back to my task or
   Allow once returns it to green and Docs, and the hint under the stage changes to "Try
   another one". Both faces share one grid cell, so the card never changes size. Your phone
   turns it yellow with "Your phone is out." (no clip on the site, so a quiet orb).
2. **The voice.** "Record anyone for twenty seconds." One line card with a large orb; four
   personality chips switch the speaker and the line, which develops the same way; Gen Z and
   Stern play, Gentle and Mom show their line with a dimmed orb until two more clips are
   allowed on the site.
3. **Your phone counts too** and **Then you see your day**, two quiet panels: a yellow slab,
   and the strip drawing itself left to right (each run 700 ms, 90 ms apart) with the week's
   squares filling green after it.
4. **Close.** "Everything stays on your computer." One line under it, two buttons, "Free ·
   Open source". Footer.

Motion is the app's only: the lift and press on chips and buttons (gated on hover devices),
pops on arrival, 200 ms colour changes, the orb bars, one ambient loop (the timer). No
libraries, no scroll scrubbing, reduced motion keeps the colours and drops the rises.

Checked in the browser: the catch, the return, the voice switch, the day's reveal, no
horizontal scroll at phone width. Known: on a phone the green card is tall because it holds
the caught face's height; fill it or let it grow when the time comes. Two more clips (Gentle,
Mom) and a phone line would complete the voice section and the phone catch.

### What I would not do

- A hero video or an autoplay anything.
- A mascot or a cartoon. The app's system is restrained neo-brutalism; the voice is the
  character.
- A features grid of twelve cards, a comparison table, a FAQ accordion of fifteen entries.
- Any third-party script: analytics, fonts, widgets. The site's own rules are the app's.
- Numbers that are not true yet.

## Part 28: a smoother hand, honest orbs

- The front card no longer fades out and reappears at the back: it hops over the hand (a `translate` keyframe, z-index flipping at the top of the arc) while the others slide forward, on their own compositor layers (`will-change: transform`).
- The silent cycle only shows the line. The green orb, the bouncing bars and the lit words mean sound now, and they come only with a click.
- The lit word runs 0.1s ahead of the voice with a 60ms fade, so it reads with the voice rather than after it.
- The eye measures once a frame and not at all while off screen (the pointer handler was forcing layout on every move).
- Voices: Stern is Elise, Gen Z is Derek (fan and demo). The phone line plays Elise. The clone card has Derek saying "And that's the session. Good work today." All four clips came from the app's own generated set on this machine.

- Part 28, take two: the hop still swapped layers in plain view. Now the front card drops out of the hand through a slot at its base (the fan box clips its bottom edge only), the others step forward, and it rises back in behind them. The layer swap happens while it is out of sight.

- Part 28, take three: the other cards step forward the moment the front card starts to drop, one continuous motion instead of drop-then-step. The dropping card keeps its spot and stays on top until it is out of sight. Card titles grew: the four demo text cards, the yellow voice card and the download card.

- Part 28, take four: the headline sizes went back; it was the small labels (The reminder, The voice, Download) that were too small, so those grew from 0.72rem to 0.92rem on the demo cards, the yellow voice card and the download card. Fan motions to compare live in `landing-mockups/fan-motions.html`: A deal from the back (the click motion), B lift over, C slide out and slip in, D flip through edge-on, E the drop through the slot (the site now), F sink under (the pop, on purpose).

- Part 28, take five: the drop through the slot stays. The slot moved 120px down, under the back card, which hangs 106px below the fan box and was getting its corner cut; the drop is 580px over 360ms so the card still clears it.

- Part 28, take six: no slot. The card stays in view the whole way; it drops half a card (290px) below the hand, goes behind at the bottom where it is furthest from the others, and slides from there into the back slot in one motion. Tested at the user's request; the swap is in view now.

- Part 29: in the dark theme the orbs on the coloured fan cards go dark with a light glyph (green with a dark glyph while speaking); the cream card keeps its theme orb. The personality chip is solid ink with the card's own colour for its text, at 1.1rem, so it is the first thing read on each card.

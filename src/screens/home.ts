import { invoke } from "@tauri-apps/api/core";
import type { ReportSpan, SessionReport } from "../core/types";
import {
  dayKey, formatHours, formatMinutes, medianOf, mondayOf, monthLabel, parseDayKey,
  STREAK_DAY_SECONDS, streakLabel,
} from "../core/format";
import { attr, escapeHtml, showFeedback } from "../core/dom";
import { activeTab, draft, history, setActiveTab, settings } from "../core/state";
import { paintSlot, render, runAction } from "../core/shell";
import {
  CARD_MONO, CARD_PAD, CARD_SANS, CARD_WIDTH, cardCanvas, cardPalette, copyCanvas, drawCardTile,
  drawWordmark, STRIP_GREEN, STRIP_RED,
} from "../core/cards";
import { timelineSeconds } from "./report";
import { trends, trendsLoaded } from "./trends";
import { setWebcamEnabled } from "./webcam";
import { STARTER_PROFILE_IDS, voiceBackend } from "./voice";
import { fitShareStats, takeAnimation } from "./history";

/** Later, one at a time on Home: the next thing worth knowing, once it's worth knowing. */
interface HomeTip {
  id: string;
  text: string;
  label: string;
  action: string;
}

export function homeTip(): HomeTip | null {
  const hidden = (id: string) => localStorage.getItem(`tip.${id}`) === "1";
  const recorded = (voiceBackend?.profiles ?? []).some(
    (profile) => !(STARTER_PROFILE_IDS as readonly string[]).includes(profile.profile_id) && Boolean(profile.reference_path),
  );
  if (history.length >= 1 && !recorded && !hidden("voice")) {
    return { id: "voice", text: "Record a voice you know", label: "Open", action: "tip-voice" };
  }
  if (history.length >= 3 && !settings.webcam_enabled && !hidden("webcam")) {
    return { id: "webcam", text: "Catch your phone or watch too", label: "Turn on", action: "tip-webcam" };
  }
  const oldest = history[history.length - 1];
  if (oldest && Date.now() - new Date(oldest.started_at).getTime() >= 6 * 86_400_000 && !hidden("share")) {
    return { id: "share", text: "Share your week", label: "Open", action: "tip-share" };
  }
  return null;
}

export function renderHomeTip(): string {
  const tip = homeTip();
  if (!tip) {
    return "";
  }
  return `
    <article class="panel onboard-card">
      <div class="onboard-head">
        <p class="eyebrow">${escapeHtml(tip.text)}</p>
        <div class="home-tip-actions">
          <button class="small-button" type="button" data-action="${tip.action}">${escapeHtml(tip.label)}</button>
          <button class="small-button" type="button" data-action="tip-hide" data-tip="${tip.id}">Hide</button>
        </div>
      </div>
    </article>
  `;
}

export function fitQuote(): void {
  const card = document.querySelector<HTMLElement>(".quote-card");
  const quote = card?.querySelector<HTMLElement>("blockquote");
  if (!card || !quote) {
    return;
  }
  // The grid stretches the card to the side column, so the smallest size shows the real room.
  // The quote takes at most 60% of it: a card full of text reads like a wall. In a short window
  // the eyebrow and the attribution leave less than that, so the card must not overflow either.
  quote.style.fontSize = "18px";
  const room = card.clientHeight * 0.6;
  const fits = (px: number) => {
    quote.style.fontSize = `${px}px`;
    return quote.offsetHeight <= room && quote.scrollWidth <= quote.clientWidth && card.scrollHeight <= card.clientHeight;
  };
  let low = 18;
  let high = 60;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (fits(mid)) {
      low = mid;
    } else {
      high = mid;
    }
  }
  quote.style.fontSize = `${low}px`;
}

/** Minutes today still needs to count toward the streak (0 once it counts). */
function streakMinutesLeft(): number {
  const seconds = dayFocusMap().get(dayKey(new Date())) ?? 0;
  // Rounded like the day card's minutes, so card + chip make 25. Between 24.5 and 25 minutes
  // the day doesn't count yet, so the chip still asks for 1.
  const left = Math.round(STREAK_DAY_SECONDS / 60) - Math.round(seconds / 60);
  return Math.max(seconds < STREAK_DAY_SECONDS ? 1 : 0, left);
}

/** The start screen's length for the missing minutes: the slider's steps of 5, from 15. */
function streakSessionMinutes(left: number): number {
  return Math.min(90, Math.max(15, Math.ceil(left / 5) * 5));
}

/** While no session runs: yellow with the minutes today still needs, one click to start them;
 *  green once today counts. */
export function renderStreakChip(): string {
  const left = streakMinutesLeft();
  const streak = streakDays();
  if (left === 0) {
    return `<button class="status-chip streak-chip is-kept" type="button" data-tab="session" aria-label="Today counts toward your streak">Day ${streak} kept</button>`;
  }
  const minutes = streakSessionMinutes(left);
  const text = streak > 0 ? `${left} min to keep your ${streak}-day streak` : `${left} min to start a streak`;
  return `<button class="status-chip streak-chip is-short" type="button" data-action="streak-start" title="Opens a ${minutes}-minute focus session">${escapeHtml(text)}</button>`;
}

/** One per day of the year, cycling. Short enough to read at a glance and to stand alone. */
const DAILY_NOTES = [
  { text: "To be everywhere is to be nowhere.", by: "Seneca" },
  { text: "How we spend our days is, of course, how we spend our lives.", by: "Annie Dillard" },
  { text: "Tell me to what you pay attention and I will tell you who you are.", by: "José Ortega y Gasset" },
  { text: "Well begun is half done.", by: "Aristotle" },
  { text: "Inspiration exists, but it has to find you working.", by: "Pablo Picasso" },
  { text: "Confine yourself to the present.", by: "Marcus Aurelius" },
  { text: "It is not enough to be busy. So are the ants. The question is: what are we busy about?", by: "Henry David Thoreau" },
  { text: "Resolve to perform what you ought; perform without fail what you resolve.", by: "Benjamin Franklin" },
  { text: "No great thing is created suddenly.", by: "Epictetus" },
  { text: "Lost time is never found again.", by: "Benjamin Franklin" },
  { text: "Attention is the rarest and purest form of generosity.", by: "Simone Weil" },
  { text: "You don't have to be great to start, but you have to start to be great.", by: "Zig Ziglar" },
  { text: "The mind is not a vessel to be filled, but a fire to be kindled.", by: "Plutarch" },
  { text: "Do not wait to strike till the iron is hot; but make it hot by striking.", by: "W. B. Yeats" },
  { text: "My experience is what I agree to attend to.", by: "William James" },
  { text: "Tomorrow is often the busiest day of the week.", by: "Spanish proverb" },
  { text: "It is not that we have a short time to live, but that we waste a good deal of it.", by: "Seneca" },
  { text: "Amateurs sit and wait for inspiration, the rest of us just get up and go to work.", by: "Stephen King" },
  { text: "Concentration is the secret of strength.", by: "Ralph Waldo Emerson" },
  { text: "The best time to plant a tree was twenty years ago. The second best time is now.", by: "Chinese proverb" },
  { text: "Nothing will work unless you do.", by: "Maya Angelou" },
  { text: "Focus is a matter of deciding what things you are not going to do.", by: "John Carmack" },
  { text: "If you seek tranquillity, do less. Or, more accurately, do what is essential.", by: "Marcus Aurelius" },
  { text: "Work expands so as to fill the time available for its completion.", by: "C. Northcote Parkinson" },
  { text: "Begin at once to live, and count each separate day as a separate life.", by: "Seneca" },
  { text: "Finish each day and be done with it.", by: "Ralph Waldo Emerson" },
  { text: "The scariest moment is always just before you start.", by: "Stephen King" },
  { text: "Great things are done by a series of small things brought together.", by: "Vincent van Gogh" },
  { text: "Don't mistake activity with achievement.", by: "John Wooden" },
  { text: "A wealth of information creates a poverty of attention.", by: "Herbert Simon" },
  { text: "How long are you going to wait before you demand the best for yourself?", by: "Epictetus" },
  { text: "Someday is not a day of the week.", by: "Janet Dailey" },
  { text: "The first and greatest victory is to conquer yourself.", by: "Plato" },
  { text: "Do what you can, with what you have, where you are.", by: "Theodore Roosevelt" },
  { text: "Things which matter most must never be at the mercy of things which matter least.", by: "Goethe" },
  { text: "Never leave that till tomorrow which you can do today.", by: "Benjamin Franklin" },
  { text: "Almost everything will work again if you unplug it for a few minutes, including you.", by: "Anne Lamott" },
  { text: "Our life is frittered away by detail. Simplify, simplify.", by: "Henry David Thoreau" },
  { text: "Deciding what not to do is as important as deciding what to do.", by: "Steve Jobs" },
  { text: "Waste no more time arguing what a good man should be. Be one.", by: "Marcus Aurelius" },
  { text: "Dig the well before you are thirsty.", by: "Chinese proverb" },
  { text: "Nothing is so fatiguing as the eternal hanging on of an uncompleted task.", by: "William James" },
  { text: "Little by little, one travels far.", by: "Spanish proverb" },
  { text: "What is important is seldom urgent and what is urgent is seldom important.", by: "Dwight D. Eisenhower" },
  { text: "First say to yourself what you would be; and then do what you have to do.", by: "Epictetus" },
  { text: "Do every act of your life as though it were the very last act of your life.", by: "Marcus Aurelius" },
  { text: "Energy and persistence conquer all things.", by: "Benjamin Franklin" },
  { text: "The impediment to action advances action. What stands in the way becomes the way.", by: "Marcus Aurelius" },
  { text: "You will never find time for anything. If you want time, you must make it.", by: "Charles Buxton" },
  { text: "When walking, walk. When eating, eat.", by: "Zen proverb" },
  { text: "Knowing is not enough; we must apply. Willing is not enough; we must do.", by: "Goethe" },
  { text: "There is no substitute for hard work.", by: "Thomas Edison" },
  { text: "The art of being wise is the art of knowing what to overlook.", by: "William James" },
  { text: "Either you run the day or the day runs you.", by: "Jim Rohn" },
  { text: "Do the thing and you shall have the power.", by: "Ralph Waldo Emerson" },
  { text: "Fall seven times, stand up eight.", by: "Japanese proverb" },
  { text: "We suffer more often in imagination than in reality.", by: "Seneca" },
  { text: "Make each day your masterpiece.", by: "John Wooden" },
  { text: "The journey of a thousand miles begins with a single step.", by: "Laozi" },
  { text: "Procrastination is the thief of time.", by: "Edward Young" },
  { text: "Attention is the beginning of devotion.", by: "Mary Oliver" },
  { text: "Don't explain your philosophy. Embody it.", by: "Epictetus" },
  { text: "Plans are worthless, but planning is everything.", by: "Dwight D. Eisenhower" },
  { text: "A year from now you may wish you had started today.", by: "Karen Lamb" },
  { text: "Give yourself a gift: the present moment.", by: "Marcus Aurelius" },
  { text: "The reward of a thing well done is to have done it.", by: "Ralph Waldo Emerson" },
  { text: "If you spend too much time thinking about a thing, you will never get it done.", by: "Bruce Lee" },
  { text: "Motivation is what gets you started. Habit is what keeps you going.", by: "Jim Rohn" },
  { text: "Action is the antidote to despair.", by: "Joan Baez" },
  { text: "You can't cross the sea merely by standing and staring at the water.", by: "Rabindranath Tagore" },
  { text: "Little strokes fell great oaks.", by: "Benjamin Franklin" },
  { text: "Measure twice, cut once.", by: "Proverb" },
  { text: "There is nothing so useless as doing efficiently that which should not be done at all.", by: "Peter Drucker" },
  { text: "It does not matter how slowly you go as long as you do not stop.", by: "Confucius" },
  { text: "Difficulties strengthen the mind, as labor does the body.", by: "Seneca" },
  { text: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", by: "Will Durant" },
  { text: "Do not let what you cannot do interfere with what you can do.", by: "John Wooden" },
  { text: "We are kept from our goal not by obstacles but by a clear path to a lesser goal.", by: "Robert Brault" },
  { text: "The best way out is always through.", by: "Robert Frost" },
  { text: "Begin, be bold, and venture to be wise.", by: "Horace" },
  { text: "Don't count the days, make the days count.", by: "Muhammad Ali" },
  { text: "If you want to improve, be content to be thought foolish and stupid.", by: "Epictetus" },
  { text: "A ship in harbor is safe, but that is not what ships are built for.", by: "John A. Shedd" },
  { text: "Tell me, what is it you plan to do with your one wild and precious life?", by: "Mary Oliver" },
];

export function dailyNote(): { date: string; text: string; by: string } {
  const notes = DAILY_NOTES;
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const day = Math.floor((now.getTime() - start.getTime()) / 86400000);
  const note = notes[day % notes.length];
  const date = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }).toUpperCase();
  return { date, text: note.text, by: note.by };
}

function dayFocusMap(): Map<string, number> {
  return new Map(trends.daily_focus.map((day) => [day.date, day.focus_seconds]));
}

/** The current streak: consecutive days with 25 focused minutes, ending today or yesterday.
 *  Today doesn't break it while there is still time to count. */
export function streakDays(asOf = dayKey(new Date())): number {
  const focus = dayFocusMap();
  const cursor = parseDayKey(asOf);
  let days = 0;
  for (let step = 0; step < 400; step += 1) {
    const key = dayKey(cursor);
    if ((focus.get(key) ?? 0) >= STREAK_DAY_SECONDS) {
      days += 1;
    } else if (!(step === 0 && key === dayKey(new Date()))) {
      break;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return days;
}

export function renderCalendar(): string {
  const focus = dayFocusMap();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const start = mondayOf(first);
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const cells = Math.ceil(((last.getTime() - start.getTime()) / 86400000 + 1) / 7) * 7;
  const letters = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const days: string[] = [];
  for (let index = 0; index < cells; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = dayKey(date);
    const seconds = focus.get(key) ?? 0;
    const classes = ["cal-day"];
    if (date.getMonth() !== today.getMonth()) classes.push("is-out");
    if (date > today) classes.push("is-future");
    else if (key === dayKey(today)) classes.push("is-today");
    else if (seconds >= STREAK_DAY_SECONDS) classes.push("is-on");
    // Hovering a day lifts it and swaps its date for its focused time; the parts wrap onto
    // two lines when the day is narrow.
    const time = date > today ? "" : `<b class="cal-time">${formatHours(seconds).split(" ").map((part) => `<span>${part}</span>`).join("")}</b>`;
    days.push(
      `<span class="${classes.join(" ")}" style="animation-delay: ${index * 12}ms"><span class="cal-num">${date.getDate()}</span>${time}</span>`,
    );
  }
  return `
    <div class="cal-grid ${!trendsLoaded ? "is-waiting" : takeAnimation("calendar") ? "is-animated" : ""}" role="img" aria-label="${attr(monthLabel(today))}, days with focus shaded">
      ${letters.map((letter) => `<span class="cal-dow">${letter}</span>`).join("")}
      ${days.join("")}
    </div>
  `;
}

/**
 * The day the Home card shows: today once it has a session, else the latest day with one. The
 * card never goes blank in the morning; it flips to Today with the first session.
 */
let dayCard: { day: string; reports: SessionReport[] } | null = null;
/** Day plus the session ids in it; a new session on that day refetches. */
export let dayCardKey = "";
export function setDayCardKey(value: string): void {
  dayCardKey = value;
}

export async function ensureDayCard(): Promise<void> {
  const newest = history[0];
  if (!newest) {
    dayCard = null;
    dayCardKey = "";
    return;
  }
  const day = dayKey(new Date(newest.started_at));
  const items = history.filter((item) => dayKey(new Date(item.started_at)) === day);
  const key = `${day}:${items.map((item) => item.id).join(",")}`;
  if (key === dayCardKey) {
    return;
  }
  dayCardKey = key;
  dayCard = null;
  try {
    const reports = await Promise.all(items.map((item) => invoke<SessionReport>("get_session_report", { id: item.id })));
    if (dayCardKey === key) {
      reports.sort((a, b) => a.started_at.localeCompare(b.started_at));
      dayCard = { day, reports };
      // Only the card: a full rebuild here would cut the calendar's pop-in short.
      if (paintSlot("day-card-slot", renderDayCard(streakDays()))) {
        fitShareStats();
        fitQuote(); // the card's height sets the quote's room
      }
    }
  } catch {
    // The card stays off until the next snapshot.
  }
}

/** Mirrors the backend: on-task time runs together until a drift, an absence or a gap breaks it. */
export function focusedStretches(spans: ReportSpan[]): number[] {
  const stretches: number[] = [];
  let current = 0;
  let previousEnd = 0;
  for (const span of spans) {
    if ((span.started_offset_seconds > previousEnd || span.after_pause) && current > 0) {
      stretches.push(current);
      current = 0;
    }
    previousEnd = span.started_offset_seconds + span.seconds;
    if (stripOnTask(span.state)) {
      current += span.seconds;
    } else if (current > 0) {
      stretches.push(current);
      current = 0;
    }
  }
  if (current > 0) {
    stretches.push(current);
  }
  return stretches;
}

/** The strip has two colours: work and distraction. Time away is left blank. */
export function stripOnTask(state: string): boolean {
  return state === "focused";
}

export function stripOffTask(state: string): boolean {
  return state === "distracted" || state === "phone" || state === "suspicious";
}

interface DaySummary {
  day: string;
  isToday: boolean;
  focusedSeconds: number;
  attentionSeconds: number;
  /** Sessions laid end to end: each segment's share of the strip and its spans and nudges. */
  segments: { start: number; width: number; report: SessionReport; duration: number }[];
}

function summarizeDay(card: { day: string; reports: SessionReport[] }): DaySummary {
  const durations = card.reports.map((report) => timelineSeconds(report));
  const total = Math.max(1, durations.reduce((sum, seconds) => sum + seconds, 0));
  let start = 0;
  const segments = card.reports.map((report, index) => {
    const segment = { start, width: durations[index] / total, report, duration: durations[index] };
    start += segment.width;
    return segment;
  });
  return {
    day: card.day,
    isToday: card.day === dayKey(new Date()),
    focusedSeconds: card.reports.reduce((sum, report) => sum + report.focused_seconds, 0),
    attentionSeconds: medianOf(card.reports.flatMap((report) => focusedStretches(report.spans))) ?? 0,
    segments,
  };
}

/** The card's date, written out: "30 October, 2026". */
function cardDayLabel(day: string): string {
  const date = parseDayKey(day);
  return `${date.getDate()} ${date.toLocaleDateString(undefined, { month: "long" })}, ${date.getFullYear()}`;
}

/** The day's strip as runs of on/off-task, cut into equal bins and each bin given the state
 *  that filled most of it. A few seconds in a tab can't paint a line, a real drift still shows,
 *  and the picture stays readable for any length of day. The stats stay exact. */
const STRIP_BINS = 48;

function stripRuns(segments: DaySummary["segments"], bins = STRIP_BINS): { on: boolean; left: number; width: number }[] {
  const onSeconds = new Array<number>(bins).fill(0);
  const offSeconds = new Array<number>(bins).fill(0);
  for (const segment of segments) {
    for (const span of segment.report.spans) {
      const on = stripOnTask(span.state);
      if (!on && !stripOffTask(span.state)) continue;
      const a = segment.start + (span.started_offset_seconds / segment.duration) * segment.width;
      const b = a + (span.seconds / segment.duration) * segment.width;
      for (let k = Math.floor(a * bins); k < Math.min(bins, Math.ceil(b * bins)); k += 1) {
        const overlap = Math.min(b, (k + 1) / bins) - Math.max(a, k / bins);
        if (overlap > 0) (on ? onSeconds : offSeconds)[k] += overlap;
      }
    }
  }
  const runs: { on: boolean; left: number; width: number }[] = [];
  for (let k = 0; k < bins; k += 1) {
    if (onSeconds[k] + offSeconds[k] === 0) continue;
    const on = onSeconds[k] >= offSeconds[k];
    const last = runs[runs.length - 1];
    if (last && last.on === on && Math.abs(last.left + last.width - k / bins) < 1e-9) {
      last.width += 1 / bins;
    } else {
      runs.push({ on, left: k / bins, width: 1 / bins });
    }
  }
  return runs;
}

export function renderDayCard(todayStreakDays: number): string {
  if (!dayCard) {
    if (history.length > 0) {
      return "";
    }
    // Nothing recorded yet: the card's outline, so the first session has a visible place to land.
    return `
      <section class="panel last-session-card">
        <p class="eyebrow">Your day</p>
        <div class="share-card is-empty" aria-label="No sessions yet">
          <span class="share-head">
            <strong>Your first card</strong>
          </span>
          <span class="share-strip" aria-hidden="true"></span>
          <span class="share-stats">
            <span><small>Focused</small><strong>—</strong></span>
            <span><small>Attention span</small><strong>—</strong></span>
            <span><small>Streak</small><strong>${streakLabel(todayStreakDays)}</strong></span>
          </span>
        </div>
        <p class="share-hint">Finish a session and its card lands here</p>
      </section>
    `;
  }
  const summary = summarizeDay(dayCard);
  const streakText = streakLabel(streakDays());
  const strip = stripRuns(summary.segments)
    .map((run) => `<i class="${run.on ? "strip-on" : "strip-off"}" style="left: ${(run.left * 100).toFixed(2)}%; width: ${(run.width * 100).toFixed(2)}%"></i>`)
    .join("");
  return `
    <section class="panel last-session-card">
      <p class="eyebrow">Your day</p>
      <button class="share-card" type="button" data-action="copy-card" title="Copy the card as an image">
        <span class="share-head">
          <strong>${escapeHtml(cardDayLabel(summary.day))}</strong>
        </span>
        <span class="share-strip" aria-hidden="true"><span class="share-strip-fill">${strip}</span></span>
        <span class="share-stats">
          <span><small>Focused</small><strong>${escapeHtml(formatHours(summary.focusedSeconds))}</strong></span>
          <span><small>Attention span</small><strong>${escapeHtml(formatMinutes(summary.attentionSeconds))}</strong></span>
          <span><small>Streak</small><strong>${streakText}</strong></span>
        </span>
      </button>
      <p class="share-hint">Click the card to copy it and share it</p>
    </section>
  `;
}

/** Draws the day card to a canvas and puts the PNG on the clipboard, in the current theme's colours. */
async function copyCard(): Promise<void> {
  if (!dayCard) {
    return;
  }
  const summary = summarizeDay(dayCard);
  const streak = streakDays(summary.day);
  const width = CARD_WIDTH;
  const tileH = 84;
  const tilesY = 176;
  const drawn = cardCanvas(tilesY + tileH + 4 + CARD_PAD, true);
  if (!drawn) {
    return;
  }
  const { canvas, ctx } = drawn;
  const palette = cardPalette();

  // The same header as the week and month cards: the wordmark, then the eyebrow over the date.
  ctx.fillStyle = palette.ink;
  drawWordmark(ctx, CARD_PAD, CARD_PAD, 24);
  ctx.textAlign = "right";
  ctx.fillStyle = palette.muted;
  ctx.font = `600 15px ${CARD_MONO}`;
  ctx.fillText("YOUR DAY", width - CARD_PAD, CARD_PAD + 2);
  ctx.fillStyle = palette.ink;
  ctx.font = `650 28px ${CARD_SANS}`;
  ctx.fillText(cardDayLabel(summary.day), width - CARD_PAD, CARD_PAD + 24);
  ctx.textAlign = "left";

  const stripX = CARD_PAD;
  const stripY = 108;
  const stripW = width - CARD_PAD * 2;
  const stripH = 44;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(stripX, stripY, stripW, stripH, 6);
  ctx.clip();
  ctx.fillStyle = palette.track;
  ctx.fillRect(stripX, stripY, stripW, stripH);
  for (const run of stripRuns(summary.segments)) {
    ctx.fillStyle = run.on ? STRIP_GREEN : STRIP_RED;
    ctx.fillRect(stripX + run.left * stripW, stripY, run.width * stripW, stripH);
  }
  ctx.restore();
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(stripX, stripY, stripW, stripH, 6);
  ctx.stroke();

  const stats: [string, string][] = [
    ["FOCUSED", formatHours(summary.focusedSeconds)],
    ["ATTENTION SPAN", formatMinutes(summary.attentionSeconds)],
    ["STREAK", streakLabel(streak)],
  ];
  const tileGap = 12;
  const tileW = (width - CARD_PAD * 2 - tileGap * 2) / 3;
  stats.forEach(([label, value], index) => drawCardTile(ctx, CARD_PAD + index * (tileW + tileGap), tilesY, tileW, tileH, label, value));

  await copyCanvas(canvas);
}

export async function homeAction(action: string, source?: HTMLElement): Promise<void> {
  if (action === "tip-hide") {
    localStorage.setItem(`tip.${source?.dataset.tip ?? ""}`, "1");
    render();
    return;
  }

  if (action === "tip-voice") {
    setActiveTab("settings");
    await runAction("open-voice-settings");
    return;
  }

  if (action === "tip-webcam") {
    await setWebcamEnabled(true);
    localStorage.setItem("tip.webcam", "1");
    showFeedback("Webcam on. Change it in Settings › Webcam");
    render();
    return;
  }

  if (action === "tip-share") {
    localStorage.setItem("tip.share", "1");
    document.querySelector<HTMLButtonElement>('nav.tabs [data-tab="history"]')?.click();
    return;
  }

  if (action === "copy-card") {
    await copyCard();
    return;
  }

  if (action === "streak-start") {
    // The start screen, set to the missing minutes as a plain timer. The goal is the user's to
    // type, as with the Start button.
    draft.mode = "timer";
    draft.duration_minutes = streakSessionMinutes(streakMinutesLeft());
    // The start screen lives on the Session tab; from History or Settings, go there first (the
    // tab button carries the leaving steps: voice screen, webcam preview, week picker).
    if (activeTab !== "session") {
      document.querySelector<HTMLButtonElement>('nav.tabs [data-tab="session"]')?.click();
    }
    await runAction("open-preflight");
    return;
  }
}

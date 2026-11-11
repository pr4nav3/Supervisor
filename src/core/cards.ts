import type { MonthRecap, WeekRecap } from "./types";
import {
  addDaysKey, dayKey, formatHours, formatMinutes, formatWeekRange, parseDayKey, smartBarHeight,
  STREAK_DAY_SECONDS, streakLabel,
} from "./format";
import { errorText, showFeedback } from "./dom";
import { theme } from "./state";

/** The app's eye, as on its icon and the site: each ring's radius as a share of the eye's
 *  width, outside in. The header draws it as an SVG, the share cards on a canvas. */
const EYE_RINGS: [number, string][] = [[0.46, "#101010"], [0.4, "#f4ead7"], [0.22, "#a8eb37"], [0.13, "#3267ff"], [0.055, "#101010"]];
/** Where the name starts after the eye, in eye widths. */
const EYE_GAP = 1.3125;
const ring = ([r, color]: [number, string]) => `<circle cx="0.5" cy="0.5" r="${r}" fill="${color}"/>`;
/** As on the site: the rim and socket stay put, the iris and pupil (`.look`) turn toward the
 *  pointer, and a cream lid (`.shutter`) drops inside the socket to blink. */
export const EYE_SVG = `<svg class="brand-eye" viewBox="0 0 1 1" aria-hidden="true"><defs><clipPath id="brand-eye-socket"><circle cx="0.5" cy="0.5" r="${EYE_RINGS[1][0]}"/></clipPath></defs>${EYE_RINGS.slice(0, 2).map(ring).join("")}<g class="look">${EYE_RINGS.slice(2).map(ring).join("")}</g><g clip-path="url(#brand-eye-socket)"><g class="shutter"><rect width="1" height="0.906" fill="${EYE_RINGS[1][1]}"/><rect y="0.883" width="1" height="0.023" fill="${EYE_RINGS[0][1]}"/></g></g></svg>`;

/** The card's colours in the current theme (the same tokens as styles.css). */
export function cardPalette() {
  return theme === "dark"
    ? { canvas: "#40403c", panel: "#353530", grid: "rgba(255,255,255,0.12)", ink: "#fff8e9", muted: "#ddd5c5", border: "#151512", track: "#4c4b46", shadow: "#0b0b09", frame: "#353530" }
    : { canvas: "#f4ead7", panel: "#fff4cf", grid: "rgba(16,16,16,0.08)", ink: "#101010", muted: "#5d564a", border: "#101010", track: "#fff7df", shadow: "rgba(17,16,14,0.68)", frame: "#fff7df" };
}

/** Sets the largest font (down to `min`) at which `text` fits in `maxWidth`; returns the size used. */
function fitCanvasText(ctx: CanvasRenderingContext2D, text: string, weight: number, family: string, max: number, min: number, maxWidth: number): number {
  let size = max;
  ctx.font = `${weight} ${size}px ${family}`;
  while (size > min && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.font = `${weight} ${size}px ${family}`;
  }
  return size;
}

export const STRIP_GREEN = "#a8eb37";
export const STRIP_RED = "#ff684f";

/** Width of every shared card; the day and the week card draw at the same size. */
export const CARD_WIDTH = 640;
export const CARD_PAD = 36;
export const CARD_MONO = "ui-monospace, Menlo, Consolas, monospace";
export const CARD_SANS = "Inter, system-ui, sans-serif";

/** A card-sized canvas at 2x with the card drawn: hard shadow, the grid paper, the border.
 *  `framed`, for the image that is copied: a solid frame in the theme's cream fills the square
 *  around the card, so no pixel is transparent. Chat apps send images as JPEGs, which turn
 *  transparency white; the card's rounded corners and shadow keep their shape on the frame.
 *  Unframed (the Share popup's previews), only the corners and the shadow's notch are clear. */
export function cardCanvas(height: number, framed = false): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const scale = 2;
  const width = CARD_WIDTH;
  const shadow = 8;
  const radius = 12;
  const frame = framed ? 14 : 0;
  const canvas = document.createElement("canvas");
  canvas.width = (width + shadow + frame * 2) * scale;
  canvas.height = (height + shadow + frame * 2) * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.scale(scale, scale);
  const palette = cardPalette();
  if (framed) {
    ctx.fillStyle = palette.frame;
    ctx.fillRect(0, 0, width + shadow + frame * 2, height + shadow + frame * 2);
    ctx.translate(frame, frame);
  }

  ctx.fillStyle = palette.shadow;
  ctx.beginPath();
  ctx.roundRect(shadow, shadow, width, height, radius);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, radius);
  ctx.clip();
  ctx.fillStyle = palette.canvas;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 14) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 14) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }
  // Half the stroke falls outside the clip, so 3px of border shows.
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, radius);
  ctx.stroke();
  ctx.restore();
  ctx.textBaseline = "top";
  return { canvas, ctx };
}

/** One stat tile in the app's card language: border, hard shadow, slightly rounded. A smaller
 *  value sits on the same baseline as a full-size one; `sub` is a small line under it. */
export function drawCardTile(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, value: string, sub = ""): void {
  const palette = cardPalette();
  const valueMax = sub ? 26 : 34;
  drawCardPanel(ctx, x, y, w, h, 6);
  const inset = sub ? 12 : 16;
  const inner = w - inset * 2;
  ctx.textAlign = "left";
  ctx.fillStyle = palette.muted;
  fitCanvasText(ctx, label, 600, CARD_MONO, 12, 8, inner);
  ctx.fillText(label, x + inset, y + 14);
  ctx.fillStyle = palette.ink;
  const valueSize = fitCanvasText(ctx, value, 800, CARD_SANS, valueMax, 16, inner);
  ctx.fillText(value, x + inset, y + 36 + (valueMax - valueSize));
  if (sub) {
    ctx.fillStyle = palette.muted;
    fitCanvasText(ctx, sub, 500, CARD_MONO, 10, 8, inner);
    ctx.fillText(sub, x + inset, y + 36 + valueMax + 6);
  }
}

/** Puts the canvas on the clipboard as a PNG. The write starts at once, with the PNG still
 *  being encoded: WebKit (the Mac webview) allows a clipboard write only during the click
 *  itself, not after an await, so nothing that calls this may await first. */
export async function copyCanvas(canvas: HTMLCanvasElement): Promise<void> {
  const png = new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not draw the card"))), "image/png"),
  );
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    showFeedback("Card copied");
  } catch (error) {
    showFeedback(`Could not copy: ${errorText(error)}`);
  }
}

/** The week's bars are green for any focused time. On the month's calendar a day is green once
 *  it counts (25 focused minutes), as on the Session calendar; less is white. */
const CARD_GREEN = "#a8eb37";
/** Dark text on the greens, whichever theme the card is drawn in. */
const CARD_GREEN_INK = "#101010";
const CARD_INSET = 18;

/** The wordmark from (x, y), with textBaseline top and the ink already set: the eye, then the
 *  name, with the eye's centre on the middle of the capitals. The eye is as wide as the font is
 *  tall, as in the app's header. */
export function drawWordmark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  // Measured twenty times larger: small sizes report whole pixels, which would put the eye off
  // centre by a fraction of one.
  ctx.font = `750 ${size * 20}px ${CARD_SANS}`;
  const cap = ctx.measureText("H");
  const mid = y + (cap.actualBoundingBoxDescent - cap.actualBoundingBoxAscent) / 40;
  ctx.font = `750 ${size}px ${CARD_SANS}`;
  const ink = ctx.fillStyle;
  for (const [radius, color] of EYE_RINGS) {
    ctx.beginPath();
    ctx.arc(x + size / 2, mid, radius * size, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.fillStyle = ink;
  ctx.fillText("Supervisor", x + size * EYE_GAP, y);
}

/** The header both share cards start with: the wordmark over the focused total on the left,
 *  the eyebrow over the period on the right, hanging from the same baseline. Returns the y
 *  where the body starts. */
function drawCardHeader(ctx: CanvasRenderingContext2D, eyebrow: string, period: string, focusSeconds: number): number {
  const palette = cardPalette();
  const width = CARD_WIDTH;
  ctx.textAlign = "left";
  ctx.fillStyle = palette.ink;
  drawWordmark(ctx, CARD_PAD, CARD_PAD, 24);

  const bigTop = CARD_PAD + 42;
  const bigSize = 40;
  const big = formatHours(focusSeconds);
  ctx.font = `800 ${bigSize}px ${CARD_SANS}`;
  ctx.fillText(big, CARD_PAD, bigTop);
  const bigW = ctx.measureText(big).width;
  ctx.fillStyle = palette.muted;
  ctx.font = `600 14px ${CARD_MONO}`;
  ctx.fillText("FOCUSED", CARD_PAD + bigW + 10, bigTop + bigSize - 21);

  const bottom = bigTop + bigSize;
  ctx.textAlign = "right";
  ctx.fillStyle = palette.ink;
  const periodSize = fitCanvasText(ctx, period, 650, CARD_SANS, 28, 18, width - CARD_PAD * 2 - bigW - 120);
  ctx.fillText(period, width - CARD_PAD, bottom - periodSize);
  ctx.fillStyle = palette.muted;
  ctx.font = `600 15px ${CARD_MONO}`;
  ctx.fillText(eyebrow.toUpperCase(), width - CARD_PAD, bottom - periodSize - 24);
  ctx.textAlign = "left";
  return bottom + 18;
}

/** An inner panel in the card's language: hard shadow, fill, border. Tiles are less rounded. */
function drawCardPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius = 8): void {
  const palette = cardPalette();
  ctx.fillStyle = palette.shadow;
  ctx.beginPath();
  ctx.roundRect(x + 4, y + 4, w, h, radius);
  ctx.fill();
  ctx.fillStyle = palette.panel;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 3;
  ctx.stroke();
}

/** The three tiles under a card's panel; returns the card's full height. */
function drawCardTiles(ctx: CanvasRenderingContext2D, y: number, sessions: number, longestSeconds: number, bestStreak: number): number {
  const gap = 12;
  const tileW = (CARD_WIDTH - CARD_PAD * 2 - gap * 2) / 3;
  const tileH = 84;
  const tiles: [string, string][] = [
    ["SESSIONS", String(sessions)],
    ["LONGEST", formatMinutes(longestSeconds)],
    ["BEST STREAK", streakLabel(bestStreak)],
  ];
  tiles.forEach(([label, value], index) => drawCardTile(ctx, CARD_PAD + index * (tileW + gap), y, tileW, tileH, label, value));
  return y + tileH + 4 + CARD_PAD;
}

/** The longest run of days in a row with 25 focused minutes, within the card's own days. */
function bestStreakIn(daySeconds: number[]): number {
  let best = 0;
  let run = 0;
  for (const seconds of daySeconds) {
    run = seconds >= STREAK_DAY_SECONDS ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** The week as a card: the header, a bar per day in its own panel, three tiles. Drawn from the
 *  recap already loaded, so a copy can start inside the click (see copyCanvas). */
export function drawWeekCard(recap: WeekRecap, framed = false): HTMLCanvasElement | null {
  const barsH = 200;
  const panelH = CARD_INSET + barsH + 10 + 14 + CARD_INSET;
  const bodyTop = CARD_PAD + 42 + 40 + 18;
  const height = bodyTop + panelH + 18 + 84 + 4 + CARD_PAD;
  const drawn = cardCanvas(height, framed);
  if (!drawn) {
    return null;
  }
  const { canvas, ctx } = drawn;
  const palette = cardPalette();
  const today = dayKey(new Date());
  const top = drawCardHeader(ctx, "Your week", formatWeekRange(recap.start), recap.focus_seconds);

  const panelW = CARD_WIDTH - CARD_PAD * 2;
  drawCardPanel(ctx, CARD_PAD, top, panelW, panelH);
  const gap = 12;
  const colW = (panelW - CARD_INSET * 2 - gap * 6) / 7;
  const barsTop = top + CARD_INSET;
  const max = Math.max(...recap.buckets.map((bucket) => bucket.focus_seconds), 1);
  recap.buckets.forEach((bucket, index) => {
    const x = CARD_PAD + CARD_INSET + index * (colW + gap);
    const day = addDaysKey(recap.start, index);
    const future = day > today;
    const on = bucket.focus_seconds > 0;
    const h = on ? Math.max(14, (barsH * smartBarHeight(bucket.focus_seconds, max, 14)) / 100) : 10;
    const y = barsTop + barsH - h;
    if (on) {
      ctx.fillStyle = palette.shadow;
      ctx.beginPath();
      ctx.roundRect(x + 3, y + 3, colW, h, 6);
      ctx.fill();
    }
    ctx.fillStyle = on ? CARD_GREEN : future ? "transparent" : palette.track;
    ctx.beginPath();
    ctx.roundRect(x, y, colW, h, 6);
    ctx.fill();
    ctx.strokeStyle = future ? palette.grid : palette.border;
    ctx.lineWidth = on ? 3 : 2;
    ctx.stroke();
    ctx.fillStyle = palette.muted;
    ctx.font = `500 13px ${CARD_MONO}`;
    ctx.textAlign = "center";
    ctx.fillText(bucket.label.toUpperCase(), x + colW / 2, barsTop + barsH + 12);
    ctx.textAlign = "left";
  });

  drawCardTiles(ctx, top + panelH + 18, recap.session_count, recap.longest_stretch_seconds, bestStreakIn(recap.buckets.map((bucket) => bucket.focus_seconds)));
  return canvas;
}

/** The month as a card: the header, a calendar shaded by focused time in its own panel, three
 *  tiles. Days still ahead are faint outlines. */
export function drawMonthCard(recap: MonthRecap, framed = false): HTMLCanvasElement | null {
  const panelW = CARD_WIDTH - CARD_PAD * 2;
  const gap = 8;
  const cell = (panelW - CARD_INSET * 2 - gap * 6) / 7;
  const first = parseDayKey(recap.start);
  const offset = (first.getDay() + 6) % 7;
  const rows = Math.ceil((offset + recap.days.length) / 7);
  const lettersH = 22;
  const panelH = CARD_INSET + lettersH + rows * (cell + gap) - gap + CARD_INSET;
  const bodyTop = CARD_PAD + 42 + 40 + 18;
  const height = bodyTop + panelH + 18 + 84 + 4 + CARD_PAD;
  const drawn = cardCanvas(height, framed);
  if (!drawn) {
    return null;
  }
  const { canvas, ctx } = drawn;
  const palette = cardPalette();
  const today = dayKey(new Date());
  const top = drawCardHeader(ctx, "Your month", first.toLocaleDateString(undefined, { month: "long", year: "numeric" }), recap.focus_seconds);

  drawCardPanel(ctx, CARD_PAD, top, panelW, panelH);
  const gridX = CARD_PAD + CARD_INSET;
  const gridY = top + CARD_INSET;
  ctx.fillStyle = palette.muted;
  ctx.font = `500 13px ${CARD_MONO}`;
  ctx.textAlign = "center";
  ["M", "T", "W", "T", "F", "S", "S"].forEach((letter, index) => ctx.fillText(letter, gridX + index * (cell + gap) + cell / 2, gridY));
  ctx.textAlign = "left";
  recap.days.forEach((day, index) => {
    const slot = offset + index;
    const x = gridX + (slot % 7) * (cell + gap);
    const y = gridY + lettersH + Math.floor(slot / 7) * (cell + gap);
    const future = day.label > today;
    const counts = day.focus_seconds >= STREAK_DAY_SECONDS;
    ctx.fillStyle = counts ? CARD_GREEN : future ? "transparent" : palette.track;
    ctx.beginPath();
    ctx.roundRect(x, y, cell, cell, 6);
    ctx.fill();
    ctx.strokeStyle = future ? palette.grid : palette.border;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = counts ? CARD_GREEN_INK : future ? palette.muted : palette.ink;
    ctx.font = `600 13px ${CARD_MONO}`;
    ctx.fillText(String(index + 1), x + 8, y + 7);
  });

  drawCardTiles(ctx, top + panelH + 18, recap.session_count, recap.longest_stretch_seconds, bestStreakIn(recap.days.map((day) => day.focus_seconds)));
  return canvas;
}

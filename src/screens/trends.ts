import { invoke } from "@tauri-apps/api/core";
import type { TrendPeriod, TrendsData, TrendUnit } from "../core/types";
import {
  addDaysKey, averageOf, dayKey, formatHours, formatMinutes, formatRecovery, formatWeekStart,
  medianOf, parseDayKey, smartBarHeight,
} from "../core/format";
import { historyView, pendingAnimations, takeAnimation } from "../main";
import { appView, attr, errorText, escapeHtml } from "../core/dom";
import { activeTab, setLastError } from "../core/state";
import { render } from "../core/shell";

/** Trends need this many completed weeks before week-over-week lines mean anything. */
const TRENDS_UNLOCK_WEEKS = 2;
/** Bars per screen of Trends: about three months of weeks, or a year of months. */
const TREND_WINDOW = 12;
/** False until the first get_trends answers: the calendar waits for it before popping in. */
export let trendsLoaded = false;
/** Trends: every week and month from the first session through now (null until opened), which
 *  of the two the bars show, and how many windows of TREND_WINDOW back from now. */
let trendPeriods: Record<TrendUnit, TrendPeriod[]> | null = null;
let trendUnit: TrendUnit = "week";
let trendPage = 0;
export function setTrendPage(value: number): void {
  trendPage = value;
}
export let trends: TrendsData = {
  daily_focus: [],
  weeks: [],
  has_earlier: false,
};

export function renderTrends(): string {
  const weeks = trendPeriods?.week ?? [];
  // Completed weeks with a session, across all of history; the last week is still running.
  const full = weeks.slice(0, -1).filter((week) => week.session_count > 0).length;
  return `
    <section class="history-page recap-page">
      <div class="subpage-head recap-head">
        <button type="button" data-action="close-recap">Back</button>
        <div>
          <p class="eyebrow">History</p>
          <h2>Trends</h2>
        </div>
      </div>
      ${full < TRENDS_UNLOCK_WEEKS ? renderTrendsLocked(full) : renderTrendsBody()}
    </section>
  `;
}

function renderTrendsLocked(full: number): string {
  const have = Math.min(full, TRENDS_UNLOCK_WEEKS);
  return `
    <section class="panel span-card trends-slab trends-locked">
      <p class="eyebrow">Trends</p>
      <p class="span-value">Unlocks after two full weeks</p>
      <p class="span-caption">Lines for focused time, attention span, and recovery need a couple of complete weeks before they mean anything.</p>
      <div class="trend-pips" role="img" aria-label="${have} of ${TRENDS_UNLOCK_WEEKS} full weeks">
        ${Array.from({ length: TRENDS_UNLOCK_WEEKS }, (_, index) => `<span class="${index < have ? "is-on" : ""}"></span>`).join("")}
        <strong>${have} of ${TRENDS_UNLOCK_WEEKS} full weeks</strong>
      </div>
    </section>
  `;
}

/** The `page`th window of TREND_WINDOW periods back from now, never before the first session. */
function trendWindow(list: TrendPeriod[], page: number): TrendPeriod[] {
  const end = list.length - page * TREND_WINDOW;
  return end > 0 ? list.slice(Math.max(0, end - TREND_WINDOW), end) : [];
}

function trendPageCount(list: TrendPeriod[]): number {
  return Math.max(1, Math.ceil(list.length / TREND_WINDOW));
}

function trendUnitWord(count: number): string {
  return `${count} ${trendUnit}${count === 1 ? "" : "s"}`;
}

/** The last day of the period that starts on `start`. */
function trendPeriodEnd(start: string): string {
  if (trendUnit === "week") {
    return addDaysKey(start, 6);
  }
  const first = parseDayKey(start);
  return dayKey(new Date(first.getFullYear(), first.getMonth() + 1, 0));
}

/** "Aug 10 – Nov 1, 2026", "Dec 29, 2025 – Mar 22, 2026"; months: "Mar – Oct 2026". */
function formatTrendRange(startKey: string, endKey: string): string {
  const start = parseDayKey(startKey);
  const end = parseDayKey(endKey);
  const sameYear = start.getFullYear() === end.getFullYear();
  if (trendUnit === "month") {
    const month = (date: Date, year: boolean) => date.toLocaleDateString(undefined, year ? { month: "short", year: "numeric" } : { month: "short" });
    return start.getMonth() === end.getMonth() && sameYear ? month(end, true) : `${month(start, !sameYear)} – ${month(end, true)}`;
  }
  const day = (date: Date, year: boolean) =>
    date.toLocaleDateString(undefined, year ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" });
  return `${day(start, !sameYear)} – ${day(end, true)}`;
}

/** What one bar or point is, for its tip and screen readers: "Week of Oct 5", "October 2026". */
function trendPeriodName(start: string): string {
  return trendUnit === "week"
    ? `Week of ${formatWeekStart(start)}`
    : parseDayKey(start).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** Axis labels: a week's month once ("Aug 10", "17", "24"), a month's year when it turns. With
 *  `every` 2 only every other period is labelled, counted from the newest, and the month or year
 *  goes on the first label that shows it. */
function trendTicks(shown: TrendPeriod[], every = 1): string[] {
  let previous: Date | null = null;
  return shown.map((period, index) => {
    if ((shown.length - 1 - index) % every !== 0) {
      return "";
    }
    const date = parseDayKey(period.start);
    const before = previous;
    previous = date;
    if (trendUnit === "month") {
      const month = date.toLocaleDateString(undefined, { month: "short" });
      return before && before.getFullYear() !== date.getFullYear() ? `${month} ${date.getFullYear()}` : month;
    }
    return before && before.getMonth() === date.getMonth() ? String(date.getDate()) : formatWeekStart(period.start);
  });
}

interface TrendPill {
  text: string;
  good: boolean;
}

/** "↑ 42m vs the 12 before", or Steady inside `threshold`; null with nothing to compare. */
function trendPill(
  now: number | null,
  before: number | null,
  count: number,
  threshold: number,
  format: (seconds: number) => string,
  lowerIsBetter: boolean,
): TrendPill | null {
  if (now == null || before == null) {
    return null;
  }
  const versus = `vs the ${count} before`;
  const change = now - before;
  if (Math.abs(change) < threshold) {
    return { text: `Steady ${versus}`, good: true };
  }
  const up = change > 0;
  const amount = format(Math.abs(change));
  const text = lowerIsBetter ? `${amount} ${up ? "slower" : "faster"} ${versus}` : `${up ? "↑" : "↓"} ${amount} ${versus}`;
  return { text, good: lowerIsBetter ? !up : up };
}

function renderTrendsBody(): string {
  const list = trendPeriods?.[trendUnit] ?? [];
  trendPage = Math.min(trendPage, trendPageCount(list) - 1);
  const shown = trendWindow(list, trendPage);
  if (!shown.length) {
    return "";
  }
  const before = trendWindow(list, trendPage + 1);
  // The period in progress is drawn paler and left out of every average.
  const running = list[list.length - 1].start;
  const done = (periods: TrendPeriod[]) => periods.filter((period) => period.start !== running);
  const worked = (periods: TrendPeriod[]) => done(periods).filter((period) => period.session_count > 0);
  const animate = takeAnimation("trends");

  const focusNow = averageOf(done(shown).map((period) => period.focus_seconds));
  const focusBefore = averageOf(done(before).map((period) => period.focus_seconds));
  const total = shown.reduce((sum, period) => sum + period.focus_seconds, 0);
  const sessions = shown.reduce((sum, period) => sum + period.session_count, 0);
  const spanNow = medianOf(worked(shown).map((period) => period.median_stretch_seconds));
  const spanBefore = medianOf(worked(before).map((period) => period.median_stretch_seconds));
  const recoveries = (periods: TrendPeriod[]) =>
    done(periods).flatMap((period) => (period.recovery_median_seconds == null ? [] : [period.recovery_median_seconds]));
  const recoveryNow = medianOf(recoveries(shown));
  // With no finished period yet, the running one stands in, marked "so far".
  const runningPeriod = shown[shown.length - 1].start === running ? shown[shown.length - 1] : null;
  const spanSoFar = spanNow == null && runningPeriod && runningPeriod.session_count > 0 ? runningPeriod.median_stretch_seconds : null;
  const recoverySoFar = recoveryNow == null ? runningPeriod?.recovery_median_seconds ?? null : null;
  const recoveryBefore = medianOf(recoveries(before));
  const ticks = trendTicks(shown);
  // The half-width line charts fit every other label.
  const lineTicks = trendTicks(shown, shown.length > 6 ? 2 : 1);
  const atFirst = trendPage >= trendPageCount(list) - 1;

  return `
    <div class="panel history-toolbar trends-toolbar">
      <div class="history-week-nav">
        <button type="button" class="history-week-arrow" data-action="trend-older" ${atFirst ? "disabled" : ""} aria-label="Earlier ${trendUnit}s">‹</button>
        <h2>${escapeHtml(formatTrendRange(shown[0].start, trendPeriodEnd(shown[shown.length - 1].start)))}<span>${atFirst ? "From your first session" : trendUnitWord(shown.length)}</span></h2>
        <button type="button" class="history-week-arrow" data-action="trend-newer" ${trendPage === 0 ? "disabled" : ""} aria-label="Later ${trendUnit}s">›</button>
      </div>
      <div class="history-seg" role="group" aria-label="Bars show">
        <button type="button" class="${trendUnit === "week" ? "is-on" : ""}" aria-pressed="${trendUnit === "week"}" data-action="trend-unit" data-unit="week">Weeks</button>
        <button type="button" class="${trendUnit === "month" ? "is-on" : ""}" aria-pressed="${trendUnit === "month"}" data-action="trend-unit" data-unit="month">Months</button>
      </div>
    </div>
    <div class="trends-grid">
      ${renderTrendCard({
        tone: "focus",
        title: "Focused time",
        value: focusNow == null ? formatHours(shown[shown.length - 1].focus_seconds) : formatHours(focusNow),
        suffix: focusNow == null ? "so far" : `a ${trendUnit}`,
        pill: trendPill(focusNow, focusBefore, before.length, 60, formatHours, false),
        line: `${formatHours(total)} total · ${sessions === 1 ? "1 session" : `${sessions} sessions`}`,
        plot: renderTrendBars(shown, running, focusNow, ticks, animate),
      })}
      ${renderTrendCard({
        tone: "span",
        title: "Attention span",
        hint: "unbroken stretch of work",
        value: spanNow != null ? formatMinutes(spanNow) : spanSoFar != null ? formatMinutes(spanSoFar) : "—",
        suffix: spanNow != null ? "typical" : spanSoFar != null ? "so far" : "",
        pill: trendPill(spanNow, spanBefore, before.length, 60, formatMinutes, false),
        plot: renderTrendLine(
          shown.map((period) => ({ start: period.start, value: period.session_count > 0 ? period.median_stretch_seconds : null, label: formatMinutes(period.median_stretch_seconds) })),
          running,
          spanNow,
          lineTicks,
          "No stretch of work recorded yet",
        ),
      })}
      ${renderTrendCard({
        tone: "recovery",
        title: "Recovery",
        hint: "time back to work after a distraction · lower is better",
        value: recoveryNow != null ? formatRecovery(recoveryNow) : recoverySoFar != null ? formatRecovery(recoverySoFar) : "—",
        suffix: recoveryNow != null ? "typical" : recoverySoFar != null ? "so far" : "",
        pill: trendPill(recoveryNow, recoveryBefore, before.length, 5, formatRecovery, true),
        plot: renderTrendLine(
          shown.map((period) => ({
            start: period.start,
            value: period.recovery_median_seconds,
            label: period.recovery_median_seconds == null ? "" : formatRecovery(period.recovery_median_seconds),
          })),
          running,
          recoveryNow,
          lineTicks,
          "No distractions yet, so nothing to recover from",
        ),
      })}
    </div>
  `;
}

function renderTrendCard(card: {
  tone: "focus" | "span" | "recovery";
  title: string;
  hint?: string;
  value: string;
  suffix: string;
  pill: TrendPill | null;
  line?: string;
  plot: string;
}): string {
  return `
    <section class="panel trend-card trend-${card.tone}">
      <div class="trend-head">
        <p class="eyebrow">${escapeHtml(card.title)}</p>
        ${card.hint ? `<p class="trend-hint">${escapeHtml(card.hint)}</p>` : ""}
        <div class="trend-figure">
          <p class="trend-value">${escapeHtml(card.value)}${card.suffix ? `<small>${escapeHtml(card.suffix)}</small>` : ""}</p>
          ${card.pill ? `<span class="trend-pill ${card.pill.good ? "is-good" : "is-bad"}">${escapeHtml(card.pill.text)}</span>` : ""}
        </div>
        ${card.line ? `<p class="trend-line">${escapeHtml(card.line)}</p>` : ""}
      </div>
      ${card.plot}
    </section>
  `;
}

/** Focused time, one bar per period, as the week chart in History draws its days: a hover nudges
 *  the bar and its tag rises. A dashed line behind the bars marks the average of the finished
 *  periods. */
function renderTrendBars(shown: TrendPeriod[], running: string, average: number | null, ticks: string[], animate: boolean): string {
  const max = Math.max(...shown.map((period) => period.focus_seconds), 1);
  const columns = `grid-template-columns: repeat(${shown.length}, minmax(0, 1fr))`;
  // Bars widen when there are few and slim down as the window fills: 116px for one, the full
  // column at twelve (never wider than their column).
  const barWidth = Math.round(Math.max(64, 120 - shown.length * 4.5));
  const bars = shown
    .map((period, index) => {
      const on = period.focus_seconds > 0;
      const now = period.start === running;
      const sessions = period.session_count === 1 ? "1 session" : `${period.session_count} sessions`;
      const tip = on ? `${formatHours(period.focus_seconds)}${now ? " so far" : ""} · ${sessions}` : "No sessions";
      return `
        <button type="button" class="recap-bar-col" aria-label="${attr(`${trendPeriodName(period.start)}: ${tip}`)}">
          <span class="recap-bar-track">
            <span class="recap-bar ${on ? "is-on" : ""} ${now ? "is-now" : ""}" style="--i: ${index}; ${on ? `height: ${smartBarHeight(period.focus_seconds, max, 14)}%` : ""}">
              <span class="week-tip">${escapeHtml(tip)}</span>
            </span>
          </span>
        </button>
      `;
    })
    .join("");
  const line =
    average != null && average > 0
      ? `<div class="trend-avg" style="bottom: calc(var(--axis-gap) + var(--track) * ${(smartBarHeight(average, max, 14) / 100).toFixed(3)})"><b>Avg ${escapeHtml(formatHours(average))}</b></div>`
      : "";
  return `
    <div class="trend-bars-plot" style="--bar-w: ${barWidth}px">
      ${line}
      <div class="recap-bars trend-bars ${animate ? "is-animated" : ""}" style="${columns}">${bars}</div>
    </div>
    <div class="trend-ticks ${shown.length > 8 ? "is-crowded" : ""}" style="${columns}" aria-hidden="true">${ticks.map((tick) => `<span>${escapeHtml(tick)}</span>`).join("")}</div>
  `;
}

/** A line through the finished periods with a dashed typical line; the period in progress is a
 *  hollow point off the line, so a part-period never reads as a drop. The scale starts at zero, so
 *  a small change looks small, and each point sits over its label, in the bars' columns. */
function renderTrendLine(
  points: { start: string; value: number | null; label: string }[],
  running: string,
  typical: number | null,
  ticks: string[],
  emptyNote: string,
): string {
  const known = points.flatMap((point, index) => (point.value == null ? [] : [{ ...point, value: point.value, index }]));
  if (!known.length) {
    return `<p class="trend-empty">${escapeHtml(emptyNote)}</p>`;
  }
  const W = 400;
  const H = 120;
  const top = Math.max(...known.map((point) => point.value), typical ?? 0) * 1.2 || 1;
  const x = (index: number) => ((index + 0.5) / points.length) * W;
  // A zero sits 12 units above the axis, so no point ever touches it.
  const y = (value: number) => 8 + (H - 20) * (1 - value / top);
  const finished = known.filter((point) => point.start !== running);
  const path = finished.map((point) => `${x(point.index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const dots = known
    .map((point) => {
      const now = point.start === running;
      const tip = `${point.label}${now ? " so far" : ""}`;
      return `
        <span class="trend-point ${now ? "is-now" : ""}" tabindex="0" role="img" aria-label="${attr(`${trendPeriodName(point.start)}: ${tip}`)}" style="left: ${((x(point.index) / W) * 100).toFixed(2)}%; top: ${((y(point.value) / H) * 100).toFixed(2)}%">
          <span class="week-tip">${escapeHtml(tip)}</span>
        </span>
      `;
    })
    .join("");
  return `
    <div class="trend-line-plot">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <line class="trend-baseline" x1="0" x2="${W}" y1="${H}" y2="${H}" />
        ${typical != null ? `<line class="trend-typical" x1="0" x2="${W}" y1="${y(typical).toFixed(1)}" y2="${y(typical).toFixed(1)}" />` : ""}
        ${finished.length > 1 ? `<polyline class="trend-path" points="${path}" />` : ""}
      </svg>
      ${dots}
    </div>
    <div class="trend-ticks" style="grid-template-columns: repeat(${points.length}, minmax(0, 1fr))" aria-hidden="true">${ticks.map((tick) => `<span>${escapeHtml(tick)}</span>`).join("")}</div>
  `;
}

/** Every week and month since the first session, for Trends; it pages through them itself. */
export async function refreshTrendPeriods(): Promise<void> {
  try {
    const [week, month] = await Promise.all([
      invoke<TrendPeriod[]>("get_trend_periods", { unit: "week" }),
      invoke<TrendPeriod[]>("get_trend_periods", { unit: "month" }),
    ]);
    trendPeriods = { week, month };
  } catch (error) {
    setLastError(errorText(error));
  }
}

export async function refreshTrends(shouldRender = true): Promise<void> {
  try {
    trends = await invoke<TrendsData>("get_trends");
    setLastError("");
  } catch (error) {
    setLastError(errorText(error));
  }
  trendsLoaded = true;
  // A finished session changes the open Trends page too.
  if (appView === "main" && activeTab === "history" && historyView === "trends") {
    await refreshTrendPeriods();
  }
  if (shouldRender) {
    render();
  }
}

export async function trendsAction(action: string, source?: HTMLElement): Promise<void> {
  if (action === "trend-unit" || action === "trend-older" || action === "trend-newer") {
    if (action === "trend-unit") {
      const unit = source?.dataset.unit === "month" ? "month" : "week";
      if (unit === trendUnit) {
        return;
      }
      trendUnit = unit;
      trendPage = 0;
    } else {
      const pages = trendPageCount(trendPeriods?.[trendUnit] ?? []);
      trendPage = Math.max(0, Math.min(pages - 1, trendPage + (action === "trend-older" ? 1 : -1)));
    }
    // New numbers rise in, as a new week does in History.
    pendingAnimations.add("trends");
    render();
    return;
  }
}

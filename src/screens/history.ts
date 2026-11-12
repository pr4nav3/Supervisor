import { invoke } from "@tauri-apps/api/core";
import type {
  AppRule, DailyFocus, HistoryConfirm, HistoryView, HistoryWeek, MonthRecap, RecapApp, RulesSaved,
  SessionReport, SessionSnapshot, SessionSummary, Tab, TrendPeriod, WeekRecap,
} from "../core/types";
import {
  addDaysKey, addMonthsKey, dayKey, formatBytes, formatHours, formatRecovery, formatSpan,
  formatStretchChip, formatWeekRange, formatWeekStart, mondayKey, monthKey, parseDayKey,
  smartBarHeight, thisMondayKey,
} from "../core/format";
import { attr, confirmModal, errorText, escapeHtml, modal, showFeedback } from "../core/dom";
import {
  appNames, clearLastError, history, knownHistoryIds, setActiveTab, setAppNames,
  setLastError, setSettingsView, setSiteNames, setSnapshot, settingsView, siteNames,
} from "../core/state";
import { paintSlot, reconcilePolling, refreshSnapshotNow, render } from "../core/shell";
import { copyCanvas, drawMonthCard, drawWeekCard } from "../core/cards";
import { flippedStats, flipStat, renderSessionReport } from "./report";
import { refreshTrendPeriods, refreshTrends, renderTrends, setTrendPage, trends } from "./trends";
import { stopWebcamPreview } from "./webcam";
import { practiceIds } from "./firstRun";
import { permanentRules, setPermanentRules } from "./rules";
import { leaveVoiceScreen } from "./lines";
import { renderQuitConfirm, renderReviewLayer, renderSessionOver, setSessionReview } from "./session";
import { setDayCardKey } from "./home";

/** A few seconds of burst photos on a phone. History is a sliver of that. */
const PHOTO_BURST_BYTES = 30 * 1024 ** 2;
export let historyWeekStart = "";
/** Bumped per week request, so a slow earlier week cannot land over the one shown now. */
let historyWeekRequest = 0;
export let historyWeek: HistoryWeek | null = null;
export let sessionReport: SessionReport | null = null;
export function setSessionReport(value: SessionReport | null): void {
  sessionReport = value;
}
export let weekRecap: WeekRecap | null = null;
export let historyView: HistoryView = "list";
export function setHistoryView(value: HistoryView): void {
  historyView = value;
}
/** Which list sits under the week: its sessions or where its time went. */
let historyPane: "sessions" | "apps" = "sessions";
export let historySearch = "";
export function setHistorySearch(value: string): void {
  historySearch = value;
}
/** Null until the first search of the current text answers. */
let historySearchResults: SessionSummary[] | null = null;
let historySearchTimer: number | undefined;
let historySearchRequest = 0;
/** The week (and data state) whose charts already played their entrance. */
let historyChartsFor = "";
/** The week picker under the toolbar: open, the month it shows (its first day), and that
 * month's days with sessions. */
export let weekPickerOpen = false;
let pickerMonth = "";
let pickerDays: Record<string, DailyFocus> = {};
let pickerRequest = 0;
export let historyConfirm: HistoryConfirm | null = null;
export function setHistoryConfirm(value: HistoryConfirm | null): void {
  historyConfirm = value;
}
/** The Share popup over History, and the month it shows (loaded when it opens). */
export let shareOpen = false;
export function setShareOpen(value: boolean): void {
  shareOpen = value;
}
let shareMonth: MonthRecap | null = null;
/**
 * The popup a row of Apps & sites opens: its name, a website's address, and whether it counts as
 * work or a distraction. One choice for both: it rewrites the sessions it was opened from (the
 * report's one, or every session of the week shown) and puts the item on the distractions list
 * or takes it off, so it counts the same way from then on. `listable` is false for a browser,
 * which can't be a distraction by itself; null until that is known.
 */
interface AppEdit {
  kind: "app" | "website";
  key: string;
  label: string;
  name: string;
  address: string;
  distraction: boolean;
  wasDistraction: boolean;
  sessionIds: number[];
  listable: boolean | null;
  /** Allowed once in the report's session, so its time there counted as work. */
  allowed: boolean;
  error: string;
}
export let appEdit: AppEdit | null = null;
export function setAppEdit(value: AppEdit | null): void {
  appEdit = value;
}

/** Stat values never wrap or ellipsize: shrink the font until the value fits its tile. The
 *  report tiles use the system monospace, which is wider on a Mac (SF Mono) than on Windows,
 *  so "40:00 min" overflows there at the stylesheet's size. */
export function fitShareStats(): void {
  document.querySelectorAll<HTMLElement>(".share-stats strong").forEach((value) => {
    let size = 1.1;
    value.style.fontSize = `${size}rem`;
    while (size > 0.72 && value.scrollWidth > value.clientWidth) {
      size -= 0.04;
      value.style.fontSize = `${size.toFixed(2)}rem`;
    }
  });
  document.querySelectorAll<HTMLElement>(".report-stat strong").forEach((value) => {
    value.style.fontSize = "";
    let size = parseFloat(getComputedStyle(value).fontSize) / 16;
    while (size > 0.9 && value.scrollWidth > value.clientWidth) {
      size -= 0.04;
      value.style.fontSize = `${size.toFixed(2)}rem`;
    }
  });
}

/** Size first (it's tiny), then what deleting costs. */
function deleteAllCopy(bytes: number | null | undefined): string[] {
  const cost =
    "It's also how Supervisor shows you where your time actually goes. Delete it and your attention span, trends and recaps start over from nothing. This can't be undone.";
  if (!bytes) {
    return [cost.replace("It's also how", "History is how")];
  }
  const ratio = PHOTO_BURST_BYTES / bytes;
  const comparison =
    ratio >= 2
      ? `so deleting it frees about 1/${Math.round(ratio)} of a single burst`
      : ratio >= 0.5
        ? "so it's about one burst"
        : `so it's about ${Math.round(1 / ratio)} bursts`;
  return [
    `All of it takes up ${formatBytes(bytes)}. A quick burst of phone photos is around 30 MB, ${comparison}.`,
    cost,
  ];
}

function renderHistoryConfirm(): string {
  if (!historyConfirm) {
    return "";
  }

  const copy =
    historyConfirm.kind === "delete-all"
      ? {
          eyebrow: "YOUR DATA",
          title: "Delete all history?",
          body: deleteAllCopy(historyConfirm.bytes),
          cancel: "Keep my history",
          confirm: "Delete everything",
        }
      : {
          eyebrow: "HISTORY",
          title: "Delete this session?",
          body: ["This session will be removed from this computer. You cannot undo this."],
          cancel: "Cancel",
          confirm: "Delete session",
        };
  const body = copy.body.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
  return confirmModal("history-confirm-title", copy.eyebrow, copy.title, body, ["cancel-history-confirm", copy.cancel], ["confirm-history", copy.confirm]);
}

export function renderHistory(): string {
  if (historyView === "report" && sessionReport) {
    return `${renderSessionReport(sessionReport)}<div id="review-layer" class="slot">${renderReviewLayer()}</div>`;
  }
  if (historyView === "trends") {
    return renderTrends();
  }
  return `
    <section class="history-page">
      ${renderHistoryToolbar(historyWeekShown())}
      <div id="history-body" class="slot">${renderHistoryBody()}</div>
    </section>
  `;
}

function historyWeekShown(): string {
  return historyWeek?.week_start || historyWeekStart || thisMondayKey();
}

/** Everything under the toolbar: search results, or the week's charts and lists. */
function renderHistoryBody(): string {
  if (historySearch.trim()) {
    return renderSearchResults();
  }
  const weekStart = historyWeekShown();
  const sessions = historyWeek?.sessions ?? [];
  const recap = weekRecap && weekRecap.start === weekStart ? weekRecap : null;
  // Both charts rise together on arriving at the tab and on the first draw of another week's
  // data; a pane switch or a poll later leaves the bars standing.
  const animate = recap !== null && (takeAnimation("history") || historyChartsFor !== weekStart);
  if (recap) {
    historyChartsFor = weekStart;
  }
  const emptyWeek = historyWeek?.oldest_day
    ? "No sessions this week."
    : "Finish a session and its report shows up here. Nothing leaves this computer.";
  return `
    <div class="history-hero">
      ${renderWeekHero(weekStart, recap, animate)}
      <div class="history-side">
        ${renderShareDoor(weekStart, recap)}
        ${renderTrendsDoor(weekStart, recap, animate)}
      </div>
    </div>
    <div class="history-seg-row">
      <div class="history-seg" role="group" aria-label="Show">
        <button type="button" class="${historyPane === "sessions" ? "is-on" : ""}" aria-pressed="${historyPane === "sessions"}" data-action="history-pane" data-pane="sessions">Sessions · ${sessions.length}</button>
        <button type="button" class="${historyPane === "apps" ? "is-on" : ""}" aria-pressed="${historyPane === "apps"}" data-action="history-pane" data-pane="apps">Apps &amp; sites · ${recap?.apps.length ?? 0}</button>
      </div>
    </div>
    ${historyPane === "apps" ? renderWeekAppsPane(recap) : renderSessionsPane(sessions, emptyWeek)}
  `;
}

/** A small card above the Trends door that opens the Share popup: the viewed week and its
 *  month as pictures. Before the first session it stays, dimmed, so the column keeps its shape. */
function renderShareDoor(weekStart: string, recap: WeekRecap | null): string {
  const ready = recap !== null && recap.start === weekStart && historyWeek?.oldest_day != null;
  return `
    <button type="button" class="panel share-door" data-action="open-share" ${ready ? "" : 'aria-disabled="true"'}>
      <span class="share-door-text">
        <span class="eyebrow">Share</span>
        <strong>${ready ? "Week and month cards" : "Nothing to share yet"}</strong>
      </span>
      ${ready ? '<span class="trend-door-go" aria-hidden="true">Open ›</span>' : ""}
    </button>
  `;
}

/** The Share popup: the week card and the month card drawn as they will be copied, each with
 *  its button. The month is fetched before it opens, so it opens once, at its full size. */
function renderShareModal(): string {
  if (!shareOpen) {
    return "";
  }
  // The cards go in as canvases, not encoded images: encoding two large PNGs on every paint
  // held up the popup. They are swapped in once this markup is in the page, before it paints.
  queueMicrotask(mountShareCards);
  const week = weekRecap && weekRecap.start === historyWeekStart ? weekRecap : null;
  const month = shareMonth && shareMonth.start.slice(0, 7) === historyWeekStart.slice(0, 7) ? shareMonth : null;
  return modal("share-panel", "share-title", `
        <div class="modal-head share-head">
          <div>
            <p class="eyebrow">History</p>
            <h2 id="share-title">Share</h2>
            <p class="share-sub">Click a card to copy it, then paste it anywhere.</p>
          </div>
          <button type="button" data-action="close-share">Cancel</button>
        </div>
        <div class="share-grid">
          ${renderShareColumn(week !== null, "week", "copy-week-card", week !== null && week.session_count > 0, "No sessions this week")}
          ${renderShareColumn(month !== null, "month", "copy-month-card", month !== null && month.session_count > 0, "No sessions this month")}
        </div>
      `);
}

/** The card is the button, like the day card on Home: a click copies it. A period with no
 *  sessions shows its card, still, with a line saying why it can't be copied. */
function renderShareColumn(drawn: boolean, card: "week" | "month", action: string, ready: boolean, note: string): string {
  if (!drawn) {
    return `<div class="share-col"><div class="share-preview share-preview-empty" aria-hidden="true"></div></div>`;
  }
  const slot = `<span class="share-preview" data-share-card="${card}"></span>`;
  return `
    <div class="share-col">
      ${ready ? `<button type="button" class="share-pick" data-action="${action}" aria-label="Copy the ${card} card">${slot}</button>` : slot}
      ${ready ? "" : `<p class="share-note">${escapeHtml(note)}</p>`}
    </div>
  `;
}

/** Draws each card into its place in the popup. */
function mountShareCards(): void {
  document.querySelectorAll<HTMLElement>("[data-share-card]").forEach((slot) => {
    const week = slot.dataset.shareCard === "week";
    const canvas = week ? (weekRecap ? drawWeekCard(weekRecap) : null) : shareMonth ? drawMonthCard(shareMonth) : null;
    if (!canvas) {
      return;
    }
    canvas.className = "share-preview";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", week ? "Week card" : "Month card");
    slot.replaceWith(canvas);
  });
}

async function fetchShareMonth(): Promise<MonthRecap | null> {
  try {
    return await invoke<MonthRecap>("get_month_recap", { start: historyWeekStart });
  } catch (error) {
    showFeedback(`Could not load the month: ${errorText(error)}`);
    return null;
  }
}

/** The Monday of the first recorded week. With no history yet it is this week: nothing
 *  before the app was in use can be reached, by arrow or by picker. */
function oldestWeekMonday(): string {
  return historyWeek?.oldest_day ? mondayKey(historyWeek.oldest_day) : thisMondayKey();
}

function renderHistoryToolbar(weekStart: string): string {
  const oldestMonday = oldestWeekMonday();
  const current = thisMondayKey();
  const prevDisabled = weekStart <= oldestMonday;
  const nextDisabled = weekStart >= current;
  const tag = weekStart === current ? "This week" : weekStart === addDaysKey(current, -7) ? "Last week" : "";
  return `
    <div class="panel history-toolbar">
      <div class="history-week-nav">
        <button type="button" class="history-week-arrow" data-action="history-week-prev" ${prevDisabled ? "disabled" : ""} aria-label="Previous week">‹</button>
        <button type="button" class="history-week-label ${weekPickerOpen ? "is-open" : ""}" data-action="toggle-week-picker" aria-expanded="${weekPickerOpen}" aria-haspopup="dialog" title="Pick a week">
          <h2>${escapeHtml(formatWeekRange(weekStart))}${tag ? `<span>${tag}</span>` : ""}</h2>
        </button>
        <button type="button" class="history-week-arrow" data-action="history-week-next" ${nextDisabled ? "disabled" : ""} aria-label="Next week">›</button>
        ${weekStart === current ? "" : `<button type="button" class="history-week-today" data-action="history-week-today">This week</button>`}
      </div>
      <div id="week-picker-slot" class="slot">${weekPickerOpen ? renderWeekPicker(weekStart, oldestMonday) : ""}</div>
      <label class="history-search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
        <input id="history-search" type="search" value="${attr(historySearch)}" placeholder="Search session names" aria-label="Search sessions by name" autocomplete="off" spellcheck="false" />
      </label>
    </div>
  `;
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const PICKER_GRID_DAYS = 42;

/** A month of days, shaded by focused time, with the viewed week outlined; a click picks that
 * day's week. */
function renderWeekPicker(weekStart: string, oldestMonday: string): string {
  const month = pickerMonth || monthKey(weekStart);
  const today = dayKey(new Date());
  const currentMonth = monthKey(today);
  const weekEnd = addDaysKey(weekStart, 6);
  const gridStart = mondayKey(month);
  const prevDisabled = month <= monthKey(oldestMonday);
  const nextDisabled = month >= currentMonth;
  const title = parseDayKey(month).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const cells = Array.from({ length: PICKER_GRID_DAYS }, (_, index) => {
    const day = addDaysKey(gridStart, index);
    const inMonth = day.slice(0, 7) === month.slice(0, 7);
    // Nothing before the first recorded week, same bound as the ‹ arrow.
    const future = day > today || mondayKey(day) < oldestMonday;
    const focus = pickerDays[day]?.focus_seconds ?? 0;
    const level = focus <= 0 ? "" : focus >= 90 * 60 ? "l3" : focus >= 25 * 60 ? "l2" : "l1";
    const classes = [
      "wp-day",
      inMonth ? "" : "is-out",
      future ? "is-future" : "",
      level,
      day >= weekStart && day <= weekEnd ? "is-selected" : "",
      day === today ? "is-today" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const info = pickerDays[day];
    const label = info
      ? `${parseDayKey(day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}, ${formatHours(info.focus_seconds)} focused`
      : parseDayKey(day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    return `<button type="button" class="${classes}" data-action="pick-week" data-day="${day}" ${future ? "disabled" : ""} aria-label="${attr(label)}" title="${attr(label)}">${Number(day.slice(8))}</button>`;
  });
  // Each week is one row, so hovering any of its days lights the whole week: the thing a click picks.
  const rows = Array.from({ length: cells.length / 7 }, (_, week) => `<div class="wp-week">${cells.slice(week * 7, week * 7 + 7).join("")}</div>`).join("");
  return `
    <div class="panel week-picker" role="dialog" aria-label="Pick a week">
      <div class="week-picker-head">
        <button type="button" data-action="picker-month-prev" ${prevDisabled ? "disabled" : ""} aria-label="Previous month">‹</button>
        <strong>${escapeHtml(title)}</strong>
        <button type="button" data-action="picker-month-next" ${nextDisabled ? "disabled" : ""} aria-label="Next month">›</button>
      </div>
      <div class="week-picker-grid">
        ${["M", "T", "W", "T", "F", "S", "S"].map((d) => `<span class="wp-dow" aria-hidden="true">${d}</span>`).join("")}
        ${rows}
      </div>
      <p class="week-picker-note">Click any day to see its week. Greener days had more focused time.</p>
    </div>
  `;
}

/** Loads the days with sessions for the month the picker shows. */
async function loadPickerDays(): Promise<void> {
  const month = pickerMonth || monthKey(historyWeekStart || thisMondayKey());
  const start = mondayKey(month);
  const request = ++pickerRequest;
  try {
    const days = await invoke<DailyFocus[]>("get_focus_days", { start, end: addDaysKey(start, PICKER_GRID_DAYS) });
    if (request !== pickerRequest) {
      return;
    }
    pickerDays = Object.fromEntries(days.map((day) => [day.date, day]));
  } catch (error) {
    if (request !== pickerRequest) {
      return;
    }
    setLastError(errorText(error));
    render();
    return;
  }
  paintWeekPicker();
}

export function closeWeekPicker(): void {
  weekPickerOpen = false;
  pickerMonth = "";
  pickerDays = {};
  pickerRequest += 1;
}

/** Focused hours, longest stretch and recovery for the week, over its daily bars. */
function renderWeekHero(weekStart: string, recap: WeekRecap | null, animate: boolean): string {
  const current = weekStart === thisMondayKey();
  const empty = recap !== null && recap.session_count === 0;
  const note = !recap
    ? ""
    : empty
      ? current
        ? "No sessions yet this week. Finish one and today's bar fills in."
        : "No sessions that week."
      : current && recap.session_count === 1
        ? "1 session so far"
        : `${recap.session_count} sessions${current ? " so far" : ""}`;
  const buckets = recap?.buckets ?? WEEKDAY_LABELS.map((label) => ({ label, focus_seconds: 0 }));
  const max = Math.max(...buckets.map((bucket) => bucket.focus_seconds), 1);
  const todayIndex = current ? (new Date().getDay() + 6) % 7 : -1;
  const longest = recap?.longest_stretch_seconds ? formatStretchChip(recap.longest_stretch_seconds) : "—";
  const recovery =
    recap?.recovery_median_seconds != null
      ? formatRecovery(recap.recovery_median_seconds)
      : recap && recap.session_count > 0
        ? "None"
        : "—";
  return `
    <section class="panel week-hero" aria-label="${current ? "This week" : "That week"}">
      <p class="eyebrow">${current ? "This week" : "Focused time"}</p>
      <div class="week-hero-top">
        <div class="week-hero-figure">
          <strong class="week-hero-value">${escapeHtml(formatHours(recap?.focus_seconds ?? 0))}</strong>
          ${note ? `<p class="week-hero-note">${escapeHtml(note)}</p>` : ""}
        </div>
        <div class="week-hero-stats">
          ${flipStat("week-hero-stat", "Longest stretch", longest, empty ? "Longest run of work in one go, once there is one." : "Longest run of work without a distraction or stepping away.")}
          ${flipStat("week-hero-stat", "Recovery", recovery, recovery === "None" ? "No distraction this week, so nothing to recover from." : "Typical time back to work after a distraction.")}
        </div>
      </div>
      <div class="recap-bars week-hero-bars ${animate ? "is-animated" : ""}" style="grid-template-columns: repeat(${buckets.length}, minmax(0, 1fr))">
        ${buckets
          .map((bucket, index) => {
            const on = bucket.focus_seconds > 0;
            const focused = formatHours(bucket.focus_seconds);
            const classes = ["recap-bar", on ? "is-on" : "", index === todayIndex ? "is-today" : ""].filter(Boolean).join(" ");
            return `
              <button type="button" class="recap-bar-col" aria-label="${attr(bucket.label)}, ${attr(focused)} focused">
                <span class="recap-bar-track">
                  <span class="${classes}" style="--i: ${index}; ${on ? `height: ${smartBarHeight(bucket.focus_seconds, max, 14)}%` : ""}">
                    <span class="week-tip">${escapeHtml(focused)}</span>
                  </span>
                </span>
                <span class="recap-bar-label">${escapeHtml(bucket.label)}</span>
              </button>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

/** The week against the one before it, a sparkline of recent weeks, and the way into Trends. */
function renderTrendsDoor(weekStart: string, recap: WeekRecap | null, animate: boolean): string {
  const weeks = trends.weeks;
  const previousStart = addDaysKey(weekStart, -7);
  const previous = weeks.find((week) => week.start === previousStart);
  const current = weekStart === thisMondayKey();
  const todayIndex = (new Date().getDay() + 6) % 7;
  let value = "—";
  let caption = "Nothing to compare";
  if (!recap) {
    caption = "";
  } else if (weeks.length === 0) {
    value = "No weeks yet";
    caption = "Finish a session and this week starts the chart.";
  } else if (!previous) {
    const first = weeks[0].start === weekStart && !trends.has_earlier;
    value = first ? "First week" : "Off the chart";
    caption = first ? "nothing before it" : "older weeks are in Trends";
  } else if (previous.session_count === 0 && recap.session_count === 0) {
    value = "Quiet";
    caption = current ? "no sessions this week or last" : "no sessions either week";
  } else if (recap && previous && (previous.session_count > 0 || recap.session_count > 0)) {
    const before = current && todayIndex < 6 ? focusThrough(previousStart, todayIndex) : previous.focus_seconds;
    // A running week is measured against last week up to the same weekday; "so far" says so.
    const against = current ? "last week" : "the week before";
    const soFar = current && todayIndex < 6 ? ", so far" : "";
    const change = recap.focus_seconds - before;
    if (Math.abs(change) < 60) {
      value = "Steady";
      caption = `same as ${against}${soFar}`;
    } else {
      value = `${change > 0 ? "↑" : "↓"} ${formatHours(Math.abs(change))}`;
      caption = `vs ${against}${soFar}`;
    }
  }
  const shown = weeks.slice(-DOOR_WEEKS);
  // The card is the door: a click anywhere on it opens Trends, except on a week's bar, which
  // is its own button and opens that week here. Keyboard: the card takes focus; Enter opens.
  return `
    <section class="panel trend-door ${shown.length ? "has-chart" : ""}" role="button" tabindex="0" data-action="open-trends" aria-label="View trends">
      <div class="trend-door-head">
        <p class="eyebrow">Trends</p>
        <span class="trend-door-go" aria-hidden="true">View trends ›</span>
      </div>
      <div class="trend-door-line ${weeks.length === 0 && recap ? "is-stacked" : ""}">
        <strong class="trend-door-value">${escapeHtml(value)}</strong>
        <span class="trend-door-caption">${escapeHtml(caption)}</span>
      </div>
      ${shown.length ? renderDoorChart(shown, weekStart, animate) : ""}
    </section>
  `;
}

/** Weeks on the door's chart. */
const DOOR_WEEKS = 4;

/** Plain bars, newest week at the right, no axis: the figure above says what they mean. */
function renderDoorChart(shown: TrendPeriod[], weekStart: string, animate: boolean): string {
  const maxWeek = Math.max(...shown.map((week) => week.focus_seconds), 1);
  const pad = DOOR_WEEKS - shown.length;
  const running = thisMondayKey();
  return `
    <div class="trend-spark ${animate ? "is-animated" : ""}" role="img" aria-label="Focused hours per week, last ${shown.length} weeks">
      ${'<span class="trend-spark-track"><span class="trend-spark-bar is-empty"></span></span>'.repeat(pad)}
      ${shown
        .map((week, index) => {
          const classes = ["trend-spark-bar", week.start === weekStart ? "is-viewed" : "", week.start === running ? "is-running" : "", week.focus_seconds === 0 ? "is-empty" : ""].filter(Boolean).join(" ");
          const sessions = week.session_count === 1 ? "1 session" : `${week.session_count} sessions`;
          const tip = `${formatWeekStart(week.start)} · ${formatHours(week.focus_seconds)}${week.start === running ? " so far" : ""}`;
          return `
            <button type="button" class="trend-spark-track" data-action="pick-week" data-day="${attr(week.start)}" aria-label="${attr(`${tip} · ${sessions}. Show this week`)}">
              <span class="${classes}" style="--i: ${index}; ${week.focus_seconds ? `height: ${smartBarHeight(week.focus_seconds, maxWeek, 14)}%` : ""}">
                <span class="week-tip">${escapeHtml(tip)}</span>
              </span>
            </button>
          `;
        })
        .join("")}
    </div>
    <div class="trend-spark-labels" aria-hidden="true">
      ${"<span></span>".repeat(pad)}
      ${shown
        .map((week) => {
          const text = week.start === running ? "So far" : formatWeekStart(week.start);
          return `<span class="${week.start === weekStart ? "is-viewed" : ""}">${escapeHtml(text)}</span>`;
        })
        .join("")}
    </div>
  `;
}

/** Focused seconds from `weekStart` through its `weekdayIndex`th day (0 = Monday). */
function focusThrough(weekStart: string, weekdayIndex: number): number {
  const end = addDaysKey(weekStart, weekdayIndex);
  return trends.daily_focus
    .filter((day) => day.date >= weekStart && day.date <= end)
    .reduce((sum, day) => sum + day.focus_seconds, 0);
}

function renderSessionsPane(sessions: SessionSummary[], emptyText: string): string {
  return `
    <section class="panel history-list-panel">
      <div class="history-list">
        ${
          sessions.length === 0
            ? `<p class="empty">${escapeHtml(emptyText)}</p>`
            : groupSessionsByDay(sessions)
                .map(
                  (group) => `
            <section class="history-day">
              <div class="history-day-head">
                <p class="eyebrow">${escapeHtml(group.label)}</p>
                <p class="history-day-total">${escapeHtml(dayTotalLine(group.items))}</p>
              </div>
              ${group.items.map(renderHistoryItem).join("")}
            </section>
          `,
                )
                .join("")
        }
      </div>
    </section>
  `;
}

function renderSearchResults(): string {
  const query = historySearch.trim();
  const results = historySearchResults;
  if (results === null) {
    return `<section class="panel history-list-panel"><p class="empty">Searching…</p></section>`;
  }
  const count = results.length === 1 ? "1 session" : `${results.length} sessions`;
  return `
    <div class="history-search-head">
      <p class="eyebrow">${count} matching “${escapeHtml(query)}”</p>
      ${results.length >= SEARCH_LIMIT ? `<p>Showing the newest ${SEARCH_LIMIT}</p>` : ""}
    </div>
    ${renderSessionsPane(results, "No session name matches that.")}
  `;
}

/** `search_sessions` stops here; past it the list says so. */
const SEARCH_LIMIT = 100;

function renderWeekAppsPane(recap: WeekRecap | null): string {
  if (!recap || recap.session_count === 0) {
    return `<section class="panel history-list-panel"><p class="empty">No sessions this week, so there are no apps and sites to show yet.</p></section>`;
  }
  const work = recap.apps.filter((app) => app.group === "Work");
  const distractions = recap.apps.filter((app) => app.group === "Distractions");
  if (work.length + distractions.length === 0) {
    return `<section class="panel history-list-panel"><p class="empty">Sessions ran, but Supervisor couldn't name any app or site. Time on the desktop or in a window it couldn't read isn't listed.</p></section>`;
  }
  return `<section class="panel week-apps">${renderAppColumns(recap.apps, null, "week")}</section>`;
}

function renderHistoryItem(item: SessionSummary): string {
  const time = new Date(item.started_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const hints = item.top_hints.join(" / ");
  return `
    <button class="history-item" type="button" data-action="open-report" data-session-id="${item.id}">
      <div>
        <h3>${escapeHtml(item.goal)}</h3>
        <p>${escapeHtml(hints ? `${time} · ${hints}` : time)}</p>
      </div>
      <div class="history-item-stats">
        <dl>
          <div title="Time on work: not on a distraction, your phone or watch, or away"><dt>Focused</dt><dd>${escapeHtml(formatHours(item.focus_seconds))}</dd></div>
          <div title="How long the session ran"><dt>Duration</dt><dd>${formatSpan(item.duration_seconds)}</dd></div>
          <div title="Times Supervisor spoke up about a distraction"><dt>Reminders</dt><dd>${item.nudges}</dd></div>
        </dl>
        ${renderMiniTimeline(item)}
      </div>
    </button>
  `;
}

/** A row the user can rename or move: a real app or site, not the phone, Away or Supervisor. */
function editableApp(app: RecapApp): boolean {
  return (app.kind === "website" || app.kind === "app") && !["untracked", "supervisor", "phone"].includes(app.key);
}

/** What the session allowed once, at any point: "website:youtube.com", "app:slack". */
export function allowedInReport(report: SessionReport): Set<string> {
  return new Set(report.events.filter((event) => event.kind === "allowed" && event.detail).map((event) => (event.detail ?? "").toLowerCase()));
}

export function renderAppColumns(apps: RecapApp[], sessionId: number | null, period: "session" | "week", allowed = new Set<string>()): string {
  const work = apps.filter((app) => app.group === "Work");
  const distractions = apps.filter((app) => app.group === "Distractions");
  const away = apps.filter((app) => app.group === "Away");
  const column = (title: string, items: RecapApp[], emptyText: string) => {
    const total = items.reduce((sum, app) => sum + app.seconds, 0);
    return `
      <div class="recap-app-block">
        <p class="eyebrow">${escapeHtml(title)}${items.length ? ` · ${escapeHtml(formatHours(total))}` : ""}</p>
        <div class="recap-app-group">${items.length ? renderAppRows(items, sessionId, allowed) : `<p class="week-app-empty">${escapeHtml(emptyText)}</p>`}</div>
      </div>
    `;
  };
  const awayLine = away.map((row) => `${row.label} ${formatHours(row.seconds)}`).join(" · ");
  const editable = apps.some((item) => editableApp(item));
  return `
    <div class="week-app-cols">
      ${column("Work", work, "Every minute was on something from the distractions list.")}
      ${column("Distractions", distractions, period === "week" ? "Nothing from the distractions list came up this week." : "Nothing from the distractions list came up.")}
    </div>
    ${awayLine || editable ? `<div class="week-app-foot">${awayLine ? `<span>${escapeHtml(awayLine)}</span>` : ""}${editable ? `<span>${APP_EDIT_HINT}</span>` : ""}</div>` : ""}
  `;
}

const APP_EDIT_HINT = "Click a row to rename it or change how it counts.";

/** One line per app or site: its name and its time. A real app or site is a quiet button that
 *  opens its popup (see AppEdit); `sessionId` is the report's session, or null for the week. */
function renderAppRows(items: RecapApp[], sessionId: number | null = null, allowed = new Set<string>()): string {
  return items
    .map((app) => {
      const tone = app.group === "Distractions" ? "is-distraction" : "";
      // A listed distraction the session allowed once: it sits in Work, and says why.
      const wasAllowed = app.group === "Work" && allowed.has(`${app.kind}:${app.key.toLowerCase()}`);
      const cells = `
        <span class="recap-app-name">${escapeHtml(app.label)}${wasAllowed ? `<span class="recap-app-tag">Allowed</span>` : ""}</span>
        <strong>${escapeHtml(formatHours(app.seconds))}</strong>
      `;
      if (!editableApp(app)) {
        return `<div class="recap-app-row ${tone}">${cells}</div>`;
      }
      return `
        <button type="button" class="recap-app-row is-editable ${tone}" data-action="edit-app" data-kind="${app.kind}" data-key="${attr(app.key)}" data-label="${attr(app.label)}" data-distraction="${app.group === "Distractions"}" data-allowed="${wasAllowed}" data-session-id="${sessionId ?? ""}" aria-label="${attr(`Edit ${app.label}`)}">
          ${cells}
        </button>
      `;
    })
    .join("");
}

/** The popup over History for one app or site. */
function renderAppEdit(): string {
  const edit = appEdit;
  if (!edit) {
    return "";
  }
  const site = edit.kind === "website";
  const counts = edit.listable === false
    ? `<p class="app-edit-note">A browser counts by the sites open in it, so it can't be a distraction by itself.</p>`
    : `
      ${edit.allowed ? `<p class="app-edit-note">Allowed once this session, so its time counted as work. It's still on your distractions list.</p>` : ""}
      <div class="app-edit-field">
        <span>Counts as</span>
        <div class="mode-tabs" role="group" aria-label="Counts as">
          <button class="${edit.distraction ? "" : "active"}" type="button" data-action="app-edit-counts" data-counts="work" aria-pressed="${!edit.distraction}">Work</button>
          <button class="${edit.distraction ? "active" : ""}" type="button" data-action="app-edit-counts" data-counts="distraction" aria-pressed="${edit.distraction}">Distraction</button>
        </div>
      </div>
    `;
  return modal("app-edit-panel", "app-edit-title", `
        <div class="modal-head app-edit-head">
          <div>
            <p class="eyebrow">${site ? "Website" : "App"}</p>
            <h2 id="app-edit-title">${escapeHtml(appEditTitle(edit))}</h2>
          </div>
          <div class="app-edit-actions">
            <button class="small-button" type="button" data-action="app-edit-cancel">Cancel</button>
            <button class="small-button primary" type="button" data-action="app-edit-save">Save</button>
          </div>
        </div>
        <label class="app-edit-field">
          <span>Name</span>
          <input id="app-edit-name" maxlength="60" value="${attr(edit.name)}" placeholder="${attr(site ? edit.key : edit.label)}" spellcheck="false" />
        </label>
        ${site ? `<label class="app-edit-field"><span>Address</span><input id="app-edit-address" maxlength="300" value="${attr(edit.address)}" spellcheck="false" /></label>` : ""}
        ${counts}
        ${edit.error ? `<p class="app-edit-error">${escapeHtml(edit.error)}</p>` : ""}
      `);
}

export function appEditTitle(edit: AppEdit): string {
  return edit.name.trim() || (edit.kind === "website" ? edit.address.trim() || edit.key : edit.label);
}

/** The name the user has given it, or nothing when it shows its own. */
function givenName(kind: "app" | "website", key: string): string {
  return kind === "website" ? siteNames[key] ?? "" : appNames[key] ?? appNames[key.toLowerCase()] ?? "";
}

async function openAppEdit(source: HTMLElement): Promise<void> {
  const kind = source.dataset.kind === "website" ? "website" : "app";
  const key = source.dataset.key ?? "";
  const label = source.dataset.label ?? key;
  const sessionId = Number(source.dataset.sessionId || "0");
  const sessionIds = sessionId ? [sessionId] : (historyWeek?.sessions ?? []).map((item) => item.id);
  const edit: AppEdit = {
    kind,
    key,
    label,
    name: givenName(kind, key) || label,
    address: key,
    distraction: source.dataset.distraction === "true",
    wasDistraction: source.dataset.distraction === "true",
    sessionIds,
    listable: kind === "website" ? true : null,
    allowed: source.dataset.allowed === "true",
    error: "",
  };
  appEdit = edit;
  paintModalLayer();
  document.querySelector<HTMLInputElement>("#app-edit-name")?.focus();
  // An app the list can't hold (a browser) loses the choice; the resolver says which.
  if (kind === "app") {
    try {
      await invoke<AppRule>("resolve_rule_input", { text: key });
      edit.listable = true;
    } catch {
      edit.listable = false;
    }
    if (appEdit === edit) {
      paintModalLayer();
    }
  }
}

/** Name, then address, then how it counts: the list first, then the sessions it was opened from. */
export async function saveAppEdit(): Promise<void> {
  const edit = appEdit;
  if (!edit) {
    return;
  }
  const site = edit.kind === "website";
  let ruleValue = edit.key;
  if (site) {
    const typed = edit.address.trim();
    if (!typed) {
      edit.error = "Type an address, like youtube.com.";
      paintModalLayer();
      return;
    }
    if (typed.toLowerCase() !== edit.key.toLowerCase()) {
      try {
        const rule = await invoke<AppRule>("resolve_rule_input", { text: typed });
        if (rule.target !== "website") {
          throw new Error("Type a web address, like youtube.com.");
        }
        ruleValue = rule.value;
      } catch (error) {
        edit.error = errorText(error);
        paintModalLayer();
        return;
      }
    }
  }
  try {
    const name = edit.name.trim() === edit.label && !givenName(edit.kind, edit.key) ? "" : edit.name.trim();
    if (name !== givenName(edit.kind, edit.key)) {
      if (site) {
        setSiteNames(await invoke<Record<string, string>>("set_site_name", { key: edit.key, name }));
      } else {
        setAppNames(await invoke<Record<string, string>>("set_app_name", { key: edit.key, name }));
      }
    }
    // The list changes only when Counts as was changed, or a listed site's address was: a row
    // in Work can be on the list (allowed once that session), and a rename must not drop it.
    const countsChanged = edit.distraction !== edit.wasDistraction;
    const addressChanged = ruleValue.toLowerCase() !== edit.key.toLowerCase();
    if (edit.listable !== false && (countsChanged || addressChanged)) {
      // Fresh from the backend: the timer window may have added rules since this window loaded.
      setPermanentRules(await invoke<AppRule[]>("get_rules"));
      const target: AppRule["target"] = site ? "website" : "app";
      const named = (rule: AppRule, value: string) => rule.target === target && rule.value.toLowerCase() === value.toLowerCase();
      const others = permanentRules.filter((rule) => !named(rule, edit.key) && !named(rule, ruleValue));
      const listed = permanentRules.some((rule) => named(rule, edit.key));
      // A new address keeps the item on the list it was on; Counts as decides otherwise.
      const keep = countsChanged ? edit.distraction : listed;
      const rules = keep ? [{ target, value: ruleValue }, ...others] : others;
      if (JSON.stringify(rules) !== JSON.stringify(permanentRules)) {
        setPermanentRules((await invoke<RulesSaved>("update_rules", { rules })).rules);
      }
    }
    // Each reclassified session comes back as its report, already carrying the new name.
    const reclassify = edit.listable !== false && edit.distraction !== edit.wasDistraction;
    if (reclassify) {
      for (const id of edit.sessionIds) {
        const report = await invoke<SessionReport>("reclassify_session_app", { id, kind: edit.kind, key: edit.key, distraction: edit.distraction });
        if (sessionReport?.id === id) {
          sessionReport = report;
        }
      }
    } else if (sessionReport && edit.sessionIds.includes(sessionReport.id)) {
      sessionReport = await invoke<SessionReport>("get_session_report", { id: sessionReport.id });
    }
    // Totals or names changed: the week, Trends and the day card read them too.
    setDayCardKey("");
    await refreshSnapshotNow();
    await Promise.all([refreshHistoryWeek(false), refreshTrends(false)]);
  } catch (error) {
    edit.error = errorText(error);
    paintModalLayer();
    return;
  }
  appEdit = null;
  paintModalLayer();
  paintHistoryBody();
  showFeedback(`${appEditTitle(edit)} saved`);
}

/** The report's bar in miniature: each run of a state at its real place and length, gaps left bare. */
function renderMiniTimeline(item: SessionSummary): string {
  const segments = item.segments ?? [];
  const end = segments.reduce((max, segment) => Math.max(max, segment.started_offset_seconds + segment.seconds), 0);
  const total = Math.max(item.duration_seconds, end, 1);
  return `
    <div class="mini-timeline" aria-hidden="true">
      ${segments
        .map(
          (segment) =>
            `<span class="state-${escapeHtml(segment.state)}" style="left: ${((segment.started_offset_seconds / total) * 100).toFixed(2)}%; width: ${((segment.seconds / total) * 100).toFixed(2)}%"></span>`,
        )
        .join("")}
    </div>
  `;
}

/** The confirm boxes and the session-over card, over whatever page is showing. */
export function renderModalLayer(): string {
  return renderHistoryConfirm() + renderQuitConfirm() + renderSessionOver() + renderShareModal() + renderAppEdit();
}

export function paintModalLayer(): void {
  paintSlot("modal-layer", renderModalLayer());
}

/** The History list under its toolbar; anywhere else in History, the whole page. */
function paintHistoryBody(): void {
  if (!paintSlot("history-body", renderHistoryBody())) {
    render();
  }
}

/** The picker and the toolbar button that opens it. */
export function paintWeekPicker(): void {
  paintSlot("week-picker-slot", weekPickerOpen ? renderWeekPicker(historyWeekShown(), oldestWeekMonday()) : "");
  const label = document.querySelector<HTMLElement>(".history-week-label");
  label?.classList.toggle("is-open", weekPickerOpen);
  label?.setAttribute("aria-expanded", String(weekPickerOpen));
}

export async function refreshHistoryWeek(shouldRender = true): Promise<void> {
  if (!historyWeekStart) {
    historyWeekStart = thisMondayKey();
  }
  const request = ++historyWeekRequest;
  try {
    const [week, recap, names] = await Promise.all([
      invoke<HistoryWeek>("get_history_week", { weekStart: historyWeekStart }),
      invoke<WeekRecap>("get_week_recap", { start: historyWeekStart }),
      invoke<Record<string, string>>("get_app_names"),
    ]);
    if (request !== historyWeekRequest) {
      return;
    }
    historyWeek = week;
    weekRecap = recap;
    setAppNames(names);
    historyWeekStart = week.week_start;
    if (historySearch.trim()) {
      await runHistorySearch(historySearch.trim());
    }
  } catch (error) {
    if (request !== historyWeekRequest) {
      return;
    }
    setLastError(errorText(error));
  }
  if (shouldRender) {
    render();
  }
}

export function scheduleHistorySearch(): void {
  clearTimeout(historySearchTimer);
  const query = historySearch.trim();
  if (!query) {
    historySearchRequest += 1;
    historySearchResults = null;
    paintHistoryBody();
    return;
  }
  historySearchTimer = window.setTimeout(() => {
    void runHistorySearch(query);
  }, 150);
}

async function runHistorySearch(query: string): Promise<void> {
  const request = ++historySearchRequest;
  try {
    const results = await invoke<SessionSummary[]>("search_sessions", { query });
    if (request !== historySearchRequest) {
      return;
    }
    historySearchResults = results;
  } catch (error) {
    if (request !== historySearchRequest) {
      return;
    }
    setLastError(errorText(error));
    render();
    return;
  }
  paintHistoryBody();
}

/** The newest session not yet seen, left unseen until its report opens (or the caller decides
 *  it never will). Anything older than it is marked seen: only the latest gets a report. */
export function noteNewHistory(items: SessionSummary[]): number | null {
  let newest: number | null = null;
  for (const item of items) {
    if (!knownHistoryIds.has(item.id)) {
      if (newest === null) {
        newest = item.id;
      } else {
        knownHistoryIds.add(item.id);
      }
    }
  }
  return newest;
}

/** `review`: the session just ended, so ask about what it counted as work first. */
export async function openHistoryReport(id: number, review = false): Promise<void> {
  if (sessionReport?.id !== id) {
    flippedStats.clear();
  }
  if (settingsView === "webcam") {
    setSettingsView("home");
    await stopWebcamPreview();
  }
  if (settingsView === "voice") {
    leaveVoiceScreen();
    setSettingsView("home");
  }
  try {
    sessionReport = await invoke<SessionReport>("get_session_report", { id });
    if (review) {
      const items = await invoke<RecapApp[]>("review_candidates", { id }).catch(() => []);
      setSessionReview(items.length
        ? { id, saving: false, items: items.map((app) => ({ ...app, distraction: false, renaming: false, name: app.label })) }
        : null);
    }
    historyView = "report";
    setActiveTab("history");
    setLastError("");
    knownHistoryIds.add(id);
    if (review) {
      localStorage.setItem("review.lastOffered", String(id));
    }
  } catch (error) {
    setLastError(errorText(error));
    historyView = "list";
    sessionReport = null;
  }
  await refreshTrends(false);
  render();
  reconcilePolling();
}

async function confirmHistoryAction(): Promise<void> {
  const confirm = historyConfirm;
  if (!confirm) {
    return;
  }
  historyConfirm = null;
  if (confirm.kind === "delete-session" && confirm.id) {
    const id = confirm.id;
    // SQLite can hand a deleted id to the next session, which must still get its Session done card.
    await runHistoryCommand("delete_session", { id }, "Session deleted", () => {
      knownHistoryIds.delete(id);
      practiceIds.delete(id);
    });
    historyView = "list";
    sessionReport = null;
    animateOnArrival("history");
    await refreshHistoryWeek();
    return;
  }
  if (confirm.kind === "delete-all") {
    await runHistoryCommand("delete_all_history", undefined, "History cleared", () => {
      knownHistoryIds.clear();
      practiceIds.clear();
      localStorage.setItem("review.lastOffered", "0");
    });
    historyView = "list";
    sessionReport = null;
    await refreshHistoryWeek();
  }
}

async function runHistoryCommand(
  command: string,
  args: Record<string, unknown> | undefined,
  message: string,
  forget: () => void,
): Promise<void> {
  try {
    await invoke(command, args ?? {});
    forget();
    setSnapshot(await invoke<SessionSnapshot>("get_session_snapshot"));
    history.forEach((item) => knownHistoryIds.add(item.id));
    setLastError("");
    await refreshTrends(false);
    await refreshHistoryWeek(false);
    showFeedback(message);
  } catch (error) {
    setLastError(errorText(error));
    render();
  }
}

/**
 * Session and History animate in when you arrive on them (and Session at launch), once: the
 * first draw that shows the calendar or the week's charts plays it, and every later redraw
 * leaves them standing.
 */
export const pendingAnimations = new Set<"calendar" | "history" | "trends">(["calendar"]);

export function animateOnArrival(tab: Tab): void {
  if (tab === "session") {
    pendingAnimations.add("calendar");
  } else if (tab === "history") {
    pendingAnimations.add("history");
    if (historyView === "trends") {
      pendingAnimations.add("trends");
    }
  }
}

export function takeAnimation(name: "calendar" | "history" | "trends"): boolean {
  return pendingAnimations.delete(name);
}

function groupSessionsByDay(items: SessionSummary[]): { label: string; items: SessionSummary[] }[] {
  const groups: { key: string; label: string; items: SessionSummary[] }[] = [];
  for (const item of items) {
    const date = new Date(item.started_at);
    const key = dayKey(date);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
      continue;
    }
    const thisYear = date.getFullYear() === new Date().getFullYear();
    groups.push({
      key,
      label: date.toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
        ...(thisYear ? {} : { year: "numeric" }),
      }),
      items: [item],
    });
  }
  return groups;
}

function dayTotalLine(items: SessionSummary[]): string {
  const sessions = items.length === 1 ? "1 session" : `${items.length} sessions`;
  const focused = items.reduce((sum, item) => sum + item.focus_seconds, 0);
  return `${formatHours(focused)} focused · ${sessions}`;
}

export async function historyAction(action: string, source?: HTMLElement): Promise<void> {
  if (action === "open-share") {
    shareMonth = await fetchShareMonth();
    shareOpen = true;
    paintModalLayer();
    return;
  }

  if (action === "close-share") {
    shareOpen = false;
    paintModalLayer();
    return;
  }

  // Both draw from data already in memory, so the clipboard write stays inside the click.
  if (action === "copy-week-card") {
    const week = weekRecap && weekRecap.start === historyWeekStart ? weekRecap : null;
    const canvas = week ? drawWeekCard(week, true) : null;
    if (canvas) {
      await copyCanvas(canvas);
    }
    return;
  }

  if (action === "copy-month-card") {
    const canvas = shareMonth ? drawMonthCard(shareMonth, true) : null;
    if (canvas) {
      await copyCanvas(canvas);
    }
    return;
  }

  if (action === "open-trends") {
    historyView = "trends";
    sessionReport = null;
    setTrendPage(0);
    pendingAnimations.add("trends");
    await refreshTrends(false);
    await refreshTrendPeriods();
    render();
    return;
  }

  if (action === "close-recap") {
    historyView = "list";
    animateOnArrival("history");
    await refreshHistoryWeek();
    return;
  }

  if (action === "toggle-week-picker") {
    if (weekPickerOpen) {
      closeWeekPicker();
      paintWeekPicker();
      return;
    }
    weekPickerOpen = true;
    pickerMonth = monthKey(historyWeekStart || thisMondayKey());
    paintWeekPicker();
    await loadPickerDays();
    return;
  }

  if (action === "picker-month-prev" || action === "picker-month-next") {
    pickerMonth = addMonthsKey(pickerMonth || monthKey(historyWeekStart || thisMondayKey()), action === "picker-month-prev" ? -1 : 1);
    pickerDays = {};
    paintWeekPicker();
    await loadPickerDays();
    return;
  }

  if (action === "pick-week") {
    const day = source?.dataset.day;
    closeWeekPicker();
    if (day && day <= dayKey(new Date()) && mondayKey(day) >= oldestWeekMonday()) {
      historyWeekStart = mondayKey(day);
    }
    await refreshHistoryWeek();
    return;
  }

  if (action === "history-week-today") {
    closeWeekPicker();
    historyWeekStart = thisMondayKey();
    await refreshHistoryWeek();
    return;
  }

  if (action === "history-pane") {
    historyPane = source?.dataset.pane === "apps" ? "apps" : "sessions";
    paintHistoryBody();
    return;
  }

  if (action === "edit-app" && source) {
    await openAppEdit(source);
    return;
  }

  if (action === "app-edit-counts" && appEdit) {
    appEdit.distraction = source?.dataset.counts === "distraction";
    appEdit.error = "";
    paintModalLayer();
    return;
  }

  if (action === "app-edit-cancel") {
    clearLastError();
    appEdit = null;
    paintModalLayer();
    return;
  }

  if (action === "app-edit-save") {
    await saveAppEdit();
    return;
  }

  if (action === "history-week-prev") {
    closeWeekPicker();
    const previous = addDaysKey(historyWeekStart || thisMondayKey(), -7);
    if (previous >= oldestWeekMonday()) {
      historyWeekStart = previous;
    }
    await refreshHistoryWeek();
    return;
  }

  if (action === "history-week-next") {
    closeWeekPicker();
    const current = thisMondayKey();
    const next = addDaysKey(historyWeekStart || current, 7);
    if (next <= current) {
      historyWeekStart = next;
      await refreshHistoryWeek();
    }
    return;
  }

  if (action === "open-report") {
    const id = Number(source?.dataset.sessionId);
    if (Number.isInteger(id) && id > 0) {
      await openHistoryReport(id);
    }
    return;
  }

  if (action === "close-report") {
    historyView = "list";
    sessionReport = null;
    historyConfirm = null;
    // A row's rename popup belongs to the report; it must not outlive it.
    appEdit = null;
    animateOnArrival("history");
    await refreshHistoryWeek();
    return;
  }

  if (action === "ask-delete-session") {
    const id = Number(source?.dataset.sessionId);
    if (Number.isInteger(id) && id > 0) {
      appEdit = null;
      historyConfirm = { kind: "delete-session", id };
      paintModalLayer();
    }
    return;
  }

  if (action === "ask-delete-all") {
    const bytes = await invoke<number>("get_history_size").catch(() => null);
    historyConfirm = { kind: "delete-all", bytes };
    paintModalLayer();
    return;
  }

  if (action === "cancel-history-confirm") {
    clearLastError();
    historyConfirm = null;
    paintModalLayer();
    return;
  }

  if (action === "confirm-history") {
    await confirmHistoryAction();
    return;
  }
}

import { invoke } from "@tauri-apps/api/core";
import type {
  AppRule, CurrentSession, NudgeVoice, PhraseMoment, PomodoroStatus, RecapApp, RulesSaved,
  SessionReport, SessionSummary,
} from "../core/types";
import { formatDuration, formatHours, monthLabel } from "../core/format";
import { attr, composing, confirmModal, errorText, escapeHtml, modal, showFeedback } from "../core/dom";
import {
  clearLastError, draft, history, knownHistoryIds, lastSessionId, setAppNames, setSiteNames,
  snapshot,
} from "../core/state";
import { invokeSnapshot, paintSlot } from "../core/shell";
import { CAMERA_DOWN_COPY, cameraDown, webcamError } from "./webcam";
import { renderVoiceRow } from "./overlay";
import {
  onboardingVisible, practiceQuietUntil, renderAccessNotice, renderOnboardingLine,
  renderUnreadableBrowserNotice,
} from "./firstRun";
import {
  permanentRules, renderRuleManager, ruleName, sameRule, setPermanentRules, setRuleEditor,
} from "./rules";
import { preflightOpen, renderPreflightModal } from "./preflight";
import { lastNudgeVoice, nudgeAudio, playLine, readyClips, selectedNudgeClip, selectedVoice } from "./voice";
import { openHistoryReport, paintModalLayer, sessionReport } from "./history";
import {
  dailyNote, ensureDayCard, focusedStretches, renderCalendar, renderDayCard, renderHomeTip,
  setDayCardKey, streakDays, stripOffTask, stripOnTask,
} from "./home";

/** Quit was picked from the tray while a session runs. */
export let quitConfirmOpen = false;
export function setQuitConfirmOpen(value: boolean): void {
  quitConfirmOpen = value;
}
export let sessionRulesOpen = false;
export function setSessionRulesOpen(value: boolean): void {
  sessionRulesOpen = value;
}
/** "Any distractions here?" after a session: what it counted as work, each one tapped or renamed. */
interface ReviewItem extends RecapApp {
  distraction: boolean;
  renaming: boolean;
  name: string;
}
export let sessionReview: { id: number; items: ReviewItem[]; saving: boolean } | null = null;
export function setSessionReview(value: { id: number; items: ReviewItem[]; saving: boolean } | null): void {
  sessionReview = value;
}
/** The closing line that just played and the session it closed, shown over the report until
 *  clicked away. */
export let sessionOver: { voice: NudgeVoice; session: SessionSummary | null } | null = null;
export function setSessionOver(value: { voice: NudgeVoice; session: SessionSummary | null } | null): void {
  sessionOver = value;
}

export function renderSession(current: CurrentSession | null): string {
  if (!current) {
    void ensureDayCard();
    const note = dailyNote();
    const streak = { days: streakDays() };
    return `
      <section class="home-ready">
        <div class="home-grid">
          <article class="panel cal-card">
            <p class="eyebrow">Calendar · ${escapeHtml(monthLabel(new Date()))}</p>
            <div class="streak-line">
              <strong>${streak.days}</strong>
              <span>day streak</span>
            </div>
            <p class="streak-rule">25 focused minutes a day keeps it going.</p>
            ${renderCalendar()}
          </article>
          <div class="home-side">
            ${onboardingVisible() ? renderOnboardingLine() : renderHomeTip()}
            <article class="panel quote-card">
              <p class="eyebrow">Daily note · ${escapeHtml(note.date)}</p>
              <blockquote>“${escapeHtml(note.text)}”</blockquote>
              <p class="quote-by">— ${escapeHtml(note.by)}</p>
            </article>
            <div id="day-card-slot" class="slot">${renderDayCard(streak.days)}</div>
          </div>
        </div>
        <button class="primary start-watch-button" type="button" data-action="open-preflight">Start focus session</button>
      </section>
      <div id="preflight-layer">${preflightOpen ? renderPreflightModal() : ""}</div>
    `;
  }

  const timer = liveTimer(current);
  const onBreak = isOnBreak(current);
  return `
    <section class="active-session-page">
      <div class="active-session-grid">
        <section class="state-slab active-state-card ${stateClass(current)}">
          ${
            current.pomodoro
              ? `<div class="eyebrow-row"><p class="eyebrow">${escapeHtml(roundLabel(current.pomodoro))}</p>${renderRoundDots(current.pomodoro)}</div>`
              : `<p class="eyebrow">Current session</p>`
          }
          <h2 aria-live="polite">${escapeHtml(stateTitle(current))}</h2>
          <div class="active-goal">
            <span>Session goal</span>
            <strong>${escapeHtml(current.goal)}</strong>
          </div>
          <div class="active-timer">
            <strong>${timer.label}</strong>
            <span>${escapeHtml(timer.caption)}</span>
          </div>
          <div class="live-strip" role="img" aria-label="Session so far: what happened, then the time left">${liveStripRuns(current)}</div>
        </section>

        <div class="session-side">
        <section class="panel session-sofar">
          <p class="eyebrow">So far</p>
          <div class="sofar-tiles">${renderSoFarTiles(current)}</div>
        </section>
        <aside class="panel session-rules-card">
          <p class="eyebrow">Distractions</p>
          ${onBreak ? `<p class="session-break-note">Don't count during a break.</p>` : renderSessionDistractions(current.exceptions)}
          ${renderAccessNotice(true)}
          ${renderUnreadableBrowserNotice(current.unreadable_browser)}
          ${cameraDown(current) ? `<section class="notice notice-access"><span>${escapeHtml(`${CAMERA_DOWN_COPY} ${webcamError}`.trim())}</span></section>` : ""}
          <button type="button" data-action="open-session-rules">Edit distractions</button>
        </aside>
        </div>
      </div>

      ${renderActiveSessionControls(current)}
    </section>
    <div id="session-rules-layer" class="slot">${sessionRulesOpen ? renderSessionRulesModal() : ""}</div>
  `;
}

/** A Pomodoro session between rounds: on its break, or waiting for the next round. */
export function isOnBreak(current: CurrentSession | null): boolean {
  return Boolean(current?.pomodoro && current.pomodoro.phase !== "work");
}

/** "Round 2", or after a round "After round 2". */
function roundLabel(pomodoro: PomodoroStatus): string {
  return pomodoro.phase === "work" ? `Round ${pomodoro.round}` : `After round ${pomodoro.round}`;
}

/** Pause's place: Resume, or on a break "Start round 3". */
export function resumeLabel(current: CurrentSession): string {
  if (current.status !== "paused") {
    return "Pause";
  }
  return isOnBreak(current) && current.pomodoro ? `Start round ${current.pomodoro.round + 1}` : "Resume";
}

/** The big countdown and its bar: the session's time, or in a Pomodoro the current round or break. */
export function liveTimer(current: CurrentSession): { label: string; caption: string; percent: number } {
  const pomodoro = current.pomodoro;
  const left = pomodoro ? pomodoro.phase_remaining_seconds : current.remaining_seconds;
  const total = !pomodoro ? current.duration_seconds : pomodoro.phase === "work" ? pomodoro.work_seconds : pomodoro.break_seconds;
  const done = pomodoro ? total - left : current.elapsed_seconds;
  const caption = !pomodoro
    ? "Remaining"
    : pomodoro.phase === "work"
      ? pomodoro.round >= pomodoro.rounds ? "Until done" : "Until break"
      : pomodoro.phase === "break_over" ? `Until round ${pomodoro.round + 1} starts by itself` : `Until round ${pomodoro.round + 1}`;
  return { label: formatDuration(left), caption, percent: total ? Math.min(100, Math.round((done / total) * 100)) : 0 };
}

export function breakOverLine(pomodoro: PomodoroStatus): string {
  return `Round ${pomodoro.round + 1} starts by itself in ${formatDuration(pomodoro.phase_remaining_seconds)}, or now.`;
}

/** One dot per round. Finished ones take the colour opposite the slab (yellow on a round,
 *  green on a break), so they always stand out; the current round is ink. */
export function renderRoundDots(pomodoro: PomodoroStatus): string {
  const finished = pomodoro.phase === "work" ? pomodoro.round - 1 : pomodoro.round;
  return `<span class="round-dots" aria-label="${finished} of ${pomodoro.rounds} rounds finished">${Array.from(
    { length: pomodoro.rounds },
    (_, index) => `<i class="${index < finished ? "done" : index === finished && pomodoro.phase === "work" ? "now" : ""}"></i>`,
  ).join("")}</span>`;
}

/** The running session's saved spans (checkpointed every 15 s), fetched every few seconds
 *  while the Session tab shows it. */
let liveReport: SessionReport | null = null;
let liveReportFetchedAt = 0;
let liveReportFetching = false;

/** The live bar and the So far numbers, repainted in place; a fresh report every 5 s. */
export function paintSoFar(current: CurrentSession): void {
  const strip = document.querySelector<HTMLElement>(".live-strip");
  if (!strip) {
    return;
  }
  strip.innerHTML = liveStripRuns(current);
  const tiles = document.querySelector<HTMLElement>(".sofar-tiles");
  if (tiles) {
    tiles.innerHTML = renderSoFarTiles(current);
  }
  if (liveReportFetching || Date.now() - liveReportFetchedAt < 5000) {
    return;
  }
  liveReportFetching = true;
  liveReportFetchedAt = Date.now();
  void invoke<SessionReport>("get_session_report", { id: current.id })
    .then((report) => {
      liveReport = report;
    })
    .catch(() => {})
    .finally(() => {
      liveReportFetching = false;
    });
}

/** What each span was, for the live bar: work, a distraction, away; a pause draws nothing. */
function liveSpanClass(state: string): string {
  if (stripOnTask(state)) {
    return "strip-on";
  }
  if (stripOffTask(state)) {
    return "strip-off";
  }
  return state === "idle" || state === "unknown" ? "strip-away" : "";
}

/** The bar spans the whole session: filled up to now with what happened, empty for the time
 *  left. The newest saved span runs on to now, since the last checkpoint can be 15 s old. */
function liveStripRuns(current: CurrentSession): string {
  const total = Math.max(1, current.duration_seconds);
  const spans = liveReport?.id === current.id ? liveReport.spans : [];
  const runs: { cls: string; from: number; to: number }[] = [];
  for (const span of spans) {
    const cls = liveSpanClass(span.state);
    const from = span.started_offset_seconds;
    const to = from + span.seconds;
    const last = runs[runs.length - 1];
    if (last && last.cls === cls && from - last.to < 2) {
      last.to = to;
    } else if (cls) {
      runs.push({ cls, from, to });
    }
  }
  const last = runs[runs.length - 1];
  if (last && current.elapsed_seconds > last.to) {
    last.to = current.elapsed_seconds;
  }
  const pct = (seconds: number) => Math.min(100, (Math.max(0, seconds) / total) * 100);
  const now = pct(current.elapsed_seconds);
  return (
    runs
      .map((run) => `<i class="${run.cls}" style="left: ${pct(run.from).toFixed(2)}%; width: ${(pct(run.to) - pct(run.from)).toFixed(2)}%"></i>`)
      .join("") + `<b class="live-now" style="left: ${now.toFixed(2)}%"></b>`
  );
}

/** Focused so far, the longest unbroken stretch, and nudges: the report's numbers, live. */
function renderSoFarTiles(current: CurrentSession): string {
  const spans = liveReport?.id === current.id ? liveReport.spans : [];
  const longest = Math.max(0, ...focusedStretches(spans));
  const tile = (label: string, value: string, title: string) =>
    `<div class="sofar-tile" title="${attr(title)}"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`;
  return [
    tile("Focused", formatHours(current.metrics.focused_seconds), "Time on work: not on a distraction, your phone or watch, or away"),
    tile("Longest", formatHours(longest), "Longest unbroken run of work"),
    tile("Reminders", String(current.metrics.nudges), "Times Supervisor spoke up"),
  ].join("");
}

/** The distractions, with the ones allowed for this session struck through. */
function renderSessionDistractions(exceptions: AppRule[]): string {
  const rules = permanentRules.slice().reverse();
  if (rules.length === 0) {
    return `<p class="session-rules-empty">Nothing on the list yet.</p>`;
  }
  // Six fit the card; the rest are behind Edit distractions. An allowed one always shows, so
  // its allowance can be taken back here.
  const isAllowed = (rule: AppRule) => exceptions.some((exception) => sameRule(exception, rule));
  const shown = rules.map((rule, index) => ({ rule, index })).filter(({ rule, index }) => index < 6 || isAllowed(rule));
  const hidden = rules.length - shown.length;
  const chips = shown
    .map(({ rule, index }) => allowChip(rule, index, isAllowed(rule), "toggle-session-exception"))
    .concat(hidden > 0 ? [`<span class="session-rule-more" aria-label="${hidden} more">…</span>`] : [])
    .join("");
  const allowed = rules.filter(isAllowed).map(ruleName);
  return `
    <div class="chips session-rule-chips">${chips}</div>
    ${allowed.length ? `<p class="session-allowed">Allowed once: ${escapeHtml(allowed.join(", "))}</p>` : ""}
  `;
}

/** A distraction chip that allows it once, or takes that back. `index` counts the newest rule first. */
export function allowChip(rule: AppRule, index: number, allowed: boolean, action: string): string {
  return `<button type="button" class="rule-chip rule-chip-distracting ${allowed ? "is-allowed" : ""}" data-action="${action}" data-rule-index="${index}" aria-pressed="${allowed}" title="${attr(allowed ? "Allowed once. Click to count it as a distraction again." : "Click to allow it once, for this session.")}">${escapeHtml(ruleName(rule))}</button>`;
}

/** Pause, mute and end, so a session can be driven from here when the session timer is off. */
function renderActiveSessionControls(current: CurrentSession): string {
  const held = current.status === "paused";
  const muted = current.status === "snoozed";
  return `
    <div class="active-session-controls">
      <button class="${held ? "primary" : "overlay-pause"}" type="button" data-action="${held ? "resume" : "pause"}">${escapeHtml(resumeLabel(current))}</button>
      <button type="button" data-action="toggle-mute" ${held ? "disabled" : ""} aria-pressed="${muted}">${muted ? "Unmute" : "Mute 5 min"}</button>
      <button class="danger" type="button" data-action="stop">End session</button>
    </div>
  `;
}

function renderSessionReview(review: { items: ReviewItem[]; saving: boolean }): string {
  const marked = review.items.filter((item) => item.distraction).length;
  const chips = review.items
    .map((item, index) => {
      const main = item.renaming
        ? `<input class="review-name" data-review-name="${index}" maxlength="60" value="${attr(item.name)}" aria-label="New name for ${attr(item.label)}" />`
        : `<button class="review-toggle" type="button" data-review-toggle="${index}" aria-pressed="${item.distraction}">
            <span>${escapeHtml(item.name)}${item.name !== item.label ? `<small class="review-was">was ${escapeHtml(item.label)}</small>` : ""}</span>
            <small>${escapeHtml(formatHours(item.seconds))}</small>
          </button>`;
      return `<div class="review-chip ${item.distraction ? "is-distraction" : ""}">${main}<button class="review-rename" type="button" data-review-rename="${index}">${item.renaming ? "Save" : "Rename"}</button></div>`;
    })
    .join("");
  return modal("review-panel", "review-title", `
        <p class="eyebrow">Session done</p>
        <h2 id="review-title">Any distractions here?</h2>
        <p class="review-intro">These counted as work. Click any that weren't.</p>
        <div class="review-chips">${chips}</div>
        <div class="review-foot">
          <button class="review-later" type="button" data-action="review-later">Skip</button>
          <button class="${marked ? "danger" : "primary"}" type="button" data-action="review-save" ${review.saving ? "disabled" : ""}>${marked ? `Add ${marked} to distractions` : "All work"}</button>
        </div>
      `);
}

/** Renames first, then the answers: the distractions go on the list and count in this session. */
async function saveSessionReview(): Promise<void> {
  const review = sessionReview;
  if (!review || review.saving) {
    return;
  }
  review.saving = true;
  try {
    for (const item of review.items.filter((item) => item.name.trim() && item.name !== item.label)) {
      if (item.kind === "website") {
        setSiteNames(await invoke<Record<string, string>>("set_site_name", { key: item.key, name: item.name }));
      } else {
        setAppNames(await invoke<Record<string, string>>("set_app_name", { key: item.key, name: item.name }));
      }
    }
    const saved = await invoke<RulesSaved>("review_session", {
      id: review.id,
      distractions: review.items
        .filter((item) => item.distraction)
        .map((item) => ({ target: item.kind === "website" ? "website" : "app", value: item.key })),
      work: review.items.filter((item) => !item.distraction).map((item) => item.key),
    });
    setPermanentRules(saved.rules);
    sessionReview = null;
    setDayCardKey("");
    await openHistoryReport(review.id);
  } catch (error) {
    review.saving = false;
    showFeedback(errorText(error));
    paintReviewLayer();
  }
}

export function bindSessionReview(root: ParentNode): void {
  const review = sessionReview;
  if (!review) {
    return;
  }
  root.querySelectorAll<HTMLButtonElement>("[data-review-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      // Tapping away keeps a name being typed, as its tick would.
      root.querySelectorAll<HTMLInputElement>("[data-review-name]").forEach((input) => {
        const open = review.items[Number(input.dataset.reviewName)];
        open.name = input.value.trim() || open.label;
        open.renaming = false;
      });
      const item = review.items[Number(button.dataset.reviewToggle)];
      item.distraction = !item.distraction;
      paintReviewLayer();
    });
  });
  const finishRename = (item: ReviewItem, input: HTMLInputElement | null, keep: boolean) => {
    if (keep && input) {
      item.name = input.value.trim() || item.label;
    }
    item.renaming = false;
    paintReviewLayer();
  };
  root.querySelectorAll<HTMLButtonElement>("[data-review-rename]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.reviewRename);
      const item = review.items[index];
      if (item.renaming) {
        finishRename(item, root.querySelector<HTMLInputElement>(`[data-review-name="${index}"]`), true);
        return;
      }
      review.items.forEach((other) => (other.renaming = false));
      item.renaming = true;
      paintReviewLayer();
      root.querySelector<HTMLInputElement>(`[data-review-name="${index}"]`)?.select();
    });
  });
  root.querySelectorAll<HTMLInputElement>("[data-review-name]").forEach((input) => {
    const item = review.items[Number(input.dataset.reviewName)];
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !composing(event)) {
        event.preventDefault();
        finishRename(item, input, true);
      } else if (event.key === "Escape") {
        // Escape drops the rename, not the popup behind it.
        event.preventDefault();
        event.stopPropagation();
        finishRename(item, null, false);
      }
    });
  });
}

function renderSessionRulesModal(): string {
  return modal("session-rules-panel", "session-rules-title", `
        <div class="modal-head">
          <div>
            <p class="eyebrow">CURRENT SESSION</p>
            <h2 id="session-rules-title">Edit distractions</h2>
          </div>
          <button class="small-button" type="button" data-action="close-session-rules">Done</button>
        </div>
        ${renderRuleManager("")}
      `);
}

export function renderQuitConfirm(): string {
  if (!quitConfirmOpen) {
    return "";
  }
  const body = "<p>The session so far is saved to History.</p>";
  return confirmModal("quit-confirm-title", "QUIT", "End this session and quit?", body, ["cancel-quit", "Cancel"], ["confirm-quit", "End and quit"]);
}

/** Session done (yellow, the round-over card's shape): the session's title and focused time,
 *  the voice with its orb, and one button to the report under it. */
export function renderSessionOver(): string {
  if (!sessionOver) {
    return "";
  }
  const { voice, session } = sessionOver;
  return `
    <div class="modal-backdrop session-over-backdrop" role="presentation">
      <section class="modal-panel session-over-card" role="dialog" aria-modal="true" aria-labelledby="session-over-title">
        <section class="state-slab interrupt-alert moment-round-over">
          <h2 class="moment-title" id="session-over-title">Session done.</h2>
          ${session ? `<p class="moment-goal">${escapeHtml(session.goal)}</p>
          <p class="moment-focused"><b>${escapeHtml(formatHours(session.focus_seconds))}</b> focused</p>` : ""}
          ${renderVoiceRow(voice)}
          <div class="moment-gap"></div>
        </section>
        <div class="interrupt-actions moment-actions">
          <button class="primary" type="button" data-action="close-session-over">See how it went</button>
        </div>
      </section>
    </div>
  `;
}

export function renderReviewLayer(): string {
  return sessionReview && sessionReview.id === sessionReport?.id ? renderSessionReview(sessionReview) : "";
}

export function paintReviewLayer(): void {
  paintSlot("review-layer", renderReviewLayer());
}

export function paintSessionRulesLayer(): void {
  paintSlot("session-rules-layer", sessionRulesOpen ? renderSessionRulesModal() : "");
}

export function statusChip(current: CurrentSession | null): string {
  if (!current) {
    return "";
  }

  if (isOnBreak(current)) {
    return "BREAK";
  }

  if (current.status === "paused") {
    return "PAUSED";
  }

  if (current.status === "snoozed") {
    return "MUTED";
  }

  return current.focus?.interrupt ? "PAY ATTENTION" : "LIVE";
}

export function stateTitle(current: CurrentSession | null): string {
  if (!current) {
    return "Ready";
  }

  if (isOnBreak(current)) {
    return current.pomodoro?.phase === "break_over" ? "Break over" : "Break";
  }

  if (current.status === "paused") {
    return "Paused";
  }

  if (current.camera.phone) {
    return current.camera.phone_distracted ? "Phone or watch out" : "Phone or watch in view";
  }

  // Looking at Supervisor: the place the user came from keeps its clock held, and this time
  // is work, so the headline must not still say Distracted.
  if (current.supervisor_in_front && current.focus?.state !== "idle") {
    return "On task";
  }
  switch (current.focus?.state) {
    case "focused":
      return "On task";
    case "suspicious":
      return "Distraction open";
    case "distracted":
      return "Distracted";
    case "idle":
      return "Away";
    default:
      return "Watching";
  }
}

export function stateCopy(current: CurrentSession | null): string {
  if (!current) {
    return "No session running.";
  }

  if (current.status === "paused") {
    return "No judgment recorded.";
  }

  if (current.camera.phone_distracted) {
    return "Put the phone or watch down.";
  }

  if (current.focus?.interrupt) {
    return "You have been here long enough. Pay attention.";
  }

  return current.goal;
}

export function stateClass(current: CurrentSession | null): string {
  if (!current) {
    return "state-ready";
  }

  if (isOnBreak(current)) {
    return "state-break";
  }

  if (current.status === "paused") {
    return "state-paused";
  }

  if (current.camera.phone) {
    return current.camera.phone_distracted ? "state-distracted" : "state-suspicious";
  }

  if (current.supervisor_in_front && current.focus?.state !== "idle") {
    return "state-focused";
  }
  return `state-${current.focus?.state ?? "waiting"}`;
}

export async function playNudge(current: CurrentSession | null): Promise<void> {
  if (!current || current.status !== "active" || draft.voiceId === "none") {
    return;
  }
  await playLine(selectedNudgeClip(current.metrics.nudges, current.camera.phone));
}

/** A Pomodoro round ended: a round-over line. A break ending plays nothing: the green card and
 *  its button say it, and the user did nothing to be corrected. Breaks are pauses, so the round
 *  line plays whatever the session's status. */
export async function playMoment(phase: string): Promise<void> {
  if (phase === "break_over") {
    return;
  }
  // The round just finished takes the next line; moments also count break ends.
  const round = snapshot?.current?.pomodoro?.round ?? 1;
  await playMomentLine("roundover", round - 1);
}

/** A session ended: a closing line, taking turns by the session's id. The card shows the
 *  session's numbers only when History's newest entry is that session (a failed save leaves
 *  the previous one on top, and its numbers would be the wrong ones). */
export async function playSessionOver(): Promise<void> {
  if (Date.now() < practiceQuietUntil) {
    return;
  }
  if ((await playMomentLine("sessionover", lastSessionId)) && lastNudgeVoice?.line) {
    const ended = history[0]?.id === lastSessionId ? history[0] : null;
    sessionOver = { voice: { ...lastNudgeVoice, speaking: !nudgeAudio?.paused }, session: ended };
    paintModalLayer();
  }
}

/** The `turn`th ready line the voice's personality has for a moment, if any. True if it played. */
async function playMomentLine(moment: PhraseMoment, turn: number): Promise<boolean> {
  if (draft.voiceId === "none") {
    return false;
  }
  const ready = readyClips(selectedVoice(), moment);
  return playLine(ready.length ? ready[turn % ready.length] : null);
}

export async function sessionAction(action: string, source?: HTMLElement): Promise<void> {
  if (action === "toggle-session-exception" && source) {
    const rule = permanentRules.slice().reverse()[Number(source.dataset.ruleIndex)];
    const current = snapshot?.current;
    if (!rule || !current) {
      return;
    }
    const allowed = !current.exceptions.some((exception) => sameRule(exception, rule));
    if (await invokeSnapshot("set_session_exception", { rule, allowed })) {
      showFeedback(allowed ? `${ruleName(rule)} allowed for this session` : `${ruleName(rule)} counts again`);
    }
    return;
  }

  if (action === "open-session-rules") {
    if (snapshot?.current) {
      sessionRulesOpen = true;
      setRuleEditor(null);
      paintSessionRulesLayer();
    }
    return;
  }

  if (action === "close-session-rules") {
    clearLastError();
    sessionRulesOpen = false;
    setRuleEditor(null);
    paintSessionRulesLayer();
    return;
  }

  if (action === "toggle-mute") {
    const mute = snapshot?.current?.status !== "snoozed";
    if (await invokeSnapshot(mute ? "snooze_session" : "resume_session")) {
      showFeedback(mute ? "Reminders muted for 5 minutes" : "Reminders back on");
    }
    return;
  }

  if (action === "review-save") {
    await saveSessionReview();
    return;
  }
  if (action === "close-session-over") {
    clearLastError();
    sessionOver = null;
    const ended = history[0];
    if (ended && !snapshot?.current && sessionReport?.id !== ended.id) {
      await openHistoryReport(ended.id, !knownHistoryIds.has(ended.id));
      return;
    }
    paintModalLayer();
    return;
  }
  if (action === "cancel-quit") {
    clearLastError();
    quitConfirmOpen = false;
    paintModalLayer();
    return;
  }
  if (action === "confirm-quit") {
    await invoke("quit_app");
    return;
  }
  if (action === "review-later") {
    // Nothing saved: the same apps come up after the next session.
    sessionReview = null;
    paintReviewLayer();
    return;
  }

  const commands: Record<string, string> = {
    pause: "pause_session",
    resume: "resume_session",
    snooze: "snooze_session",
    stop: "stop_session",
    "mark-distracting": "flag_current_distracting",
  };
  const command = commands[action];
  if (!command) {
    return;
  }

  const focus = snapshot?.current?.focus;
  if (action.startsWith("mark-") && focus && !focus.markable) {
    showFeedback(
      focus.activity.kind === "app"
        ? "A browser can't be a distraction on its own. Mark the website instead."
        : `${focus.activity.label} can't be marked. Mark a website or an app.`,
    );
    return;
  }
  const ok = await invokeSnapshot(command, undefined, !action.startsWith("mark-"));
  if (ok && action.startsWith("mark-")) {
    const name = snapshot?.current?.focus?.activity.label || "last window";
    showFeedback(`Distraction: ${name}`);
  }
}

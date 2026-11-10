import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import type { AppRule, CurrentSession, NudgeVoice, PomodoroStatus } from "../core/types";
import {
  breakOverLine, isOnBreak, liveTimer, renderRoundDots, resumeLabel, stateClass, stateCopy,
  stateTitle,
} from "../main";
import { formatDuration, formatHours } from "../core/format";
import { appView, attr, errorText, escapeHtml, showFeedback } from "../core/dom";
import { appNames, setLastError, settings, siteNames, snapshot } from "../core/state";
import { bindEvents, invokeSnapshot, render } from "../core/shell";
import { CAMERA_DOWN_COPY, cameraDown } from "./webcam";

export let overlayMoreOpen = false;
export function setOverlayMoreOpen(value: boolean): void {
  overlayMoreOpen = value;
}
export let distractionDismissedFor = "";
export let distractionLatchKey = "";
let distractionLatchLabel = "";
/** The rule the card is for, so Allow once allows it even after a switch to another window. */
let distractionLatchRule: AppRule | null = null;
export let overlayPlacement = "corner";
let lastOverlayFit = "";
const OVERLAY_CORNER_WIDTH = 228;
const OVERLAY_INTERRUPT_WIDTH = 420;
/** The card's copy of it (overlay window), stamped when it arrived. */
let overlayVoice: (NudgeVoice & { at: number }) | null = null;
export function setOverlayVoice(value: (NudgeVoice & { at: number }) | null): void {
  overlayVoice = value;
}
/** When the current distraction card first showed. */
let distractionLatchedAt = 0;
/** The Pomodoro moment card on screen ("<session>:<moment>"), when it showed, and the last one
 *  the user closed. A new moment (the break running out) brings the next card. */
let momentKey = "";
export let momentShownAt = 0;
let momentDismissed = "";

export function renderOverlay(current: CurrentSession | null): string {
  updateDistractionLatch(current);
  if (distractionIsActive()) {
    return renderDistractionOverlay(current as CurrentSession);
  }
  if (current && momentCardActive(current)) {
    return renderMomentOverlay(current);
  }
  // Muting keeps recording; only Pause holds the timer.
  const held = current?.status === "paused";
  const nudgesMuted = current?.status === "snoozed";
  const pinned = settings.status_window_on_top;
  return `
    <main class="overlay-shell">
      <section class="state-slab overlay-slab ${stateClass(current)}">
        ${nudgesMuted ? `<span class="overlay-muted-tag" title="Reminders muted. Still tracking.">Muted</span>` : current && cameraDown(current) ? `<span class="overlay-muted-tag" title="${attr(CAMERA_DOWN_COPY)}">No camera</span>` : ""}
        <h2 aria-live="polite">${escapeHtml(stateTitle(current))}</h2>
        <p>${escapeHtml(current?.goal || stateCopy(current))}</p>
        ${current ? renderOverlayProgress(current) : ""}
      </section>
      ${current ? renderOverlayActions(current, held, nudgesMuted, pinned) : ""}
    </main>
  `;
}

const OVERLAY_PAUSE_ICON = `<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="1.5" width="3.6" height="11" rx="1" fill="currentColor"/><rect x="8.4" y="1.5" width="3.6" height="11" rx="1" fill="currentColor"/></svg>`;
const OVERLAY_PLAY_ICON = `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11L12 7z" fill="currentColor"/></svg>`;
const OVERLAY_STOP_ICON = `<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="2" width="10" height="10" rx="1.5" fill="currentColor"/></svg>`;

/** One row: pause or play, stop, then More filling the rest; the menu is its own card below.
 *  A break waiting on the next round puts "Start round 3" on a row of its own first. */
function renderOverlayActions(current: CurrentSession, held: boolean, nudgesMuted: boolean, pinned: boolean): string {
  const label = resumeLabel(current);
  const roundStart = held && isOnBreak(current) && Boolean(current.pomodoro);
  const first = roundStart
    ? `<button class="primary overlay-round" type="button" data-action="resume">${escapeHtml(label)}</button>`
    : `<button class="overlay-icon ${held ? "primary" : "overlay-pause"}" type="button" data-action="${held ? "resume" : "pause"}" title="${label}" aria-label="${label}">${held ? OVERLAY_PLAY_ICON : OVERLAY_PAUSE_ICON}</button>`;
  return `
    <div class="overlay-actions ${roundStart ? "is-round" : ""}">
      ${first}
      <button class="overlay-icon danger" type="button" data-action="stop" title="End session" aria-label="End session">${OVERLAY_STOP_ICON}</button>
      <button class="overlay-more ${overlayMoreOpen ? "is-open" : ""}" type="button" data-action="toggle-overlay-more" aria-expanded="${overlayMoreOpen}">More</button>
    </div>
    ${overlayMoreOpen ? renderOverlayMoreBody(current, held, nudgesMuted, pinned) : ""}
  `;
}

function renderOverlayMoreBody(current: CurrentSession, held: boolean, nudgesMuted: boolean, pinned: boolean): string {
  return `
    <div class="overlay-more-body">
      ${isOnBreak(current) ? "" : renderOverlayWatchControls(current, held, nudgesMuted)}
      <button class="overlay-pin" type="button" data-action="${pinned ? "unpin-window" : "pin-window"}">${pinned ? "Unpin window" : "Pin window"}</button>
    </div>
  `;
}

/** More opens and closes in place. Redrawing the whole card for it made the card flash while
 *  the page was rebuilt; now only the menu comes and goes, and the window is fitted after. */
function paintOverlayMore(): void {
  const current = snapshot?.current ?? null;
  const actions = document.querySelector<HTMLElement>(".overlay-actions");
  const more = actions?.querySelector<HTMLButtonElement>(".overlay-more");
  if (!current || !actions || !more) {
    render();
    return;
  }
  more.classList.toggle("is-open", overlayMoreOpen);
  more.setAttribute("aria-expanded", String(overlayMoreOpen));
  const body = actions.nextElementSibling;
  if (body?.classList.contains("overlay-more-body")) {
    body.remove();
  }
  if (overlayMoreOpen) {
    actions.insertAdjacentHTML(
      "afterend",
      renderOverlayMoreBody(current, current.status === "paused", current.status === "snoozed", settings.status_window_on_top),
    );
    const added = actions.nextElementSibling;
    if (added) {
      bindEvents(added);
    }
  }
  lastOverlayFit = "";
  overlayFrame(() => fitOverlayWindow());
}

/** A round just ended or its break ran out, and the user hasn't closed that card. */
export function momentCardActive(current: CurrentSession | null): boolean {
  const pomodoro = current?.pomodoro;
  if (!current || !pomodoro || pomodoro.phase === "work" || pomodoro.moments === 0) {
    return false;
  }
  const key = `${current.id}:${pomodoro.moments}`;
  if (key !== momentKey) {
    momentKey = key;
    momentShownAt = Date.now();
  }
  return momentDismissed !== key;
}

/** Round over (yellow): the round's title and time, a tomato per round, the voice, one button.
 *  Break over (green): just that, the voice, and the button that starts the next round. */
function renderMomentOverlay(current: CurrentSession): string {
  const pomodoro = current.pomodoro as PomodoroStatus;
  if (pomodoro.phase === "break_over") {
    return `
      <main class="overlay-shell overlay-interrupt">
        <section class="state-slab interrupt-alert moment-break-over">
          <h2 class="moment-title">Break over.</h2>
          <p class="moment-goal">${breakOverLine(pomodoro)}</p>
          <div class="moment-gap"></div>
        </section>
        <div class="interrupt-actions moment-actions">
          <button class="primary" type="button" data-action="resume">Start round ${pomodoro.round + 1}</button>
        </div>
      </main>
    `;
  }
  const focused = pomodoro.rounds_focused_seconds[pomodoro.round - 1] ?? 0;
  return `
    <main class="overlay-shell overlay-interrupt">
      <section class="state-slab interrupt-alert moment-round-over">
        <h2 class="moment-title">Round ${pomodoro.round} done.</h2>
        <p class="moment-goal">${escapeHtml(current.goal)}</p>
        <div class="tomatoes" aria-label="${pomodoro.round} of ${pomodoro.rounds} rounds done">
          ${Array.from({ length: pomodoro.rounds }, (_, index) => `<span class="tomato ${index < pomodoro.round ? "is-done" : ""} ${index === pomodoro.round - 1 ? "is-new" : ""}"></span>`).join("")}
        </div>
        <p class="moment-focused"><b>${escapeHtml(formatHours(focused))}</b> focused</p>
        ${renderInterruptVoice(momentShownAt)}
        <div class="moment-gap"></div>
      </section>
      <div class="interrupt-actions moment-actions">
        <button class="primary" type="button" data-action="dismiss-moment">Got it</button>
      </div>
    </main>
  `;
}

function renderDistractionOverlay(current: CurrentSession): string {
  const phone = distractionLatchKey === PHONE_LATCH;
  const name = distractionLatchLabel || distractionLabel(current);
  return `
    <main class="overlay-shell overlay-interrupt">
      <section class="state-slab interrupt-alert">
        <p class="interrupt-kicker">${phone ? "Phone or watch in view" : "Distraction"}</p>
        <h2>${phone ? "Your phone or watch is out." : `You opened ${escapeHtml(name)}.`}</h2>
        ${renderInterruptVoice()}
        <div class="interrupt-task">
          <strong>${escapeHtml(current.goal)}</strong>
          <span><span class="interrupt-time">${formatDuration(current.remaining_seconds)}</span> left</span>
        </div>
      </section>
      <div class="interrupt-actions ${phone ? "" : "is-pair"}">
        ${phone ? "" : `<button type="button" data-action="allow-session" title="Allowed until this session ends">Allow once</button>`}
        <button class="primary" type="button" data-action="dismiss-distraction">Back to my task</button>
      </div>
    </main>
  `;
}

/** The voice that spoke for this card: an orb that is the play button, with bars while it
 *  speaks, and the line under the speaker's name. Nothing when no voice spoke for this card
 *  (no voice picked, or no line generated yet). A line can land a moment before the card. */
export function renderInterruptVoice(since = distractionLatchedAt): string {
  const voice = overlayVoice;
  if (!voice || voice.at < since - 5000) {
    return "";
  }
  return renderVoiceRow(voice);
}

/** The orb (play, or bars while speaking) and the line under the speaker's name. */
export function renderVoiceRow(voice: NudgeVoice): string {
  const speaking = voice.speaking;
  return `
    <div class="interrupt-voice ${speaking ? "is-speaking" : ""}">
      <button class="voice-orb" type="button" data-action="${speaking ? "nudge-stop" : "nudge-replay"}" aria-label="${speaking ? "Stop" : "Play the line again"}">
        <span class="voice-orb-core">
          <svg class="voice-orb-play" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1v10L11 6z" fill="currentColor"/></svg>
          <span class="voice-orb-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        </span>
      </button>
      <div class="interrupt-voice-text">
        <p class="interrupt-voice-who">${escapeHtml(voice.voice)} ${voice.failed ? "couldn't play this line" : speaking ? "is speaking" : "said"}</p>
        <p class="interrupt-voice-line">“${escapeHtml(voice.line)}”</p>
      </div>
    </div>
  `;
}

/** Mute, and "Add YouTube to distractions" for what is in front: only while the session is
 *  watching something. A break judges nothing, so these stay out of it. */
function renderOverlayWatchControls(current: CurrentSession, held: boolean, nudgesMuted: boolean): string {
  const focus = current.focus;
  const name = focus ? (focus.activity.kind === "website" ? siteNames[focus.activity.key] : appNames[focus.activity.key]) ?? focus.activity.label : "";
  const addable = Boolean(focus && focus.markable && !focus.distracting) && !held;
  const why = held
    ? "Paused: nothing is being watched."
    : !focus
      ? "Nothing in front yet."
      : focus.distracting
        ? `${name} is already a distraction.`
        : `${name} can't be a distraction on its own.`;
  return `
    <label class="overlay-mute">
      <span>Mute for 5 min</span>
      <span class="toggle-field">
        <input id="overlay-snooze" class="toggle-input" type="checkbox" ${nudgesMuted ? "checked" : ""} ${held ? "disabled" : ""} aria-label="Mute reminders for 5 minutes" />
        <span class="toggle-track" aria-hidden="true"><span class="toggle-knob"></span></span>
      </span>
    </label>
    <div class="overlay-marks">
      ${
        addable
          ? `<button class="mark-distraction" type="button" data-action="mark-distracting">Add ${escapeHtml(name)} to distractions</button>`
          : `<p class="overlay-why">${escapeHtml(why)}</p>`
      }
    </div>
  `;
}

function distractionLabel(current: CurrentSession): string {
  return current.focus?.activity.label || "This app";
}

/** The phone outranks the window in front, in the popup as in the timeline. */
const PHONE_LATCH = "phone|phone";

function distractionIdentity(current: CurrentSession): string {
  if (current.camera.phone) {
    return PHONE_LATCH;
  }
  const activity = current.focus?.activity;
  return `${activity?.kind ?? ""}|${activity?.key ?? ""}`;
}

export function distractionIsActive(): boolean {
  return distractionLatchKey !== "" && distractionDismissedFor !== distractionLatchKey;
}

function updateDistractionLatch(current: CurrentSession | null): void {
  if (!current || current.status !== "active") {
    distractionLatchKey = "";
    distractionLatchLabel = "";
    distractionLatchRule = null;
    return;
  }
  const key = distractionIdentity(current);
  if (current.camera.phone) {
    // Shown once past the strictness grace; a dismissal lasts until the phone is put down.
    if (current.camera.phone_distracted && distractionDismissedFor !== key) {
      if (distractionLatchKey !== key) {
        distractionLatchedAt = Date.now();
      }
      distractionLatchKey = key;
      distractionLatchLabel = "Your phone or watch";
    }
    return;
  }
  if (distractionLatchKey === PHONE_LATCH || distractionDismissedFor === PHONE_LATCH) {
    distractionLatchKey = "";
    distractionLatchLabel = "";
    distractionLatchRule = null;
    distractionDismissedFor = "";
  }
  const focus = current.focus;
  if (!focus) {
    return;
  }
  // A dismissal ends once anything else is in front, card or not, so this one again gets its card.
  if (distractionDismissedFor && distractionDismissedFor !== key) {
    distractionDismissedFor = "";
  }
  if (focus.interrupt) {
    if (distractionDismissedFor !== key) {
      if (distractionLatchKey !== key) {
        distractionLatchedAt = Date.now();
      }
      distractionLatchKey = key;
      distractionLatchLabel = distractionLabel(current);
      distractionLatchRule = focus.matched_rule;
    }
    return;
  }
  if (focus.state === "focused" || focus.state === "idle") {
    distractionLatchKey = "";
    distractionLatchLabel = "";
    distractionLatchRule = null;
    distractionDismissedFor = "";
  }
}

export function syncOverlayPlacement(current: CurrentSession | null): void {
  if (appView !== "overlay") {
    return;
  }
  const interrupt = distractionIsActive() || momentCardActive(current);
  const next = interrupt ? "interrupt" : "corner";
  if (next !== overlayPlacement) {
    overlayPlacement = next;
    lastOverlayFit = "";
    void invoke("set_status_window_size", {
      width: interrupt ? OVERLAY_INTERRUPT_WIDTH : OVERLAY_CORNER_WIDTH,
      height: interrupt ? 380 : 220,
      center: interrupt,
    }).catch((error) => {
      setLastError(errorText(error));
    });
  }
  overlayFrame(() => fitOverlayWindow());
}

/** Next frame, or a timer while the window is hidden: WebKit stops animation frames for a hidden
 *  window, and the status window is hidden whenever the timer is off, so a card due then would
 *  only be measured once it was already on screen at the wrong size. */
function overlayFrame(run: () => void): void {
  if (document.hidden) {
    window.setTimeout(run, 16);
  } else {
    requestAnimationFrame(run);
  }
}

function fitOverlayWindow(attempt = 0): void {
  if (appView !== "overlay") {
    return;
  }
  const shell = document.querySelector<HTMLElement>(".overlay-shell");
  if (!shell) {
    return;
  }
  const interrupt = overlayPlacement === "interrupt";
  const width = interrupt ? OVERLAY_INTERRUPT_WIDTH : OVERLAY_CORNER_WIDTH;
  // Measure only once the window has this placement's width: at another width the text
  // wraps differently and the height is wrong. Ask for the width first (the window opens at
  // its config size), then wait for it; WebKit applies a resize a few frames late.
  if (Math.round(window.innerWidth) !== width) {
    if (attempt === 0) {
      lastOverlayFit = "";
      void invoke("set_status_window_size", {
        width,
        height: Math.ceil(shell.getBoundingClientRect().height),
        center: interrupt,
      }).catch((error) => {
        setLastError(errorText(error));
      });
    }
    if (attempt < 60) {
      overlayFrame(() => fitOverlayWindow(attempt + 1));
    }
    return;
  }
  const height = Math.ceil(shell.getBoundingClientRect().height);
  const key = `${width}x${height}`;
  if (key === lastOverlayFit) {
    return;
  }
  lastOverlayFit = key;
  void invoke("set_status_window_size", { width, height, center: interrupt }).catch((error) => {
    lastOverlayFit = "";
    setLastError(errorText(error));
  });
}

function renderOverlayProgress(current: CurrentSession): string {
  const { label, percent } = liveTimer(current);
  return `
    ${current.pomodoro ? renderRoundDots(current.pomodoro) : ""}
    <div class="overlay-progress">
      <span>${label} left</span>
      <div class="progress" aria-label="Session progress"><span style="width: ${percent}%"></span></div>
    </div>
  `;
}

export async function overlayAction(action: string, source?: HTMLElement): Promise<void> {
  if (action === "nudge-stop" || action === "nudge-replay") {
    void emit("nudge-control", action === "nudge-stop" ? "stop" : "replay");
    return;
  }

  if (action === "dismiss-moment") {
    momentDismissed = momentKey;
    render();
    return;
  }

  if (action === "dismiss-distraction") {
    // The card's own distraction, which may no longer be the one in front.
    const live = snapshot?.current;
    distractionDismissedFor = distractionLatchKey || (live ? distractionIdentity(live) : "");
    distractionLatchKey = "";
    distractionLatchLabel = "";
    distractionLatchRule = null;
    overlayMoreOpen = false;
    render();
    return;
  }

  if (action === "allow-session") {
    const live = snapshot?.current;
    // The card's own distraction, which may no longer be the one in front.
    const name = distractionLatchLabel || live?.focus?.activity.label || "This window";
    const rule = distractionLatchRule;
    distractionDismissedFor = distractionLatchKey || (live ? distractionIdentity(live) : "");
    distractionLatchKey = "";
    distractionLatchLabel = "";
    distractionLatchRule = null;
    overlayMoreOpen = false;
    if (await invokeSnapshot("allow_current_for_session", { rule })) {
      showFeedback(`${name} is allowed for this session`);
    }
    return;
  }

  if (action === "toggle-overlay-more") {
    overlayMoreOpen = !overlayMoreOpen;
    paintOverlayMore();
    return;
  }

  if (action === "pin-window" || action === "unpin-window") {
    const enabled = action === "pin-window";
    if (await invokeSnapshot("set_status_window_on_top", { enabled }, false)) {
      showFeedback(enabled ? "Window pinned" : "Window unpinned");
    }
    return;
  }
}

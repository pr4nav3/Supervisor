import { invoke } from "@tauri-apps/api/core";
import type { AppRule, CapturePermissions, CurrentSession, RuleTarget, SessionSnapshot } from "../core/types";
import {
  availableVoices, momentPhrases, permanentRules, renderRuleManager, renderVoiceCard, ruleName,
  selectedVoice, setRuleEditor, stopClip, voiceTone,
} from "../main";
import { appView, errorText, escapeHtml, modal } from "../core/dom";
import {
  draft, history, knownHistoryIds, setActiveTab, setHistory, setLastError, setSettings, setSnapshot,
  settings, snapshot,
} from "../core/state";
import { invokeSnapshot, paintSlot, render } from "../core/shell";
import { refreshTrends } from "./trends";

/** What the OS lets Supervisor see; null until the backend answers. */
type CaptureAccess = { platform: string; permissions: CapturePermissions; accessibility_lost: boolean };
export let captureAccess: CaptureAccess | null = null;

/**
 * The first run: a short, hands-on start built from the app's own pieces (the voice cards, the
 * distraction list and the webcam switch exactly as Settings shows them), so what is learned
 * here is what the user finds later. It opens by itself on the first launch, and from Home's
 * Getting started line until the first real session. The practice step runs a real Strict
 * session, so the card and the voice are the real ones; it is deleted the moment it is done.
 */
type FirstRunStep = "access" | "voice" | "list" | "catch" | "done";
export let firstRunOpen = false;
export function setFirstRunOpen(value: boolean): void {
  firstRunOpen = value;
}
/** Null: the first step there is (Accessibility on a Mac, once the platform is known). */
let firstRunStep: FirstRunStep | null = null;
export function setFirstRunStep(value: FirstRunStep | null): void {
  firstRunStep = value;
}
/** The practice session while it runs; `caught` once its first nudge came. */
export let practice: { id: number; caught: boolean } | null = null;
export function setPractice(value: { id: number; caught: boolean } | null): void {
  practice = value;
}
/** Practice sessions on their way out of History: they never open a report. */
export const practiceIds = new Set<number>();
/** The closing line of a practice session stays quiet; the session-end event can come late. */
export let practiceQuietUntil = 0;
export function setPracticeQuietUntil(value: number): void {
  practiceQuietUntil = value;
}
export const FIRST_RUN_KEY = "firstRun.done";
export const PRACTICE_KEY = "practice.id";

export async function refreshCaptureAccess(): Promise<void> {
  try {
    const access = await invoke<CaptureAccess>("get_capture_access");
    const changed = JSON.stringify(access) !== JSON.stringify(captureAccess);
    captureAccess = access;
    if (changed) {
      render();
    }
  } catch {
    // Without an answer the step is simply not listed.
  }
}

/** macOS reads browser addresses through Accessibility; without it every site is Other websites. */
function accessibilityMissing(): boolean {
  return captureAccess?.platform === "macos" && captureAccess.permissions.accessibility === "missing";
}

/** How to get Accessibility back. A grant macOS stopped honouring after an update still shows
 *  as allowed, and switching it off and on does nothing: the entry has to be made again. */
function accessibilityHowTo(): string {
  return captureAccess?.accessibility_lost
    ? "If Supervisor is already on in the list, macOS stopped honouring it when Supervisor was updated: remove it with the minus button, then add it again with plus. If it is off, turn it on."
    : "Turn Supervisor on in the Accessibility list.";
}

/** The start screen and the running session on a Mac without Accessibility: websites can't be
 *  caught, so a list of websites would catch nothing and the user has to know why. */
export function renderAccessNotice(short = false): string {
  if (!accessibilityMissing()) {
    return "";
  }
  const why = short
    ? "Websites aren't being caught: macOS hasn't allowed Accessibility."
    : "Supervisor can't tell one website from another until macOS allows Accessibility, so only apps on the list are caught.";
  return `
    <section class="notice notice-access">
      <span>${why} ${escapeHtml(accessibilityHowTo())}</span>
      <button class="small-button" type="button" data-action="onboard-accessibility">Open System Settings</button>
    </section>
  `;
}

/** A browser whose address bar can't be read (Vivaldi, Arc on Windows) counts as work, so a
 *  website on the list is never caught there: the user has to know why. */
export function renderUnreadableBrowserNotice(browser: string | null): string {
  if (!browser) {
    return "";
  }
  return `
    <section class="notice notice-access">
      <span>Supervisor can't read the address bar in ${escapeHtml(browser)}, so its websites count as work and nothing on your list is caught there. Chrome, Edge, Brave and Firefox can be read.</span>
    </section>
  `;
}

function firstRunSteps(): FirstRunStep[] {
  const steps: FirstRunStep[] = ["voice", "list", "catch", "done"];
  return captureAccess?.platform === "macos" ? ["access", ...steps] : steps;
}

export function currentFirstRunStep(): FirstRunStep {
  const steps = firstRunSteps();
  return firstRunStep && steps.includes(firstRunStep) ? firstRunStep : steps[0];
}

/** Home's Getting started line: until the first real session, and while a Mac still needs Accessibility. */
export function onboardingVisible(): boolean {
  return history.length === 0 || accessibilityMissing();
}

export function renderOnboardingLine(): string {
  return `
    <article class="panel onboard-card">
      <div class="onboard-head">
        <p class="eyebrow">Getting started</p>
        <button class="small-button" type="button" data-action="onboard-show">Show</button>
      </div>
    </article>
  `;
}

function openFirstRun(): void {
  firstRunOpen = true;
  firstRunStep = null;
  setRuleEditor(null);
  paintFirstRun();
}

/** Closed for good on this computer: it no longer opens by itself (Home's line still can). */
export function closeFirstRun(): void {
  firstRunOpen = false;
  firstRunStep = null;
  setRuleEditor(null);
  stopClip();
  localStorage.setItem(FIRST_RUN_KEY, "1");
  render();
}

function moveFirstRun(by: number): void {
  const steps = firstRunSteps();
  const next = steps[Math.min(steps.length - 1, Math.max(0, steps.indexOf(currentFirstRunStep()) + by))];
  firstRunStep = next;
  setRuleEditor(null);
  stopClip();
  if (next === "done") {
    localStorage.setItem(FIRST_RUN_KEY, "1");
  }
  paintFirstRun();
}

export function paintFirstRun(): void {
  paintSlot("first-run-layer", renderFirstRun());
}

/** What the practice asks the user to open: the newest website on the list (a tab is quicker to
 *  open than an app), else the newest app. A Mac without Accessibility cannot tell websites
 *  apart, so there an app comes first; a website is left only when the list has nothing else. */
function practiceRule(): AppRule | null {
  const first = (target: RuleTarget) => permanentRules.find((item) => item.target === target);
  return (accessibilityMissing() ? first("app") ?? first("website") : first("website") ?? permanentRules[0]) ?? null;
}

/** The practice target's name, as its chip shows it. */
function practiceTarget(): string | null {
  const rule = practiceRule();
  return rule ? ruleName(rule) : null;
}

/** A website target on a Mac that cannot read addresses yet: the practice would never catch it. */
function practiceNeedsAccessibility(): boolean {
  return accessibilityMissing() && practiceRule()?.target === "website";
}

function practiceVoiceName(): string | null {
  return draft.voiceId === "none" ? null : selectedVoice().name;
}

export function renderFirstRun(): string {
  if (!firstRunOpen || appView !== "main") {
    return "";
  }
  const steps = firstRunSteps();
  const step = currentFirstRunStep();
  const index = steps.indexOf(step);
  const counted = steps.length - 1;
  const titles: Record<FirstRunStep, string> = {
    access: "Let Supervisor see the address bar",
    voice: "Who should remind you?",
    list: "These count as distractions",
    catch: "Get caught once",
    done: "You're all set",
  };
  const back = index > 0 && !practice ? `<button type="button" data-action="first-run-back">Back</button>` : "<span></span>";
  return modal("first-run-panel", "first-run-title", `
        <div class="modal-head first-run-head">
          <div>
            <p class="eyebrow">Getting started${step === "done" ? "" : ` · ${index + 1} of ${counted}`}</p>
            <h2 id="first-run-title">${titles[step]}</h2>
          </div>
          ${practice || step === "done" ? "" : `<button class="small-button" type="button" data-action="first-run-skip">Skip</button>`}
        </div>
        ${renderFirstRunBody(step, back)}
      `);
}

function renderFirstRunBody(step: FirstRunStep, back: string): string {
  if (step === "access") {
    const missing = accessibilityMissing();
    return `
      <p class="first-run-copy">That's how it tells YouTube from Google Docs. Only the address is read, never the page, and nothing leaves this Mac.</p>
      <section class="panel first-run-block">
        <div class="setting-row">
          <span>Accessibility</span>
          ${missing ? `<button type="button" data-action="onboard-accessibility">Open System Settings</button>` : `<span class="first-run-ok">Allowed</span>`}
        </div>
      </section>
      <p class="first-run-where">${missing ? `${escapeHtml(accessibilityHowTo())} Then come back here. Without it, Supervisor can't tell one website from another.` : "macOS remembers this. You won't be asked again."}</p>
      <div class="first-run-actions">${back}<button class="primary" type="button" data-action="first-run-next">Next</button></div>
    `;
  }
  if (step === "voice") {
    return `
      <p class="first-run-copy">Press play to hear each voice. The one you pick speaks up when you get distracted.</p>
      <div class="voice-list first-run-voices">${availableVoices().map((voice) => renderVoiceCard(voice, false)).join("")}</div>
      <p class="first-run-where">You can change it, or record anyone's voice, in Settings › Voice.</p>
      <div class="first-run-actions">${back}<button class="primary" type="button" data-action="first-run-next">Next</button></div>
    `;
  }
  if (step === "list") {
    return `
      <section class="panel settings-rules-panel first-run-block">
        ${renderRuleManager("Distractions")}
      </section>
      <section class="panel first-run-block">
        <p class="eyebrow">Webcam</p>
        <label class="setting-row toggle-row">
          <span>Turn on webcam models</span>
          <span class="toggle-field">
            <input id="first-run-webcam" class="toggle-input" type="checkbox" ${settings.webcam_enabled ? "checked" : ""} aria-label="Turn on webcam models" />
            <span class="toggle-track" aria-hidden="true"><span class="toggle-knob"></span></span>
          </span>
        </label>
        <span class="explain">Vision models spot a phone or watch in your hand. They run only on this computer.</span>
      </section>
      <p class="first-run-where">You can change both later in Settings.</p>
      <div class="first-run-actions">${back}<button class="primary" type="button" data-action="first-run-next">Next</button></div>
    `;
  }
  if (step === "catch") {
    const target = practiceTarget();
    const voice = practiceVoiceName();
    if (!target) {
      return `
        <p class="first-run-copy">There's nothing on your distractions list to practise with. Go back and add one.</p>
        <div class="first-run-actions">${back}<span></span></div>
      `;
    }
    if (!practice) {
      return `
        <p class="first-run-copy">Press <b>Start practice</b>, then open <b>${escapeHtml(target)}</b> and leave it open. About 30 seconds later, a reminder pops up on your screen${voice ? `, and ${escapeHtml(voice)} tells you to get back to work` : ""}.</p>
        ${renderReminderPreview(target, voice)}
        ${practiceNeedsAccessibility() ? `<p class="first-run-where">Supervisor can't tell one website from another until Accessibility is allowed (step 1), so this practice can't catch ${escapeHtml(target)} yet. Go back and allow it, or add an app to the list.</p>` : ""}
        <div class="first-run-actions">${back}<button class="primary" type="button" data-action="first-run-practice">Start practice</button></div>
      `;
    }
    if (!practice.caught) {
      return `
        <p class="first-run-copy">Open <b>${escapeHtml(target)}</b> and leave it open. Supervisor notices after about 30 seconds.</p>
        ${renderPracticeLive(snapshot?.current ?? null, target)}
        <div class="first-run-actions"><span></span><button type="button" data-action="first-run-end-practice">End practice</button></div>
      `;
    }
    return `
      <p class="first-run-copy">That was the reminder. In a session it pops up whenever a distraction stays open${voice ? `, and ${escapeHtml(voice)} speaks` : ""}.</p>
      <div class="first-run-actions"><span></span><button class="primary" type="button" data-action="first-run-end-practice">Next</button></div>
    `;
  }
  return `
    <p class="first-run-copy">Start a session whenever you want to focus: press Start Focus Session on the Session tab.</p>
    <p class="first-run-where">Everything you set up is in Settings, and finished sessions show up in History.</p>
    <div class="first-run-actions"><span></span><button class="primary" type="button" data-action="first-run-close">Done</button></div>
  `;
}

/** The reminder at a third of its size, with what each of its buttons does beside it. */
function renderReminderPreview(target: string, voice: string | null): string {
  const line = voice ? momentPhrases(voiceTone(selectedVoice()), "nudge")[0]?.text ?? "" : "";
  return `
    <div class="reminder-preview">
      <div>
        <p class="reminder-preview-cap">The reminder</p>
        <div class="reminder-mini">
          <span class="reminder-mini-kicker">Distraction</span>
          <strong>You opened ${escapeHtml(target)}.</strong>
          ${voice && line ? `<span class="reminder-mini-voice"><i></i><span><small>${escapeHtml(voice)} said</small><em>${escapeHtml(line)}</em></span></span>` : ""}
          <span class="reminder-mini-buttons"><span>Allow once</span><span class="is-primary">Back to my task</span></span>
        </div>
      </div>
      <dl class="reminder-preview-keys">
        <div><dt>Back to my task</dt><dd>Closes the reminder. Open any distraction again and a reminder will reappear.</dd></div>
        <div><dt>Allow once</dt><dd>Removes this website or app from your distractions list for this session, allowing you to use it freely.</dd></div>
        <p class="reminder-preview-foot">To permanently remove something from distractions, go to Settings.</p>
      </dl>
    </div>
  `;
}

/** What Supervisor sees right now, as one row: nothing, something harmless, or the target
 *  with the seconds until the reminder. Painted in place by the poll. */
function renderPracticeLive(current: CurrentSession | null, target: string): string {
  const focus = current?.focus;
  let title = "Nothing open yet";
  let sub = "Supervisor is waiting for a window to come to the front.";
  let tag = "Watching";
  let hit = false;
  if (focus && focus.distracting) {
    hit = true;
    title = `${focus.activity.label} is open`;
    const left = focus.next_nudge_in_seconds;
    sub = left && left > 1 ? `Stay there. The reminder comes in about ${left} seconds.` : "Stay there. The reminder is on its way.";
    tag = "Counting";
  } else if (focus) {
    title = `${focus.activity.label} is open`;
    sub = `That one's fine. Switch to ${target}.`;
  }
  return `
    <div class="practice-live ${hit ? "is-hit" : ""}" id="practice-live" aria-live="polite">
      <i></i>
      <div><b>${escapeHtml(title)}</b><small>${escapeHtml(sub)}</small></div>
      <span class="practice-live-tag">${tag}</span>
    </div>
  `;
}

/** The practice's line and its catch, painted in place by the poll. */
export function paintFirstRunLive(current: CurrentSession | null): void {
  if (!practice || !current || current.id !== practice.id) {
    return;
  }
  if (!practice.caught && current.metrics.nudges > 0) {
    practice.caught = true;
    paintFirstRun();
    return;
  }
  const live = document.getElementById("practice-live");
  const target = practiceTarget();
  if (live && target) {
    live.outerHTML = renderPracticeLive(current, target);
  }
}

/** A real session on the Strict setting, so the first nudge comes in about 30 seconds. */
async function startPractice(): Promise<void> {
  const target = practiceTarget();
  if (!target || snapshot?.current) {
    return;
  }
  setRuleEditor(null);
  const started = await invokeSnapshot("start_session", {
    input: { source: "practice", goal: `Practice: open ${target}`, duration_minutes: 5, strictness: "strict", exceptions: [], pomodoro: null },
  });
  const current = snapshot?.current;
  if (!started || !current) {
    paintFirstRun();
    return;
  }
  practice = { id: current.id, caught: false };
  localStorage.setItem(PRACTICE_KEY, String(current.id));
  setActiveTab("session");
  render();
}

/** Stops the practice and removes it from History; once it caught something, on to the end. */
async function endPractice(): Promise<void> {
  const run = practice;
  if (!run) {
    return;
  }
  practice = null;
  practiceIds.add(run.id);
  practiceQuietUntil = Date.now() + 5000;
  if (run.caught) {
    firstRunStep = "done";
    localStorage.setItem(FIRST_RUN_KEY, "1");
  }
  if (snapshot?.current?.id === run.id) {
    await invokeSnapshot("stop_session", undefined, false);
  }
  await discardPractice(run.id);
}

export async function discardPractice(id: number): Promise<void> {
  practiceIds.add(id);
  knownHistoryIds.add(id);
  if (id > 0) {
    try {
      await invoke("delete_session", { id });
    } catch {
      // Already gone, or never saved.
    }
  }
  localStorage.removeItem(PRACTICE_KEY);
  try {
    setSnapshot(await invoke<SessionSnapshot>("get_session_snapshot"));
    await refreshTrends(false);
  } catch (error) {
    setLastError(errorText(error));
  }
  render();
}

export async function firstRunAction(action: string, source?: HTMLElement): Promise<void> {
  if (action === "onboard-show") {
    openFirstRun();
    return;
  }

  if (action === "first-run-next" || action === "first-run-back") {
    moveFirstRun(action === "first-run-next" ? 1 : -1);
    return;
  }

  if (action === "first-run-skip" || action === "first-run-close") {
    closeFirstRun();
    return;
  }

  if (action === "first-run-practice") {
    await startPractice();
    return;
  }

  if (action === "first-run-end-practice") {
    await endPractice();
    paintFirstRun();
    return;
  }

  if (action === "onboard-accessibility") {
    try {
      await invoke("open_accessibility_settings");
    } catch (error) {
      setLastError(errorText(error));
      render();
    }
    return;
  }
}

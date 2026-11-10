import type { AppRule, Strictness } from "../core/types";
import { attr, composing, escapeHtml, modal, showFeedback } from "../core/dom";
import { clearLastError, draft, setActiveTab, setSettingsView, settings } from "../core/state";
import { invokeSnapshot, paintSlot, render, runAction } from "../core/shell";
import { renderAccessNotice } from "./firstRun";
import { cloneRules, permanentRules, renderRuleEditor, ruleEditor, sameRule, setRuleEditor } from "./rules";
import { STRICTNESS_HELP, strictnessOptions } from "./settings";
import {
  refreshVoiceStatus, renderVoiceGapNotice, selectedVoice, setClipsVoiceId, updateSelectedVoice,
  voiceOptions,
} from "./voice";
import { animateOnArrival } from "./history";
import { allowChip } from "./session";

/** Work / break rhythms on the start screen. */
const POMODORO_RHYTHMS = [
  { work: 25, rest: 5 },
  { work: 50, rest: 10 },
  { work: 90, rest: 20 },
] as const;
export let preflightOpen = false;
export function setPreflightOpen(value: boolean): void {
  preflightOpen = value;
}
/** Distractions the user allowed for the session about to start. */
let preflightExceptions: AppRule[] = [];
let preflightBlocksOpen = false;
let preflightAdvancedOpen = false;

export function renderPreflightModal(): string {
  const ruleCount = permanentRules.length;
  const progress = (draft.duration_minutes - 15) / 75;
  return modal("preflight-panel", "preflight-title", `
        <div class="modal-head">
          <div>
            <p class="eyebrow">New session</p>
            <h2 id="preflight-title">Start a focus session</h2>
          </div>
          <button class="small-button" type="button" data-action="close-preflight">Cancel</button>
        </div>

        <div class="preflight-main">
          <label class="preflight-goal">
            <span>What are you working on?</span>
            <input id="preflight-goal" maxlength="120" value="${attr(draft.goal)}" placeholder="Finish the Supervisor UI overhaul" />
          </label>

          <div class="mode-tabs" role="group" aria-label="Session kind">
            <button class="${draft.mode === "timer" ? "active" : ""}" type="button" data-action="session-mode" data-mode="timer" aria-pressed="${draft.mode === "timer"}">Timer</button>
            <button class="${draft.mode === "pomodoro" ? "active" : ""}" type="button" data-action="session-mode" data-mode="pomodoro" aria-pressed="${draft.mode === "pomodoro"}">Pomodoro</button>
          </div>

          ${draft.mode === "pomodoro" ? renderPomodoroField() : `
          <section class="duration-field">
            <div class="duration-head">
              <span>How long?</span>
              <output id="preflight-duration-output" for="preflight-duration">${draft.duration_minutes} min</output>
            </div>
            <input id="preflight-duration" type="range" min="15" max="90" step="5" value="${draft.duration_minutes}" style="--range-p: ${progress}" />
            <div class="duration-ticks" aria-hidden="true">
              ${[15, 30, 60, 90].map((minutes) => `<span style="--p: ${(minutes - 15) / 75}">${minutes}</span>`).join("")}
            </div>
          </section>`}

          ${renderAccessNotice()}

          <details class="preflight-disclosure" data-preflight-section="blocks" ${preflightBlocksOpen ? "open" : ""}>
            <summary>
              <span>Distractions</span>
              <span>${ruleCount} on the list${preflightExceptions.length ? ` · ${preflightExceptions.length} allowed once` : ""}</span>
            </summary>
            <div class="disclosure-body">
              ${renderPreflightDistractions()}
            </div>
          </details>

          <details class="preflight-disclosure" data-preflight-section="advanced" ${preflightAdvancedOpen ? "open" : ""}>
            <summary>
              <span>Advanced settings</span>
            </summary>
            <div class="disclosure-body preflight-advanced">
              <label>
                <span>Strictness</span>
                <select id="preflight-strictness">${strictnessOptions(draft.strictness)}</select>
                <small class="field-help">${STRICTNESS_HELP}</small>
              </label>
              <label>
                <span>Voice</span>
                <select id="preflight-voice">${voiceOptions(draft.voiceId)}</select>
              </label>
            </div>
          </details>
        </div>

        ${renderVoiceGapNotice(selectedVoice(), "start")}
        <button class="primary preflight-start" type="button" data-action="confirm-start-session">Start focus session</button>
      `);
}

/** Work / break chips on the left, rounds on the right, the finish time under them. */
function renderPomodoroField(): string {
  const rhythm = POMODORO_RHYTHMS[draft.rhythm];
  const minutes = draft.rounds * rhythm.work + (draft.rounds - 1) * rhythm.rest;
  const done = new Date(Date.now() + minutes * 60_000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `
    <section class="duration-field pomodoro-field">
      <div class="duration-head"><span>Work / break</span><span>Rounds</span></div>
      <div class="pomodoro-row">
        <div class="pomodoro-rhythms" role="group" aria-label="Work and break minutes">
          ${POMODORO_RHYTHMS.map(
            (item, index) =>
              `<button class="${index === draft.rhythm ? "active" : ""}" type="button" data-action="pomodoro-rhythm" data-index="${index}" aria-pressed="${index === draft.rhythm}">${item.work} / ${item.rest}</button>`,
          ).join("")}
        </div>
        <span class="pomodoro-rounds">
          <button type="button" data-action="pomodoro-rounds" data-step="-1" aria-label="One round fewer" ${draft.rounds <= 1 ? "disabled" : ""}>−</button>
          <b>${draft.rounds}</b>
          <button type="button" data-action="pomodoro-rounds" data-step="1" aria-label="One round more" ${draft.rounds >= 8 ? "disabled" : ""}>+</button>
        </span>
      </div>
      <p class="pomodoro-done">Done around ${escapeHtml(done)}</p>
    </section>
  `;
}

/** Before a session: tap a distraction to allow it today; "+ Add" adds one for good. */
function renderPreflightDistractions(): string {
  const chips = permanentRules
    .slice()
    .reverse()
    .map((rule, index) => allowChip(rule, index, preflightExceptions.some((exception) => sameRule(exception, rule)), "toggle-exception"))
    .join("");
  return `
    <div class="rule-manager preflight-rule-manager">
      <p class="explain">Click one to allow it once, for this session. Everything else counts as work.</p>
      ${ruleEditor ? renderRuleEditor(ruleEditor) : ""}
      <div class="rule-group">
        <div class="rule-chip-list">
          ${chips || `<span class="no-session-rules">None yet.</span>`}
          <button class="add-target-button" type="button" data-rule-action="add">+ Add</button>
        </div>
      </div>
    </div>
  `;
}

/** The preflight's own controls, inside `root`: the whole document after a rebuild, or just the layer. */
export function bindPreflight(root: ParentNode): void {
  root.querySelector<HTMLTextAreaElement>("#preflight-goal")?.addEventListener("input", (event) => {
    draft.goal = (event.target as HTMLTextAreaElement).value;
  });
  root.querySelector<HTMLInputElement>("#preflight-goal")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !composing(event)) {
      event.preventDefault();
      startSource = "Enter";
      void runAction("confirm-start-session");
    }
  });

  root.querySelectorAll<HTMLDetailsElement>("[data-preflight-section]").forEach((details) => {
    details.addEventListener("toggle", () => {
      if (details.dataset.preflightSection === "blocks") {
        preflightBlocksOpen = details.open;
      } else {
        preflightAdvancedOpen = details.open;
      }
    });
  });

  root.querySelector<HTMLInputElement>("#preflight-duration")?.addEventListener("input", (event) => {
    const slider = event.target as HTMLInputElement;
    draft.duration_minutes = Number(slider.value || 25);
    slider.style.setProperty("--range-p", String((draft.duration_minutes - 15) / 75));
    const output = root.querySelector("#preflight-duration-output");
    if (output) {
      output.textContent = `${draft.duration_minutes} min`;
    }
  });

  root.querySelector<HTMLSelectElement>("#preflight-strictness")?.addEventListener("change", (event) => {
    draft.strictness = (event.target as HTMLSelectElement).value as Strictness;
  });

  root.querySelector<HTMLSelectElement>("#preflight-voice")?.addEventListener("change", (event) => {
    draft.voiceId = (event.target as HTMLSelectElement).value;
    void updateSelectedVoice(draft.voiceId);
  });
}

export function paintPreflightLayer(): void {
  // The name field takes focus when the start screen opens, not on every rebuild after a click.
  const opening = !document.querySelector("#preflight-layer #preflight-goal");
  const layer = paintSlot("preflight-layer", preflightOpen ? renderPreflightModal() : "");
  if (layer && preflightOpen && opening) {
    layer.querySelector<HTMLTextAreaElement>("#preflight-goal")?.focus();
  }
}

/** How the next start was asked for; the backend keeps it as the session's first event. */
let startSource = "start screen";

async function startSession(source: string): Promise<boolean> {
  return invokeSnapshot("start_session", {
    input: {
      source,
      goal: draft.goal,
      duration_minutes: draft.duration_minutes,
      strictness: draft.strictness,
      exceptions: cloneRules(preflightExceptions),
      pomodoro:
        draft.mode === "pomodoro"
          ? {
              work_minutes: POMODORO_RHYTHMS[draft.rhythm].work,
              break_minutes: POMODORO_RHYTHMS[draft.rhythm].rest,
              rounds: draft.rounds,
            }
          : null,
    },
  });
}

export async function preflightAction(action: string, source?: HTMLElement): Promise<void> {
  if (action === "session-mode" || action === "pomodoro-rhythm" || action === "pomodoro-rounds") {
    if (action === "session-mode") {
      draft.mode = source?.dataset.mode === "pomodoro" ? "pomodoro" : "timer";
    } else if (action === "pomodoro-rhythm") {
      draft.rhythm = Math.min(POMODORO_RHYTHMS.length - 1, Math.max(0, Number(source?.dataset.index ?? 0)));
    } else {
      draft.rounds = Math.min(8, Math.max(1, draft.rounds + Number(source?.dataset.step ?? 0)));
    }
    paintPreflightLayer();
    return;
  }

  if (action === "toggle-exception") {
    const rule = permanentRules.slice().reverse()[Number(source?.dataset.ruleIndex)];
    if (rule) {
      preflightExceptions = preflightExceptions.some((exception) => sameRule(exception, rule))
        ? preflightExceptions.filter((exception) => !sameRule(exception, rule))
        : [...preflightExceptions, { ...rule }];
      paintPreflightLayer();
    }
    return;
  }

  if (action === "open-preflight") {
    preflightExceptions = [];
    // A strictness picked here is for that one session; each start screen begins at the default.
    draft.strictness = settings.default_strictness;
    draft.duration_minutes = Math.min(90, Math.max(15, draft.duration_minutes));
    preflightBlocksOpen = false;
    preflightAdvancedOpen = false;
    preflightOpen = true;
    setRuleEditor(null);
    paintPreflightLayer();
    return;
  }

  // Cancel goes back to the session screen, so the calendar pops in again, as on Escape.
  if (action === "close-preflight") {
    clearLastError();
    preflightOpen = false;
    setRuleEditor(null);
    animateOnArrival("session");
    render();
    return;
  }

  if (action === "confirm-start-session") {
    if (!draft.goal.trim()) {
      showFeedback("Name the session");
      return;
    }
    preflightOpen = false;
    setRuleEditor(null);
    const source = startSource;
    startSource = "start screen";
    if (!(await startSession(source))) {
      preflightOpen = true;
      render();
    }
    return;
  }

  if (action === "open-voice-from-start") {
    preflightOpen = false;
    setClipsVoiceId(draft.voiceId);
    setActiveTab("settings");
    setSettingsView("voice");
    await refreshVoiceStatus(false);
    render();
    return;
  }
}

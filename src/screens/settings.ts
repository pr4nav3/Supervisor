import { invoke } from "@tauri-apps/api/core";
import type { SessionSettings, Strictness } from "../core/types";
import {
  dismissVoiceInfo, leaveVoiceScreen, quietVoice, quietVoiceText, refreshVoiceStatus,
  renderVoiceSettings, selectedVoice, setPhraseEditor, toneLabel, voiceBackend, voiceTone,
} from "../main";
import { errorText, escapeHtml, label, showFeedback } from "../core/dom";
import {
  draft, lastError, setLastError, setSettings, setSettingsView, settings, settingsView, theme,
} from "../core/state";
import { invokeSnapshot, render } from "../core/shell";
import { renderWebcamSettings, stopWebcamPreview } from "./webcam";
import { renderRuleManager } from "./rules";

/** Report a problem: the form, with the details a report needs already in its last box.
 *  Everything in it is on screen in the browser before anything is sent. */
const PROBLEM_FORM = "https://docs.google.com/forms/d/e/1FAIpQLSdFLtxXlAqQrppIOcciOPrVoa8T7u0MYt-1i2qRd9feXOybVA/viewform";
const PROBLEM_FORM_DETAILS_FIELD = "entry.320512626";

async function openProblemForm(): Promise<void> {
  const version = await invoke<string>("app_version").catch(() => "?");
  const system = await invoke<string>("system_line").catch(() => "?");
  const voice = selectedVoice();
  const details = [
    `Supervisor ${version}`,
    `System: ${system}`,
    `Voice: ${voice.id === "none" ? "none" : `${voice.name}, ${toneLabel(voiceTone(voice))}`}`,
    `Voice engine: ${voiceBackend ? (voiceBackend.runtime.installed && voiceBackend.model.installed ? "installed" : "not installed") : "not checked"}`,
    `Webcam: ${settings.webcam_enabled ? "on" : "off"}`,
    `Theme: ${theme}`,
    `Last error shown: ${lastError || "none"}`,
  ].join("\n");
  const url = `${PROBLEM_FORM}?usp=pp_url&${PROBLEM_FORM_DETAILS_FIELD}=${encodeURIComponent(details)}`;
  try {
    await invoke("open_problem_form", { url });
  } catch (error) {
    setLastError(errorText(error));
    render();
  }
}

export function renderSettings(): string {
  if (settingsView === "voice") {
    return renderVoiceSettings();
  }
  if (settingsView === "webcam") {
    return renderWebcamSettings();
  }

  return `
    <section class="settings-page">
      <section class="panel defaults-card">
        <p class="eyebrow">Defaults</p>
        <div class="defaults-grid">
          <label class="default-control">
            <strong>Strictness</strong>
            <select id="default-strictness">
              ${strictnessOptions(settings.default_strictness)}
            </select>
          </label>
          <label class="default-control">
            <strong>Show session timer</strong>
            <span class="toggle-field">
              <input id="status-window-enabled" class="toggle-input" type="checkbox" ${settings.status_window_enabled ? "checked" : ""} aria-label="Show session timer" />
              <span class="toggle-track" aria-hidden="true"><span class="toggle-knob"></span></span>
            </span>
          </label>
        </div>
        <small class="field-help defaults-help">Strictness is ${STRICTNESS_HELP.charAt(0).toLowerCase()}${STRICTNESS_HELP.slice(1)}</small>
        <small class="field-help">The session timer is the small window in the top right corner while a session runs.</small>
      </section>

      <div class="settings-feature-grid">
        <section class="panel settings-feature-card voice-summary-panel">
          <p class="eyebrow">Voice</p>
          <div class="voice-summary">
            <strong>${escapeHtml(selectedVoice().name)}</strong>
            <span class="explain">Record anyone's voice. It speaks up when you get distracted.</span>
            ${quietVoice() ? `<span class="explain is-bad">${escapeHtml(quietVoiceText(quietVoice()!))}</span>` : ""}
            <button type="button" data-action="open-voice-settings">Customize</button>
          </div>
        </section>

        <section class="panel settings-feature-card">
          <p class="eyebrow">Webcam</p>
          <div class="voice-summary">
            <strong>Live camera check</strong>
            <span class="explain">Vision models spot a phone or watch in your hand. They run only on this computer.</span>
            <button type="button" data-action="open-webcam-settings">Open</button>
          </div>
        </section>
      </div>

      <section class="panel settings-rules-panel">
        ${renderRuleManager("Distractions")}
      </section>

      <section class="panel settings-data-panel">
        <div class="settings-data-row">
          <span class="explain">Sessions and history stay on this computer. Nothing is uploaded.</span>
          <button class="danger" type="button" data-action="ask-delete-all">Delete all history</button>
        </div>
        <div class="settings-data-row">
          <span class="explain">Something broke? Tell us. The form opens in your browser with the app's details filled in.</span>
          <button type="button" data-action="report-problem">Report a problem</button>
        </div>
      </section>
    </section>
  `;
}

export async function updateDefaultStrictness(default_strictness: Strictness): Promise<void> {
  try {
    setSettings(await invoke<SessionSettings>("update_settings", {
      update: { default_strictness },
    }));
    draft.strictness = default_strictness;
    setLastError("");
  } catch (error) {
    setLastError(errorText(error));
  }
  render();
}

export async function updateStatusWindowEnabled(enabled: boolean): Promise<void> {
  if (await invokeSnapshot("set_status_window_enabled", { enabled }, false)) {
    showFeedback(enabled ? "Session timer shown" : "Session timer hidden");
  }
}

/** Mirrors `Strictness::focus_config` in the backend: the seconds a distraction may stay open
 * before Supervisor speaks up. */
export const STRICTNESS_HELP = "How long a distraction can stay open before a reminder.";
const STRICTNESS_SECONDS: Record<Strictness, number> = { gentle: 90, normal: 60, strict: 30 };

export function strictnessOptions(selected: Strictness): string {
  return (["gentle", "normal", "strict"] as Strictness[])
    .map((value) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label(value)} · ${STRICTNESS_SECONDS[value]} s</option>`)
    .join("");
}

export async function settingsAction(action: string, source?: HTMLElement): Promise<void> {
  if (action === "report-problem") {
    await openProblemForm();
    return;
  }

  if (action === "open-voice-settings") {
    setSettingsView("voice");
    await refreshVoiceStatus(false);
    render();
    return;
  }

  if (action === "back-settings") {
    const leavingWebcam = settingsView === "webcam";
    const leavingVoice = settingsView === "voice";
    setSettingsView("home");
    setPhraseEditor(null);
    dismissVoiceInfo();
    if (leavingVoice) {
      leaveVoiceScreen();
    }
    render();
    if (leavingWebcam) {
      await stopWebcamPreview();
    }
    return;
  }
}

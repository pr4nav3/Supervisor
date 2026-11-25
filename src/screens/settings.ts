import { invoke } from "@tauri-apps/api/core";
import type { SessionSettings, Strictness } from "../core/types";
import { errorText, escapeHtml, label, showFeedback, toggle } from "../core/dom";
import {
  draft, lastError, setLastError, setSettings, setSettingsView, settings, settingsView, theme,
} from "../core/state";
import { invokeSnapshot, render } from "../core/shell";
import { renderWebcamSettings, stopWebcamPreview } from "./webcam";
import { renderRuleManager } from "./rules";
import { leaveVoiceScreen, setPhraseEditor, toneLabel } from "./lines";
import {
  dismissVoiceInfo, quietVoice, quietVoiceText, refreshVoiceStatus, renderVoiceSettings,
  selectedVoice, voiceBackend, voiceTone,
} from "./voice";

/** Report a problem: the form, with the details a report needs already in its last box.
 *  Everything in it is on screen in the browser before anything is sent. */
const PROBLEM_FORM = "https://docs.google.com/forms/d/e/1FAIpQLSdFLtxXlAqQrppIOcciOPrVoa8T7u0MYt-1i2qRd9feXOybVA/viewform";
const PROBLEM_FORM_DETAILS_FIELD = "entry.320512626";

/** Supervisor's own update: this copy's version, and a newer one once a check finds it. */
let appVersion = "";
let newVersion: string | null = null;
let updateStep: "" | "checking" | "current" | "installing" = "";
void invoke<string>("app_version").then((version) => (appVersion = version), () => null);

/** The daily check found `version`. */
export function offerAppUpdate(version: string): void {
  newVersion = version;
  showFeedback(`Supervisor ${version} is out. Update it in Settings.`, 6000);
  render();
}

function renderAppUpdateCard(): string {
  const busy = updateStep === "checking" || updateStep === "installing";
  const text =
    updateStep === "installing" ? `Downloading ${newVersion}. Supervisor restarts when it's done.`
    : newVersion ? `Version ${newVersion} is out.`
    : updateStep === "current" ? "This is the newest version."
    : "Checks once a day. Installs only once you say so.";
  const button = newVersion
    ? `<button class="primary" type="button" data-action="install-app-update" ${busy ? "disabled" : ""}>${updateStep === "installing" ? "Updating…" : "Update and restart"}</button>`
    : `<button type="button" data-action="check-app-update" ${busy ? "disabled" : ""}>${updateStep === "checking" ? "Checking…" : "Check for updates"}</button>`;
  return `
        <section class="panel settings-feature-card">
          <p class="eyebrow">Updates</p>
          <div class="voice-summary">
            <strong>Supervisor ${escapeHtml(appVersion)}</strong>
            <span class="explain">${escapeHtml(text)}</span>
            ${button}
          </div>
        </section>`;
}

async function runAppUpdate(action: "check-app-update" | "install-app-update"): Promise<void> {
  updateStep = action === "check-app-update" ? "checking" : "installing";
  render();
  try {
    if (action === "check-app-update") {
      newVersion = await invoke<string | null>("check_app_update");
      updateStep = newVersion ? "" : "current";
    } else {
      await invoke("install_app_update"); // restarts the app when it works
    }
    setLastError("");
  } catch (error) {
    updateStep = "";
    setLastError(errorText(error));
  }
  render();
}

async function openProblemForm(): Promise<void> {
  const version = await invoke<string>("app_version").catch(() => "?");
  const system = await invoke<string>("system_line").catch(() => "?");
  const voice = selectedVoice();
  // Nothing personal goes in the form: the voice's kind, not a recorded person's name, and an
  // error without its file paths (a path can carry the user's name).
  const details = [
    `Supervisor ${version}`,
    `System: ${system}`,
    `Voice: ${voice.source === "none" ? "none" : `${voice.source === "starter" ? "starter voice" : "recorded voice"}, ${toneLabel(voiceTone(voice))}`}`,
    `Voice engine: ${voiceBackend ? (voiceBackend.runtime.installed && voiceBackend.model.installed ? "installed" : "not installed") : "not checked"}`,
    `Webcam: ${settings.webcam_enabled ? "on" : "off"}`,
    `Theme: ${theme}`,
    `Last error shown: ${lastError.replace(/[A-Za-z]:\\\S+|\/Users\/\S+/g, "<path>") || "none"}`,
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
            ${toggle("status-window-enabled", settings.status_window_enabled, "Show session timer")}
          </label>
          <small class="field-help">Strictness is ${STRICTNESS_HELP.charAt(0).toLowerCase()}${STRICTNESS_HELP.slice(1)}</small>
          <small class="field-help">The session timer is the small window in the top right corner while a session runs.</small>
        </div>
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
            <span class="explain">Vision models spot a phone in view. They run only on this computer.</span>
            <button type="button" data-action="open-webcam-settings">Open</button>
          </div>
        </section>
      </div>

      <section class="panel settings-rules-panel">
        ${renderRuleManager("Distractions")}
      </section>

      <div class="settings-feature-grid settings-about-grid">
        <section class="panel settings-feature-card">
          <p class="eyebrow">Your data</p>
          <div class="voice-summary">
            <strong>Stays on this computer</strong>
            <span class="explain">Sessions and history are never uploaded.</span>
            <button class="danger" type="button" data-action="ask-delete-all">Delete all history</button>
          </div>
        </section>
        <section class="panel settings-feature-card">
          <p class="eyebrow">Something broke?</p>
          <div class="voice-summary">
            <strong>Tell us</strong>
            <span class="explain">A form opens in your browser with the app's details filled in. The app's log is log.txt in its data folder.</span>
            <button type="button" data-action="report-problem">Report a problem</button>
          </div>
        </section>${renderAppUpdateCard()}
      </div>
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
 * before Supervisor speaks up, and the shorter wait (`distracted_after_seconds`) a phone gets. */
export const STRICTNESS_HELP = "How long a distraction can stay open before a reminder; a phone in view gets one sooner, after 15, 8 or 5 s.";
const STRICTNESS_SECONDS: Record<Strictness, number> = { gentle: 90, normal: 60, strict: 30 };

export function strictnessOptions(selected: Strictness): string {
  return (["gentle", "normal", "strict"] as Strictness[])
    .map((value) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label(value)} · ${STRICTNESS_SECONDS[value]} s</option>`)
    .join("");
}

export async function settingsAction(action: string): Promise<void> {
  if (action === "report-problem") {
    await openProblemForm();
    return;
  }

  if (action === "check-app-update" || action === "install-app-update") {
    await runAppUpdate(action);
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

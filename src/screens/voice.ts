import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import type {
  NudgeVoice, PhraseDefinition, PhraseMoment, RecordedVoice, RecordingState, SessionSettings,
  VoiceBackendStatus, VoiceBusy, VoiceClipSummary, VoiceDownloadSnapshot, VoiceModelStatus,
  VoiceOption, VoiceProfileSummary, VoiceRecordingSnapshot, VoiceSource, VoiceTone,
} from "../core/types";
import { formatBytes, formatDuration } from "../core/format";
import { paintModalLayer, sessionOver } from "../main";
import {
  afterPointer, appView, attr, confirmModal, errorText, escapeHtml, modal, showFeedback,
} from "../core/dom";
import { playVolume } from "../core/audio";
import { activeTab, draft, setSettings, settingsView, theme } from "../core/state";
import { paintSlot, render } from "../core/shell";
import {
  clearFailedQueue, clipQueue, closeToneForms, effectivePhrases, FIRST_CLIP_SECONDS, MOMENTS,
  NEXT_CLIP_SECONDS, phraseEditor, phraseToneOrder, renderLinePopup, renderNewPersonalityModal,
  renderVoiceLinesArea, toneLabel, toneOrder,
} from "./lines";

const noneVoice: VoiceOption = {
  id: "none",
  name: "No voice",
  ready: 0,
  total: 0,
  source: "none",
  selectable: true,
  profile: null,
};

export const STARTER_PROFILE_IDS = ["derek", "elise"] as const;

/** Each starter voice says hello in its own words. The audio sits next to its lines; the text
 *  shows on the card while it plays, so the line can be read as well as heard. */
const STARTER_INTROS: Record<string, string> = {
  derek: "Hey, I'm Derek. Good to meet you.",
  elise: "Hi, I'm Elise. Nice to meet you.",
};

function starterVoiceOptions(): VoiceOption[] {
  return [
    starterVoiceCard("starter-male", "derek", "Derek"),
    starterVoiceCard("starter-female", "elise", "Elise"),
  ];
}

function starterVoiceCard(id: string, profileId: string, name: string): VoiceOption {
  const profile = profileById(profileId);
  return {
    id,
    name: profile?.display_name || name,
    ...ownLineCount(profile),
    source: "starter",
    selectable: profile ? profileToneReady(profile) : true,
    profile,
  };
}
let clipsVoiceId = "starter-female";
export function setClipsVoiceId(value: string): void {
  clipsVoiceId = value;
}
let clipsVoiceTouched = false;
/** A recorded voice clicked before it had its lines: picked for the user once they are made. */
export let pickWhenReady: string | null = null;
export function setPickWhenReady(value: string | null): void {
  pickWhenReady = value;
}
const clipAssetRevision = new Map<string, number>();
/** The voice page's info popup, named as its open- and close- actions name it. */
export let voiceDialog: "voice-help" | "model-info" | "memory-info" | null = null;
export function setVoiceDialog(value: "voice-help" | "model-info" | "memory-info" | null): void {
  voiceDialog = value;
}
export let modelDeleteOpen = false;
export function setModelDeleteOpen(value: boolean): void {
  modelDeleteOpen = value;
}
export let voiceBackend: VoiceBackendStatus | null = null;
export let voiceDownload: VoiceDownloadSnapshot | null = null;
export let voiceBusy: VoiceBusy = null;
export let voiceDeleteTargetId: string | null = null;
export function setVoiceDeleteTargetId(value: string | null): void {
  voiceDeleteTargetId = value;
}
export let voiceInfoId: string | null = null;
let voicePreviewAudio: HTMLAudioElement | null = null;
const waveformPeaks = new Map<string, number[]>();
const waveformPending = new Map<string, Promise<AudioBuffer>>();
let waveformContext: AudioContext | null = null;
let voicePreviewPath = "";
let previewWaveRaf = 0;
let previewBarDragging = false;
export let recordingOpen = false;
let recordingState: RecordingState = "idle";
let recordingError = "";
export let recordedVoice: RecordedVoice | null = null;
let recordingTickId: number | undefined;
let recordingStartedAtMs: number | null = null;
export let voiceError = "";
export function setVoiceError(value: string): void {
  voiceError = value;
}
let downloadPollId: number | undefined;
export let nudgeAudio: HTMLAudioElement | null = null;
/** The voice and line of the nudge playing or last played (main window). */
export let lastNudgeVoice: Omit<NudgeVoice, "speaking"> | null = null;

function voiceLayoutKey(status: VoiceBackendStatus | null): string {
  if (!status) {
    return "";
  }
  return [
    status.system.has_enough_ram ? 1 : 0,
    status.model.installed ? 1 : 0,
    status.runtime.installed ? 1 : 0,
    status.profiles.map((profile) => `${profile.profile_id}:${profile.clips.length}`).join(","),
  ].join("|");
}

export async function refreshVoiceStatus(shouldRender = true): Promise<void> {
  const before = voiceLayoutKey(voiceBackend);
  try {
    voiceBackend = await invoke<VoiceBackendStatus>("get_voice_backend_status");
    voiceError = "";
    ensureSelectedVoice();
  } catch (error) {
    voiceError = errorText(error);
  }

  if (!shouldRender) {
    return;
  }
  if (voiceLayoutKey(voiceBackend) !== before) {
    render();
    return;
  }
  paintVoiceRam();
}

export async function refreshVoiceDownload(shouldRender = true): Promise<void> {
  try {
    const download = await invoke<VoiceDownloadSnapshot>("get_voice_model_download");
    applyDownloadSnapshot(download);
    // A check found running here is the daily one in the background (one the user started
    // keeps its popup open): only a real fetch is worth showing.
    if (download.phase === "downloading" || download.phase === "cancelling") {
      voiceBusy = "download-model";
      startDownloadPolling();
    } else if (download.phase === "error" && !voiceError) {
      // A download that failed before this page loaded; the modal is gone, so the notice says it.
      voiceError = download.message;
    }
  } catch {
    voiceDownload = null;
  }

  if (shouldRender) {
    render();
  }
}

export function renderVoiceSettings(): string {
  const voices = availableVoices();
  const creating = voiceBusy !== null || ["checking", "downloading", "cancelling"].includes(voiceDownload?.phase ?? "");
  return `
    <section class="voice-page">
      <div class="subpage-head voice-head">
        <button type="button" data-action="back-settings">Back</button>
        <div>
          <p class="eyebrow">VOICE SETTINGS</p>
          <h2>Voices</h2>
        </div>
        <button class="voice-help-button" type="button" data-action="open-voice-help" aria-label="How voice cloning works" aria-haspopup="dialog" title="How voice cloning works">?</button>
      </div>

      <section class="voice-grid">
        <section class="panel voice-roster-panel">
          <div class="rule-toolbar">
            <p class="eyebrow">Voices</p>
            <button class="new-voice-button" type="button" data-action="record-voice" ${creating ? "disabled" : ""}>+ New voice</button>
          </div>
          <div class="voice-list">
            ${voices.map((voice) => renderVoiceCard(voice)).join("")}
          </div>
        </section>

        ${renderVoiceTiles()}
        <div class="slot" id="voice-lines">${renderVoiceLinesArea()}</div>
      </section>
    </section>
  `;
}

export function fitVoiceCardNames(): void {
  document.querySelectorAll<HTMLElement>(".voice-card").forEach((card) => {
    const name = card.querySelector("strong");
    if (!name) {
      return;
    }
    card.style.width = "";
    const extra = name.scrollWidth - name.clientWidth;
    if (extra > 0) {
      card.style.width = `${Math.min(720, card.offsetWidth + extra + 8)}px`;
    }
  });
}

/** `editable`: the ⋯ that opens the voice's settings, which live on the Voice page only. */
export function renderVoiceCard(voice: VoiceOption, editable = true): string {
  const selected = draft.voiceId === voice.id;
  const profile = voice.profile;
  const needsGeneration = voice.source === "custom" && Boolean(profile?.reference_path) && !voice.selectable;
  // The selected card still presses like the others; clicking it again changes nothing.
  const pickable = voiceBusy === null && (selected || needsGeneration || voice.selectable);
  const action = needsGeneration ? "set-up-clips" : "select-voice";
  const label = needsGeneration ? `Generate ${voice.name}'s lines` : selected ? `${voice.name}, selected` : `Select ${voice.name}`;
  const card = `class="voice-card ${selected ? "selected" : ""} ${pickable ? "is-pickable" : ""}" role="button" tabindex="0" data-action="${action}" data-voice-id="${attr(voice.id)}" aria-pressed="${selected}" aria-disabled="${!pickable}" aria-label="${attr(label)}"`;
  if (voice.source === "none") {
    return `
      <article ${card}>
        <strong>${escapeHtml(voice.name)}</strong>
        <span class="voice-card-quiet">Stays quiet</span>
      </article>
    `;
  }
  const preview = previewPathForVoice(voice);
  const line = voice.source === "starter" ? STARTER_INTROS[voice.profile?.profile_id ?? ""] ?? "" : "";
  return `
    <article ${card}>
      <div class="voice-card-top">
        <strong>${escapeHtml(voice.name)}</strong>
        ${voice.source === "starter" ? `<span class="voice-card-tag">Starter</span>` : ""}
      </div>
      <span class="voice-card-speaks">speaks like <b>${escapeHtml(toneLabel(voiceTone(voice)))}</b></span>
      ${voiceCardNote(voice)}
      <div class="voice-card-foot">
        <button class="voice-play" type="button" data-action="play-clip" data-clip-path="${attr(preview ?? "")}" ${preview ? "" : "disabled"} aria-label="Play ${attr(voice.name)}'s recording">
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.2v9.6L11 6z" fill="currentColor"/></svg>${MINI_ORB}
        </button>
        ${line ? `<span class="voice-card-line" aria-live="polite">${escapeHtml(line)}</span>` : ""}
        ${editable ? `<button class="voice-card-more" type="button" data-action="voice-info" data-voice-id="${attr(voice.id)}" aria-label="Edit ${attr(voice.name)}" aria-haspopup="dialog">⋯</button>` : ""}
      </div>
    </article>
  `;
}
/** A voice popup opening or closing repaints only the dialog layer; the page under it stays put. */
export function paintVoiceLayer(): void {
  paintSlot("voice-layer", renderVoiceDialogs());
}

/** Model and memory, the two things that can stop a clip being made. Each tile opens its numbers. */
function renderVoiceTiles(): string {
  const busyDownload = ["checking", "downloading", "cancelling"].includes(voiceDownload?.phase ?? "");
  const modelOk = modelInstalled() || busyDownload;
  const modelValue = busyDownload ? "Updating…" : modelInstalled() ? "Installed" : voiceError && !voiceBackend ? "Couldn't check" : "Not installed";
  return `
    <div class="voice-tiles">
      <div class="voice-tile ${modelOk ? "" : "is-bad"}">
        <span class="voice-tile-dot" aria-hidden="true"></span>
        <div><p class="eyebrow">Voice engine</p><strong>${escapeHtml(modelValue)}</strong></div>
        <button type="button" data-action="open-model-info" aria-label="Voice engine details" aria-haspopup="dialog">›</button>
      </div>
      <div class="voice-tile ${ramGenerationLocked() ? "is-bad" : ""}" data-memory-tile>
        <span class="voice-tile-dot" aria-hidden="true"></span>
        <div><p class="eyebrow">Memory</p><strong data-memory-value>${escapeHtml(memoryTileValue())}</strong></div>
        <button type="button" data-action="open-memory-info" aria-label="Memory details" aria-haspopup="dialog">›</button>
      </div>
    </div>
  `;
}

function memoryTileValue(): string {
  const system = voiceBackend?.system;
  const free = system?.available_ram_bytes ?? null;
  const need = system?.min_free_ram_bytes ?? 0;
  if (free === null) {
    return "Unknown";
  }
  return ramGenerationLocked() ? `${formatBytes(free)} free, needs ${formatBytes(need)}` : `${formatBytes(free)} free`;
}
function renderVoiceHelpModal(): string {
  return modal("voice-popup", "voice-help-title", `
        <div class="voice-info-head">
          <div>
            <p class="eyebrow">Voices</p>
            <h2 id="voice-help-title">How voice cloning works</h2>
          </div>
          <button class="small-button" type="button" data-action="close-voice-help">Close</button>
        </div>
        <p>Supervisor reminds you with short spoken lines. Record anyone for about twenty seconds, generate their lines once, and from then on they play instantly, offline.</p>
        <ol class="voice-help-steps">
          <li><strong>Record a voice.</strong> Press + New voice and read the prompt aloud. The starter voices come ready.</li>
          <li><strong>Pick a personality.</strong> It's what the voice says, from Gentle to Stern, or one you write. Each has lines for when you get distracted, when your phone or watch shows up, and when a round or session ends.</li>
          <li><strong>Generate its lines.</strong> Press Generate under the lines. The first takes about ${FIRST_CLIP_SECONDS} seconds while the voice engine warms up, the rest about ${NEXT_CLIP_SECONDS} seconds each. It needs the voice engine installed and some free memory.</li>
          <li><strong>Select it.</strong> Once its back to work lines are generated, select the voice under Voices.</li>
        </ol>
        <p class="quiet">Listen to each line. If one sounds off, press Edit and regenerate it.</p>
      `);
}

function renderModelInfoModal(): string {
  const model = voiceBackend?.model;
  const installed = modelInstalled();
  const busy = voiceBusy !== null || ["checking", "downloading", "cancelling"].includes(voiceDownload?.phase ?? "");
  return modal("voice-popup", "model-info-title", `
        <div class="voice-info-head">
          <div>
            <p class="eyebrow">Voice engine</p>
            <h2 id="model-info-title">${installed ? "Installed" : "Not installed"}</h2>
          </div>
          <button class="small-button" type="button" data-action="close-model-info">Close</button>
        </div>
        ${installed && model ? `<p>Takes up ${escapeHtml(formatBytes(model.installed_bytes))} on disk.</p>` : ""}
        <p>${
          installed && voiceDownload?.phase === "complete" && voiceDownload.up_to_date
            ? "Up to date: nothing to download. It only runs while lines are being generated."
            : installed && voiceDownload?.check_failed
            ? `${voiceDownload.message} It only runs while lines are being generated.`
            : installed
            ? "It only runs while lines are being generated. Supervisor looks for updates once a day on its own; this button looks now."
            : `A one-time download of about ${escapeHtml(formatBytes(model?.required_bytes ?? 0))}. Generated lines play without it; generating new ones needs it.`
        }</p>
        <div class="modal-actions">
          ${installed ? `<button class="danger" type="button" data-action="ask-delete-model" ${busy ? "disabled" : ""}>Delete voice engine</button>` : ""}
          <button class="${installed ? "" : "primary"}" type="button" data-action="download-model-pack" ${busy ? "disabled" : ""}>${installed ? "Check for updates" : "Download voice engine"}</button>
        </div>
      `);
}

function renderMemoryInfoModal(): string {
  const system = voiceBackend?.system;
  const free = system?.available_ram_bytes ?? null;
  const need = system?.min_free_ram_bytes ?? 0;
  const peak = system?.last_peak_ram_bytes ?? null;
  const locked = ramGenerationLocked();
  return modal("voice-popup", "memory-info-title", `
        <div class="voice-info-head">
          <div>
            <p class="eyebrow">Memory</p>
            <h2 id="memory-info-title">${locked ? "Not enough free memory" : "Enough memory"}</h2>
          </div>
          <button class="small-button" type="button" data-action="close-memory-info">Close</button>
        </div>
        <p>Generating lines starts the voice engine (about ${FIRST_CLIP_SECONDS} seconds the first time) and needs:</p>
        <div class="voice-kv">
          <div><span>Needs free</span><strong>${escapeHtml(need ? formatBytes(need) : "—")}</strong></div>
          <div><span>Free now</span><strong class="${locked ? "is-bad" : ""}" data-ram-free>${escapeHtml(free === null ? "—" : formatBytes(free))}</strong></div>
          <div><span>In this machine</span><strong data-ram-machine>${escapeHtml(system?.total_ram_bytes ? formatBytes(system.total_ram_bytes) : "—")}</strong></div>
        </div>
        <p data-ram-copy>${escapeHtml(ramLockCopy(locked, peak))}</p>
        <div class="modal-actions">
          <button class="${locked ? "primary" : ""}" type="button" data-action="check-ram">Check again</button>
        </div>
      `);
}

function ramLockCopy(locked: boolean, peak: number | null): string {
  if (locked) {
    return "Close other apps, then check again.";
  }
  return peak ? `Plenty right now. The last line used up to ${formatBytes(peak)} while it was being made.` : "Plenty right now. It's only used while a line is being made.";
}

/** The memory tile and popup follow the live numbers without a full render. */
function paintVoiceRam(): void {
  if (!voiceBackend) {
    return;
  }
  const system = voiceBackend.system;
  const free = system.available_ram_bytes ?? null;
  const locked = ramGenerationLocked();
  const value = document.querySelector("[data-memory-value]");
  if (value) {
    value.textContent = memoryTileValue();
    value.closest("[data-memory-tile]")?.classList.toggle("is-bad", locked);
  }
  document.querySelectorAll("[data-ram-copy]").forEach((copy) => {
    copy.textContent = ramLockCopy(locked, system.last_peak_ram_bytes ?? null);
  });
  document.querySelectorAll("[data-ram-free]").forEach((node) => {
    node.textContent = free === null ? "—" : formatBytes(free);
    node.classList.toggle("is-bad", locked);
  });
}

export function renderVoiceDialogs(): string {
  if (appView !== "main") {
    return "";
  }

  const showVoiceDialog = activeTab === "settings" && settingsView === "voice";
  return `
    ${showVoiceDialog && recordingOpen ? renderRecordingModal() : ""}
    ${showVoiceDialog && voiceInfoId && !voiceDeleteTargetId && !voiceBusy ? renderVoiceInfoModal() : ""}
    ${showVoiceDialog && voiceDeleteTargetId ? renderDeleteVoiceModal() : ""}
    ${showVoiceDialog && modelDeleteOpen ? renderDeleteModelModal() : ""}
    ${showVoiceDialog && voiceDialog === "model-info" && !modelDeleteOpen && !voiceBusy ? renderModelInfoModal() : ""}
    ${showVoiceDialog && voiceDialog === "memory-info" && !voiceBusy ? renderMemoryInfoModal() : ""}
    ${showVoiceDialog && voiceDialog === "voice-help" ? renderVoiceHelpModal() : ""}
    ${showVoiceDialog && phraseEditor && !voiceDeleteTargetId ? renderLinePopup() : ""}
    ${showVoiceDialog && !phraseEditor ? renderNewPersonalityModal() : ""}
    ${voiceBusy && !clipQueue ? renderVoiceBusyModal() : ""}
  `;
}

/** About twenty-five seconds at a normal pace, in the plain register the lines use. */
const RECORDING_PROMPT =
  "Most days start the same way: coffee, a look at the list, and the one thing I keep putting off. Today that thing goes first, before anything else gets a say. If I drift, say so. I'd rather hear it now than find out at six o'clock that the whole afternoon went somewhere else.";

function renderRecordingModal(): string {
  const isRecording = recordingState === "recording";
  const canSave = Boolean(recordedVoice?.bytes && recordedVoice.name.trim() && voiceBusy === null);

  return modal("recording-panel", "record-title", `
        <div class="modal-head">
          <div>
            <p class="eyebrow">New voice</p>
            <h2 id="record-title">Record voice</h2>
          </div>
          <button class="small-button" type="button" data-action="close-recording">Close</button>
        </div>

        <div class="recording-grid">
          <section class="recording-stage">
            <button class="mic-button ${isRecording ? "recording" : ""}" type="button" data-action="${isRecording ? "stop-recording" : "start-recording"}" ${recordedVoice && !isRecording ? "disabled" : ""} aria-label="${isRecording ? "Stop recording" : "Start recording"}">
              <span></span>
            </button>
            <strong>${isRecording ? "Recording" : recordedVoice ? "Recorded" : "Ready"}</strong>
            <p id="recording-elapsed">${isRecording ? formatDuration(recordingDurationSeconds()) : recordedVoice ? `${formatDuration(recordedVoice.seconds)} captured` : "Read aloud for 20 to 30 seconds somewhere quiet."}</p>
            ${recordingError ? `<p class="recording-error">${escapeHtml(recordingError)}</p>` : ""}
            ${recordedVoice ? "" : `<p class="recording-prompt">${escapeHtml(RECORDING_PROMPT)}</p>`}
          </section>

          <section class="recording-review">
            ${
              recordedVoice
                ? `
                  <label>
                    <span>Voice name</span>
                    <input id="voice-name" maxlength="80" value="${attr(recordedVoice.name)}" placeholder="Mom voice" />
                  </label>
                  <audio controls preload="metadata" src="${attr(recordedVoice.url)}"></audio>
                  <div class="modal-actions">
                    <button type="button" data-action="rerecord-voice">Re-record</button>
                    <button class="primary" type="button" data-action="save-recorded-voice" ${canSave ? "" : "disabled"}>Save voice</button>
                  </div>
                  <p class="quiet">Saving is instant. You pick which lines to generate next.</p>
                `
                : `<p class="empty">Your recording shows up here so you can listen before saving it.</p>`
            }
          </section>
        </div>
      `);
}

function renderDeleteModelModal(): string {
  const body = "<p>Your voices and their lines stay on this computer. To generate new lines you'll need to download the voice engine again.</p>";
  return confirmModal("delete-model-title", "Voice engine", "Delete the voice engine?", body, ["cancel-delete-model", "Cancel"], ["delete-model-files", "Delete voice engine"]);
}

function renderVoiceInfoModal(): string {
  const voice = availableVoices().find((item) => item.id === voiceInfoId);
  if (!voice) {
    return "";
  }

  const clip = previewPathForVoice(voice);
  const profileId = voice.source === "custom" ? voice.profile?.profile_id ?? "" : "";
  const canRename = Boolean(voice.profile) && voiceBusy === null;

  return modal("voice-info-panel", "voice-info-title", `
        <div class="voice-info-head">
          <div>
            <p class="eyebrow">Edit voice</p>
            <h2 id="voice-info-title">${escapeHtml(voice.name)}</h2>
          </div>
        </div>
        <form class="voice-rename" id="voice-rename">
          <label>
            <span>Name <em class="voice-rename-status" aria-live="polite"></em></span>
            <input id="voice-rename-input" maxlength="80" value="${attr(voice.name)}" autocomplete="off" ${canRename ? "" : "disabled"} />
          </label>
        </form>
        <div>
          <p class="eyebrow">${profileId ? "Recording" : "Hello"}</p>
          <div class="voice-info-transport">
            <button class="voice-preview-play" type="button" data-action="toggle-voice-preview" ${clip ? "" : "disabled"} aria-label="Play">
              <span class="voice-preview-icon" aria-hidden="true"></span>
            </button>
            <div class="voice-info-wave">
              <canvas id="voice-preview-wave" width="320" height="56" data-wave-path="${attr(clip ?? "")}" data-wave-bars="40"></canvas>
              <input id="voice-preview-bar" type="range" min="0" max="1" value="0" step="0.01" ${clip ? "" : "disabled"} aria-label="Playback" />
              <div class="voice-info-times">
                <span id="voice-preview-elapsed">0:00</span>
                <span id="voice-preview-total">0:00</span>
              </div>
            </div>
          </div>
        </div>
        <div class="voice-info-foot">
          ${
            profileId
              ? `<button class="danger" type="button" data-action="confirm-delete-voice" data-profile-id="${attr(profileId)}">Delete voice</button>`
              : `<p class="voice-info-note">Starter voices stay on this device.</p>`
          }
          <button class="primary" type="button" data-action="close-voice-info">Done</button>
        </div>
      `);
}
function renderDeleteVoiceModal(): string {
  const profile = voiceDeleteTargetId ? profileById(voiceDeleteTargetId) : null;
  if (!profile) {
    return "";
  }

  return modal("confirm-panel", "delete-voice-title", `
        <div class="modal-head">
          <div>
            <p class="eyebrow">Delete voice</p>
            <h2 id="delete-voice-title">${escapeHtml(profile.display_name)}</h2>
          </div>
          <button class="small-button" type="button" data-action="cancel-delete-voice">Close</button>
        </div>
        <p class="quiet">Its lines can be regenerated from the recording. Deleting the voice removes the recording too.</p>
        <div class="delete-choice-grid">
          <button type="button" data-action="delete-voice-files" ${profile.clips.length === 0 ? "disabled" : ""}>Delete its lines, keep the recording</button>
          <button class="danger" type="button" data-action="delete-voice-profile">Delete the voice</button>
        </div>
      `);
}

function renderVoiceBusyModal(): string {
  if (voiceBusy === "download-model") {
    return renderDownloadBusyModal();
  }

  return `
    <div class="modal-backdrop busy-backdrop" role="presentation">
      <section class="modal-panel busy-panel" role="dialog" aria-modal="true" aria-live="polite">
        <p class="eyebrow">Voice engine</p>
        <h2>${escapeHtml(voiceBusyTitle())}</h2>
        <p>${escapeHtml(voiceBusyCopy())}</p>
        <div class="loading-bar"><span></span></div>
      </section>
    </div>
  `;
}

function renderDownloadBusyModal(): string {
  const download = voiceDownload;
  const phase = download?.phase ?? "downloading";
  const done = phase === "complete";
  const checking = phase === "checking";
  const total = Math.max(0, download?.total_bytes ?? voiceBackend?.model.required_bytes ?? 0);
  const downloaded = Math.max(0, Math.min(download?.downloaded_bytes ?? 0, total || Number.MAX_SAFE_INTEGER));
  const percent = done ? 100 : total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
  const upToDate = done && Boolean(download?.up_to_date);
  const title = upToDate
    ? "Up to date"
    : done
      ? "Voice engine ready"
      : phase === "checking"
        ? "Checking installed files"
        : downloadWords(download).title;
  const eta = done ? "Done" : phase === "checking" ? "A few seconds" : downloadWords(download).eta;
  const progressText = checking
    ? "Verifying"
    : total > 0
      ? `${formatBytes(downloaded)} / ${formatBytes(total)}`
      : formatBytes(downloaded);
  const note = done
    ? "You can close this and start cloning a voice."
    : checking
      ? "Nothing is downloaded unless part of it is missing."
      : `This is a ${total > 0 ? formatBytes(total) : "large"} download and can take several minutes depending on your connection.`;

  return `
    <div class="modal-backdrop busy-backdrop" role="presentation">
      <section class="modal-panel busy-panel" role="dialog" aria-modal="true" aria-live="polite">
        <p class="eyebrow">VOICE ENGINE</p>
        <h2>${escapeHtml(title)}</h2>
        ${
          upToDate
            ? ""
            : checking
              ? `<div class="loading-bar" aria-label="Checking installed files"><span></span></div>`
              : `<div class="loading-bar determinate" aria-label="Voice engine download progress"><span style="width: ${percent}%"></span></div>`
        }
        ${
          upToDate
            ? ""
            : `<div class="download-meta">
          <span>${escapeHtml(progressText)}</span>
          <span>${escapeHtml(eta)}</span>
        </div>`
        }
        <p class="quiet busy-note">${escapeHtml(note)}</p>
        <div class="modal-actions">
          ${
            done || phase === "cancelling" || phase === "error"
              ? `<button type="button" data-action="close-model-download">Close</button>`
              : `<button class="danger" type="button" data-action="cancel-model-download">${checking ? "Cancel" : "Cancel download"}</button>`
          }
        </div>
      </section>
    </div>
  `;
}

export function releaseVoiceWorker(): void {
  void invoke("release_voice_worker").catch(() => null);
}

export async function updateSelectedVoice(voiceId: string): Promise<boolean> {
  try {
    setSettings(await invoke<SessionSettings>("update_settings", {
      update: { voice_profile: voiceId },
    }));
    voiceError = "";
    return true;
  } catch (error) {
    voiceError = errorText(error);
    render();
    return false;
  }
}

async function startModelDownload(): Promise<void> {
  if (voiceBusy !== null) {
    return;
  }

  voiceBusy = "download-model";
  render();
  try {
    const download = await invoke<VoiceDownloadSnapshot>("start_voice_model_download");
    applyDownloadSnapshot(download);
    voiceError = "";
    if (download.phase === "complete") {
      await refreshVoiceStatus(false);
      showFeedback(download.up_to_date ? "Up to date" : "Voice engine ready");
    } else {
      startDownloadPolling();
    }
  } catch (error) {
    voiceBusy = null;
    voiceError = errorText(error);
  }
  render();
}

async function cancelModelDownload(): Promise<void> {
  try {
    voiceBusy = "download-model";
    const download = await invoke<VoiceDownloadSnapshot>("cancel_voice_model_download");
    applyDownloadSnapshot(download);
    startDownloadPolling();
  } catch (error) {
    voiceError = errorText(error);
  }
  render();
}

function startDownloadPolling(): void {
  downloadPollId ??= window.setTimeout(pollDownload, 750);
}

function stopDownloadPolling(): void {
  clearTimeout(downloadPollId);
  downloadPollId = undefined;
}

/** Runs every 750 ms while the voice engine popup waits on a download, until it ends. */
async function pollDownload(): Promise<void> {
  const poll = downloadPollId;
  if (voiceBusy !== "download-model") {
    stopDownloadPolling();
    return;
  }
  try {
    const download = await invoke<VoiceDownloadSnapshot>("get_voice_model_download");
    applyDownloadSnapshot(download);
    if (download.phase === "complete") {
      stopDownloadPolling();
      await refreshVoiceStatus(false);
      showFeedback(download.up_to_date ? "Up to date" : "Voice engine ready");
      render();
      return;
    }
    if (download.phase === "idle") {
      stopDownloadPolling();
      voiceBusy = null;
      await refreshVoiceStatus(false);
      render();
      showFeedback("Download cancelled");
      return;
    }
    if (download.phase === "error") {
      stopDownloadPolling();
      voiceBusy = null;
      voiceError = download.message;
      await refreshVoiceStatus(false);
      render();
      return;
    }
  } catch (error) {
    stopDownloadPolling();
    voiceBusy = null;
    voiceError = errorText(error);
    render();
    return;
  }
  paintDownloadProgress();
  if (downloadPollId === poll) {
    downloadPollId = window.setTimeout(pollDownload, 750);
  }
}

export function dismissDownloadModal(): void {
  stopDownloadPolling();
  voiceBusy = null;
  if (voiceDownload?.phase === "complete" || voiceDownload?.phase === "idle") {
    voiceDownload = null;
  }
  render();
}

function paintDownloadProgress(): void {
  if (voiceDownload?.phase === "complete" || voiceDownload?.phase === "idle" || voiceDownload?.phase === "error") {
    return;
  }
  const download = voiceDownload;
  if (!download || !document.querySelector(".busy-panel")) {
    return;
  }
  // Checking has no determinate bar; the first real fetch flips the phase and the modal is
  // rebuilt by the next render. Only the downloading and cancelling phases repaint in place.
  if (download.phase === "checking" || !document.querySelector(".loading-bar.determinate")) {
    if (download.phase !== "checking") {
      render();
    }
    return;
  }
  const total = Math.max(0, download.total_bytes ?? voiceBackend?.model.required_bytes ?? 0);
  const downloaded = Math.max(0, Math.min(download.downloaded_bytes ?? 0, total || Number.MAX_SAFE_INTEGER));
  const percent = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
  const bar = document.querySelector<HTMLElement>(".loading-bar.determinate > span");
  if (bar) {
    bar.style.width = `${percent}%`;
  }
  const words = downloadWords(download);
  const title = document.querySelector(".busy-panel h2");
  if (title) {
    title.textContent = words.title;
  }
  const meta = document.querySelectorAll(".download-meta span");
  if (meta[0]) {
    meta[0].textContent = total > 0 ? `${formatBytes(downloaded)} / ${formatBytes(total)}` : formatBytes(downloaded);
  }
  if (meta[1]) {
    meta[1].textContent = words.eta;
  }
}

/** The popup's heading and time text while files arrive. Between files the download hashes
 *  each one and unpacks the engine: the bar stands still then, so the words say why. */
function downloadWords(download: VoiceDownloadSnapshot | null): { title: string; eta: string } {
  if (download?.phase === "cancelling") {
    return { title: "Cancelling download", eta: "Deleting partial files" };
  }
  if (download?.step === "checking") {
    return { title: "Checking the download", eta: "A few seconds" };
  }
  if (download?.step === "unpacking") {
    return { title: "Unpacking the voice engine", eta: "Under a minute" };
  }
  const seconds = download?.eta_seconds;
  return {
    title: "Downloading the voice engine",
    eta: seconds === null || seconds === undefined ? "Estimating time left" : `${formatDuration(seconds)} left`,
  };
}

function applyDownloadSnapshot(download: VoiceDownloadSnapshot): void {
  voiceDownload = download;
  if (voiceBackend) {
    voiceBackend = { ...voiceBackend, model: download.model, runtime: download.runtime };
  }
}

/** `redrawAfter` false: the caller redraws once it has settled what comes after. */
export async function runVoiceBusy(kind: Exclude<VoiceBusy, null>, task: () => Promise<void>, redrawAfter = true): Promise<boolean> {
  if (voiceBusy !== null) {
    return false;
  }

  voiceBusy = kind;
  render();

  try {
    await task();
    voiceError = "";
    return true;
  } catch (error) {
    voiceError = errorText(error);
    return false;
  } finally {
    voiceBusy = null;
    if (redrawAfter) {
      render();
    }
  }
}

function openRecordingDialog(): void {
  dismissVoiceInfo();
  recordingOpen = true;
  recordingState = recordedVoice ? "recorded" : "idle";
  recordingError = "";
  paintVoiceLayer();
}

export async function closeRecordingDialog(): Promise<void> {
  await stopVoiceRecording(false);
  await clearVoiceRecording();
  recordingOpen = false;
  recordingState = "idle";
  recordingError = "";
  resetRecordedVoice();
  paintVoiceLayer();
}

async function startVoiceRecording(): Promise<void> {
  if (recordingState === "recording") {
    return;
  }

  resetRecordedVoice();
  recordingError = "";

  try {
    const recording = await invoke<VoiceRecordingSnapshot>("start_voice_recording");
    applyRecordingSnapshot(recording);
    if (recording.phase === "recording" && recordingTickId === undefined) {
      recordingTickId = window.setInterval(paintRecordingClock, 500);
    }
  } catch (error) {
    recordingState = "error";
    recordingError = errorText(error);
  }

  paintVoiceLayer();
}

async function stopVoiceRecording(keepClip = true): Promise<void> {
  if (recordingState !== "recording") {
    return;
  }

  clearRecordingTick();

  if (!keepClip) {
    await invoke<VoiceRecordingSnapshot>("stop_voice_recording").catch(() => null);
    return;
  }

  try {
    const recording = await invoke<VoiceRecordingSnapshot>("stop_voice_recording");
    applyRecordingSnapshot(recording);
  } catch (error) {
    recordingState = "error";
    recordingError = errorText(error);
  }

  paintVoiceLayer();
}

async function saveRecordedVoice(): Promise<void> {
  const recording = recordedVoice;
  if (!recording?.path) {
    return;
  }
  const name = recording.name.trim();
  if (!name) {
    showFeedback("Name the voice");
    return;
  }
  try {
    const saved = await invoke<VoiceProfileSummary>("save_voice_reference_from_path", {
      input: { profile_id: uniqueVoiceProfileId(name), display_name: name, reference_audio_path: recording.path },
    });
    if (!saved.reference_path) {
      throw new Error("The recording was not saved. Try recording again.");
    }
    upsertProfile(saved);
    await refreshVoiceStatus(false);
    clipsVoiceId = voiceOptionId(saved.profile_id);
    await clearVoiceRecording();
    resetRecordedVoice();
    recordingOpen = false;
    recordingState = "idle";
    voiceError = "";
    render();
    showFeedback("Voice saved. Generate its lines below.");
    document.querySelector(".phrase-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    recordingError = errorText(error); // the dialog is still open; a banner would sit behind it
    paintVoiceLayer();
  }
}

export function pickVoice(voice: VoiceOption): void {
  draft.voiceId = voice.id;
  // The lines below follow the voice picked; No voice leaves them on the last one.
  if (voice.id !== "none") {
    clipsVoiceId = voice.id;
    clipsVoiceTouched = true;
    closeToneForms();
  }
  render();
  void updateSelectedVoice(voice.id).then((saved) => {
    if (saved) {
      showFeedback(`${voice.name} selected`);
    }
  });
}

/** Saves the name in Edit voice as the field is left. An empty name puts the old one back. */
export async function renameVoice(): Promise<void> {
  const voice = availableVoices().find((item) => item.id === voiceInfoId);
  const input = document.getElementById("voice-rename-input") as HTMLInputElement | null;
  if (!voice?.profile || !input) {
    return;
  }
  const name = input.value.trim().slice(0, 80);
  if (!name || name === voice.name) {
    input.value = voice.name;
    return;
  }
  let saved = false;
  try {
    upsertProfile(await invoke<VoiceProfileSummary>("rename_voice_profile", { profileId: voice.profile.profile_id, displayName: name }));
    voiceError = "";
    saved = true;
  } catch (error) {
    voiceError = errorText(error);
  }
  // Leaving the field by clicking Done or Delete: the redraw waits for that click to land.
  afterPointer(() => {
    render();
    const status = document.querySelector(".voice-rename-status");
    if (status && saved) {
      status.textContent = "Saved";
    }
  });
}

async function deleteVoiceProfile(): Promise<void> {
  const profileId = voiceDeleteTargetId;
  if (!profileId) {
    return;
  }

  await runVoiceBusy("delete-voice", async () => {
    const profiles = await invoke<VoiceProfileSummary[]>("delete_voice_profile", { profileId });
    if (voiceBackend) {
      voiceBackend = { ...voiceBackend, profiles };
    }
    voiceDeleteTargetId = null;
    if (voiceInfoId === voiceOptionId(profileId)) {
      dismissVoiceInfo();
    }
    if (draft.voiceId === voiceOptionId(profileId)) {
      draft.voiceId = "starter-female";
      await updateSelectedVoice(draft.voiceId);
    }
    if (clipsVoiceId === voiceOptionId(profileId)) {
      clipsVoiceId = "starter-female";
    }
    showFeedback("Voice deleted");
  });
}

async function deleteVoiceFilesOnly(): Promise<void> {
  const profileId = voiceDeleteTargetId;
  if (!profileId) {
    return;
  }

  await runVoiceBusy("delete-voice", async () => {
    const profile = await invoke<VoiceProfileSummary>("delete_voice_profile_clips", { profileId });
    upsertProfile(profile);
    await refreshVoiceStatus(false);
    stopVoicePreview();
    voiceDeleteTargetId = null;
    if (draft.voiceId === voiceOptionId(profileId)) {
      draft.voiceId = "starter-female";
      await updateSelectedVoice(draft.voiceId);
    }
    showFeedback("Voice files deleted");
  });
}

function resetRecordedVoice(): void {
  if (recordedVoice?.url) {
    URL.revokeObjectURL(recordedVoice.url);
  }
  recordedVoice = null;
}

async function clearVoiceRecording(): Promise<void> {
  clearRecordingTick();
  recordingStartedAtMs = null;
  await invoke<VoiceRecordingSnapshot>("clear_voice_recording").catch(() => null);
}

function applyRecordingSnapshot(recording: VoiceRecordingSnapshot): void {
  recordingState = recording.phase;
  recordingError = recording.phase === "error" ? recording.message : "";
  if (recording.phase === "recording" && recordingStartedAtMs === null) {
    recordingStartedAtMs = Date.now() - recording.elapsed_seconds * 1000;
  }
  if (recording.phase !== "recording") {
    recordingStartedAtMs = null;
  }
  if (recording.phase === "recorded" && recording.path) {
    recordedVoice = {
      path: recording.path,
      url: clipAssetUrl(recording.path),
      bytes: recording.bytes,
      seconds: recording.duration_seconds,
      name: recordedVoice?.name || defaultVoiceName(),
    };
  }
}

function clearRecordingTick(): void {
  clearInterval(recordingTickId);
  recordingTickId = undefined;
}

function paintRecordingClock(): void {
  const el = document.getElementById("recording-elapsed");
  if (el && recordingState === "recording") {
    el.textContent = formatDuration(recordingDurationSeconds());
    // The backend releases the mic at 60 s; stop here too so the clock doesn't run on.
    if (recordingDurationSeconds() >= 60) {
      void stopVoiceRecording();
    }
  }
}

/** The bars of the speaking orb, for a play button while its clip plays. */
export const MINI_ORB = `<span class="mini-orb" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`;

export async function playLine(clip: VoiceClipSummary | null): Promise<boolean> {
  // Never into a recording: the microphone would take the line into the new voice.
  if (!clip || recordingState === "recording") {
    return false;
  }
  const phrase = effectivePhrases().find((item) => clipBelongsToPhrase(clip, item.id));
  lastNudgeVoice = { voice: selectedVoice().name, line: phrase?.text ?? "" };
  try {
    nudgeAudio?.pause();
    // One voice at a time: a recording being listened back to stops for the line.
    voicePreviewAudio?.pause();
    const url = clipAssetUrl(clip.path);
    const audio = new Audio(url);
    nudgeAudio = audio;
    audio.preload = "auto";
    audio.volume = await playVolume(url);
    // Only the current line reports; one replaced mid-word stays quiet.
    const ended = () => {
      if (nudgeAudio === audio) {
        announceNudge(false);
      }
    };
    audio.addEventListener("ended", ended);
    audio.addEventListener("pause", ended);
    await audio.play();
    announceNudge(true);
    voiceError = "";
    return true;
  } catch (error) {
    // A newer line or Stop cut this one off before it began: not a failure.
    if (error instanceof DOMException && error.name === "AbortError") {
      return false;
    }
    voiceError = `Could not play the line: ${errorText(error)}`;
    // Settings shows the error; during a session the card is where the user looks.
    void emit("nudge-voice", { speaking: false, failed: true, ...lastNudgeVoice } satisfies NudgeVoice);
    render();
    return false;
  }
}

/** Tells the distraction card (another window) whether the voice is speaking, and what. */
export function announceNudge(speaking: boolean): void {
  if (sessionOver && sessionOver.voice.speaking !== speaking) {
    sessionOver.voice.speaking = speaking;
    paintModalLayer();
  }
  if (lastNudgeVoice) {
    void emit("nudge-voice", { speaking, ...lastNudgeVoice } satisfies NudgeVoice);
  }
}

/** Back to work lines from the voice's personality (for a phone, its Phone down lines first); any
 *  clip at all only when it has none ready. */
export function selectedNudgeClip(nudgeCount: number, phone = false): VoiceClipSummary | null {
  const voice = selectedVoice();
  const phoneReady = phone ? readyClips(voice, "phone") : [];
  const ready = phoneReady.length > 0 ? phoneReady : readyClips(voice, "nudge");
  // No nudge line in this personality: the voice stays quiet, as the Voice page says. A
  // session-over or round-over line is never a nudge.
  if (ready.length === 0) {
    return null;
  }
  return ready[(Math.max(1, nudgeCount) - 1) % ready.length];
}

/** The file a voice's play button plays: a starter's intro, the recording, else a line. */
function previewPathForVoice(voice: VoiceOption): string | null {
  if (voice.source === "starter" && voice.profile) {
    return `${voice.profile.profile_dir}/intro.wav`;
  }
  if (voice.profile?.reference_path) {
    return voice.profile.reference_path;
  }
  const clips = voice.profile?.clips ?? [];
  for (const phrase of effectivePhrases()) {
    const clip = clipForPhraseId(clips, phrase.id);
    if (clip) {
      return clip.path;
    }
  }
  return clips[0]?.path ?? null;
}

export function clipForPhrase(voice: VoiceOption, phrase: PhraseDefinition): VoiceClipSummary | null {
  return clipForPhraseId(voice.profile?.clips ?? [], phrase.id);
}

export function clipForPhraseId(clips: VoiceClipSummary[], phraseId: string): VoiceClipSummary | null {
  if (!phraseId) {
    return null;
  }
  return clips.find((clip) => clipBelongsToPhrase(clip, phraseId)) ?? null;
}

// Exact id: `custom_gentle_come_on_back` is a different line from `gentle_come_on_back`.
export function clipBelongsToPhrase(clip: VoiceClipSummary, phraseId: string): boolean {
  return clip.phrase_id === phraseId;
}

/** The clip a play button started, so that button shows the speaking orb; a second click stops it. */
let playingClipPath: string | null = null;

async function playClip(path: string): Promise<void> {
  if (path === playingClipPath && nudgeAudio && !nudgeAudio.paused) {
    nudgeAudio.pause();
    return;
  }
  try {
    voicePreviewAudio?.pause();
    paintVoicePreview();
    nudgeAudio?.pause();
    const url = clipAssetUrl(path);
    const audio = new Audio(url);
    nudgeAudio = audio;
    audio.preload = "auto";
    audio.volume = await playVolume(url);
    const done = () => {
      if (playingClipPath === path && nudgeAudio === audio) {
        playingClipPath = null;
        paintPlayingClip();
      }
    };
    audio.addEventListener("ended", done);
    audio.addEventListener("pause", done);
    await audio.play();
    playingClipPath = path;
    paintPlayingClip();
    voiceError = "";
  } catch (error) {
    voiceError = `Could not play the line: ${errorText(error)}`;
    render();
  }
}

/** A line a play button started stops with the screen that showed the button: a voice sample
 *  does not play on past the step, tab or page it was on. A reminder is not a play button's
 *  line, so it plays on. */
export function stopClip(): void {
  if (playingClipPath) {
    nudgeAudio?.pause();
  }
}

/** Play buttons follow the clip playing, without a redraw. */
export function paintPlayingClip(root: ParentNode = document): void {
  root.querySelectorAll<HTMLButtonElement>("button[data-action='play-clip']").forEach((button) => {
    const on = playingClipPath !== null && button.dataset.clipPath === playingClipPath;
    button.classList.toggle("is-playing", on);
    button.setAttribute("aria-pressed", String(on));
    const card = button.closest(".voice-card");
    if (!card) {
      return;
    }
    // The words come and go with the voice, in the same paint as the button.
    card.classList.toggle("is-speaking", on);
    if (on) {
      card.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  });
}

export function dismissVoiceInfo(): void {
  stopVoicePreview();
  voiceInfoId = null;
}

export function stopVoicePreview(): void {
  if (previewBarDragging) {
    previewBarDragging = false;
    window.removeEventListener("pointerup", endPreviewBarDrag);
  }
  if (previewWaveRaf) {
    cancelAnimationFrame(previewWaveRaf);
    previewWaveRaf = 0;
  }
  const audio = voicePreviewAudio;
  voicePreviewAudio = null;
  voicePreviewPath = "";
  if (!audio) {
    return;
  }
  audio.pause();
  audio.removeAttribute("src");
}

function ensureVoicePreviewAudio(path: string): HTMLAudioElement {
  if (voicePreviewAudio && voicePreviewPath === path) {
    return voicePreviewAudio;
  }
  stopVoicePreview();
  const url = clipAssetUrl(path);
  const audio = new Audio(url);
  audio.preload = "auto";
  // At the same level as the lines (see PLAY_LEVEL_DB); set as soon as it is measured.
  void playVolume(url).then((volume) => {
    audio.volume = volume;
  });
  audio.addEventListener("timeupdate", paintVoicePreview);
  audio.addEventListener("loadedmetadata", paintVoicePreview);
  audio.addEventListener("play", paintVoicePreview);
  audio.addEventListener("pause", paintVoicePreview);
  audio.addEventListener("ended", () => {
    if (voicePreviewAudio) {
      voicePreviewAudio.currentTime = 0;
    }
    paintVoicePreview();
  });
  voicePreviewAudio = audio;
  voicePreviewPath = path;
  return audio;
}

function transportPreviewPath(): string | null {
  const voice = availableVoices().find((item) => item.id === voiceInfoId);
  return voice ? previewPathForVoice(voice) : null;
}

export function bindVoicePreview(): void {
  const bar = document.getElementById("voice-preview-bar") as HTMLInputElement | null;
  if (!bar) {
    if (!voiceInfoId) {
      stopVoicePreview();
    } else {
      voicePreviewAudio?.pause();
    }
    return;
  }

  const path = transportPreviewPath();
  if (path) {
    ensureVoicePreviewAudio(path);
  } else {
    stopVoicePreview();
  }
  bar.addEventListener("pointerdown", () => {
    previewBarDragging = true;
    window.addEventListener("pointerup", endPreviewBarDrag, { once: true });
  });
  bar.addEventListener("pointerup", endPreviewBarDrag);
  bar.addEventListener("pointercancel", endPreviewBarDrag);
  bar.addEventListener("change", endPreviewBarDrag);
  bar.addEventListener("input", () => {
    const next = Number(bar.value);
    const audio = voicePreviewAudio;
    if (audio && Number.isFinite(next) && audio.duration > 0) {
      audio.currentTime = next;
    }
    paintVoicePreview();
  });
  paintVoicePreview();
}

function endPreviewBarDrag(): void {
  if (!previewBarDragging) {
    return;
  }
  previewBarDragging = false;
  window.removeEventListener("pointerup", endPreviewBarDrag);
  paintVoicePreview();
}

const waveformFailed = new Set<string>();

export function bindVoiceWaveforms(root: ParentNode = document): void {
  root.querySelectorAll<HTMLCanvasElement>("canvas[data-wave-path]").forEach((canvas) => {
    const path = canvas.dataset.wavePath ?? "";
    const bars = Number(canvas.dataset.waveBars) || 11;
    if (!path || waveformFailed.has(path)) {
      return;
    }
    void fillWaveform(canvas, path, bars, canvas.id === "voice-preview-wave");
  });
}

function paintVoicePreview(): void {
  const button = document.querySelector<HTMLButtonElement>("[data-action='toggle-voice-preview']");
  const bar = document.getElementById("voice-preview-bar") as HTMLInputElement | null;
  const audio = voicePreviewAudio;
  const playing = Boolean(audio && !audio.paused && !audio.ended);
  if (button) {
    button.classList.toggle("is-playing", playing);
    button.setAttribute("aria-label", playing ? "Pause" : "Play");
  }
  const duration = audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
  const current =
    previewBarDragging && bar ? Number(bar.value) : duration && audio ? audio.currentTime : 0;
  const progress = duration ? Math.min(1, Math.max(0, current / duration)) : 0;
  const elapsed = document.getElementById("voice-preview-elapsed");
  const total = document.getElementById("voice-preview-total");
  if (elapsed) {
    elapsed.textContent = formatDuration(current);
  }
  if (total) {
    total.textContent = formatDuration(duration);
  }
  const wave = document.getElementById("voice-preview-wave") as HTMLCanvasElement | null;
  const peaks = wave ? peaksForCanvas(wave) : null;
  if (wave && peaks) {
    drawWaveform(wave, peaks, progress, true);
  }
  if (playing) {
    if (!previewWaveRaf) {
      previewWaveRaf = requestAnimationFrame(() => {
        previewWaveRaf = 0;
        paintVoicePreview();
      });
    }
  } else if (previewWaveRaf) {
    cancelAnimationFrame(previewWaveRaf);
    previewWaveRaf = 0;
  }
  if (!bar) {
    return;
  }
  if (!previewBarDragging) {
    bar.max = duration ? String(duration) : "1";
    bar.value = duration ? String(current) : "0";
  }
  bar.disabled = !duration;
  bar.style.setProperty("--range-progress", `${progress * 100}%`);
}

async function fillWaveform(
  canvas: HTMLCanvasElement,
  path: string,
  bars: number,
  timed: boolean,
): Promise<void> {
  let peaks: number[];
  try {
    peaks = await loadWaveformPeaks(path, bars);
  } catch {
    waveformFailed.add(path);
    return;
  }
  if (!canvas.isConnected) {
    return;
  }
  const audio = voicePreviewAudio;
  const duration = audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
  const progress = timed && duration && audio ? audio.currentTime / duration : 1;
  drawWaveform(canvas, peaks, timed ? progress : 1, timed);
  if (canvas.clientWidth < 2) {
    requestAnimationFrame(() => {
      if (canvas.isConnected) {
        drawWaveform(canvas, peaks, timed ? progress : 1, timed);
      }
    });
  }
}

function peaksForCanvas(canvas: HTMLCanvasElement): number[] | null {
  const path = canvas.dataset.wavePath ?? "";
  const bars = Number(canvas.dataset.waveBars) || 11;
  return waveformPeaks.get(`${path}:${bars}`) ?? null;
}

async function loadWaveformPeaks(path: string, bars: number): Promise<number[]> {
  const key = `${path}:${bars}`;
  const cached = waveformPeaks.get(key);
  if (cached) {
    return cached;
  }
  const buffer = await loadWaveformBuffer(path);
  const data = buffer.getChannelData(0);
  const size = Math.max(1, Math.floor(data.length / bars));
  const peaks: number[] = [];
  for (let i = 0; i < bars; i += 1) {
    let peak = 0;
    const start = i * size;
    for (let j = 0; j < size; j += 1) {
      peak = Math.max(peak, Math.abs(data[start + j] ?? 0));
    }
    peaks.push(peak);
  }
  waveformPeaks.set(key, peaks);
  return peaks;
}

/** Not cached: peaks are, and a decoded buffer is seconds of float32 per clip. */
async function loadWaveformBuffer(path: string): Promise<AudioBuffer> {
  let pending = waveformPending.get(path);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(clipAssetUrl(path));
      if (!response.ok) {
        throw new Error("waveform fetch failed");
      }
      const bytes = await response.arrayBuffer();
      const context = waveformContext ?? (waveformContext = new AudioContext());
      return context.decodeAudioData(bytes.slice(0));
    })();
    waveformPending.set(path, pending);
  }
  try {
    return await pending;
  } finally {
    waveformPending.delete(path);
  }
}

function sizeWaveformCanvas(canvas: HTMLCanvasElement): void {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function drawWaveform(canvas: HTMLCanvasElement, peaks: number[], progress: number, timed: boolean): void {
  sizeWaveformCanvas(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx || peaks.length === 0) {
    return;
  }
  const width = canvas.width;
  const height = canvas.height;
  if (width < 2 || height < 2) {
    return;
  }
  // Static card waves are drawn once per size and theme; only the preview redraws while playing.
  const drawnKey = `${width}x${height}:${theme}:${peaks.length}:${timed ? progress.toFixed(3) : "static"}`;
  if (canvas.dataset.drawnKey === drawnKey) {
    return;
  }
  canvas.dataset.drawnKey = drawnKey;
  ctx.clearRect(0, 0, width, height);
  const gap = Math.max(1, Math.round((window.devicePixelRatio || 1) * 2));
  const barWidth = Math.max(1, (width - gap * (peaks.length - 1)) / peaks.length);
  const playedUntil = timed ? progress * peaks.length : peaks.length;
  const ink = getComputedStyle(canvas).color;
  const played = getComputedStyle(document.documentElement).getPropertyValue("--sv-green").trim() || "#a8eb37";
  const rest = getComputedStyle(document.documentElement).getPropertyValue("--sv-muted").trim() || "#8d8a80";
  peaks.forEach((peak, index) => {
    const barHeight = Math.max(3, peak * (height - 4));
    const x = index * (barWidth + gap);
    const y = (height - barHeight) / 2;
    ctx.fillStyle = timed ? (index < playedUntil ? played : rest) : ink;
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, barHeight, Math.min(Math.round((window.devicePixelRatio || 1) * 2), barWidth / 2));
    ctx.fill();
  });
}

async function toggleVoicePreview(): Promise<void> {
  const path = transportPreviewPath();
  if (!path) {
    return;
  }
  nudgeAudio?.pause();
  const audio = ensureVoicePreviewAudio(path);
  try {
    if (audio.paused) {
      await audio.play();
    } else {
      audio.pause();
    }
    if (voicePreviewAudio !== audio) {
      return;
    }
    voiceError = "";
    paintVoicePreview();
  } catch (error) {
    if (voicePreviewAudio !== audio) {
      return;
    }
    voiceError = `Could not play the line: ${errorText(error)}`;
    render();
  }
}

export function voiceOptions(selected: string, forClips = false): string {
  return availableVoices()
    .map((voice) => {
      if (forClips && voice.id === "none") {
        return "";
      }
      const enabled = forClips ? Boolean(voice.profile?.reference_path) : voice.selectable;
      return `<option value="${voice.id}" ${voice.id === selected ? "selected" : ""} ${enabled ? "" : "disabled"}>${escapeHtml(voice.name)}</option>`;
    })
    .join("");
}

export function sameTone(a: VoiceTone, b: VoiceTone): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function tonePhrases(tone: VoiceTone): PhraseDefinition[] {
  return effectivePhrases().filter((phrase) => sameTone(phrase.tone, tone));
}

/** The clips a voice has for its personality's lines at a moment. */
export function readyClips(voice: VoiceOption, moment: PhraseMoment): VoiceClipSummary[] {
  return momentPhrases(voiceTone(voice), moment)
    .map((phrase) => clipForPhrase(voice, phrase))
    .filter((clip): clip is VoiceClipSummary => Boolean(clip));
}

export function momentPhrases(tone: VoiceTone, moment: PhraseMoment): PhraseDefinition[] {
  return tonePhrases(tone).filter((phrase) => phrase.moment === moment);
}

/** Bundled personalities keep their names; only the user's own can be renamed or deleted. */
export function isCustomTone(tone: VoiceTone): boolean {
  return !toneOrder.some((item) => sameTone(item, tone));
}

/** The personality a voice speaks like: its saved one while that exists, else the first. */
function profileTone(profile: VoiceProfileSummary | null): VoiceTone {
  const tones = phraseToneOrder();
  const saved = profile?.tone;
  return (saved && tones.find((tone) => sameTone(tone, saved))) || tones[0] || toneOrder[0];
}

export function voiceTone(voice: VoiceOption): VoiceTone {
  return profileTone(voice.profile);
}

/** Every back to work line of the voice's personality has a clip, and it has some at all. The
 *  other moments can come later; a voice without them stays quiet there. */
export function profileToneReady(profile: VoiceProfileSummary | null): boolean {
  const phrases = momentPhrases(profileTone(profile), "nudge");
  return phrases.length > 0 && phrases.every((phrase) => clipForPhraseId(profile?.clips ?? [], phrase.id));
}

/** How many of the lines in the profile's own personality have audio, and how many there are. */
function ownLineCount(profile: VoiceProfileSummary | null): { ready: number; total: number } {
  const own = tonePhrases(profileTone(profile));
  return { ready: own.filter((phrase) => clipForPhraseId(profile?.clips ?? [], phrase.id)).length, total: own.length };
}

/** The card's small print: "Quiet" for the chosen voice that can't speak, or how far a recorded
 *  voice's lines are. */
function voiceCardNote(voice: VoiceOption): string {
  if (quietVoice()?.id === voice.id) {
    return `<span class="voice-card-note">${escapeHtml(`Quiet: no ${toneLabel(voiceTone(voice))} lines`)}</span>`;
  }
  if (voice.source !== "custom" || !voice.profile?.reference_path || voice.ready >= voice.total) {
    return "";
  }
  const words = voice.ready === 0 ? "Lines not generated yet" : `${voice.ready} of ${voice.total} lines ready`;
  return `<span class="voice-card-note">${escapeHtml(words)}</span>`;
}

/** The moments a voice has no line for in its personality: it says nothing when they come. */
function voiceSilentMoments(voice: VoiceOption): string[] {
  return MOMENTS.filter((moment) => {
    const phrases = momentPhrases(voiceTone(voice), moment.id);
    return phrases.length > 0 && !phrases.some((phrase) => clipForPhrase(voice, phrase));
  }).map((moment) => moment.label);
}

/** The chosen voice, when it has no back to work line it can play: every reminder then stays
 *  quiet (selectedNudgeClip finds nothing). Moving the voice to another personality, making or
 *  deleting one, or adding or moving lines can all lead here, so the screens that name the voice
 *  ask this rather than any one of those steps. Null when it can speak or the voices haven't loaded. */
export function quietVoice(): VoiceOption | null {
  if (draft.voiceId === "none" || !voiceBackend) {
    return null;
  }
  const voice = selectedVoice();
  return readyClips(voice, "nudge").length ? null : voice;
}

export function quietVoiceText(voice: VoiceOption): string {
  const tone = toneLabel(voiceTone(voice));
  return momentPhrases(voiceTone(voice), "nudge").length
    ? `${voice.name} has no ${tone} lines generated yet, so reminders stay quiet.`
    : `${tone} has no back to work lines, so ${voice.name} stays quiet when you get distracted.`;
}

/** A voice that would stay silent somewhere: the chosen voice with nothing to say when you get
 *  distracted, or a recorded voice with some lines but not all, that can't be picked yet or stays
 *  silent at some moments. Said where the voice is chosen and where its lines are made, with the
 *  way out, so nobody finds out in a session. A recorded voice with no lines at all and not chosen
 *  gets nothing: the Generate button already says it all then. */
export function renderVoiceGapNotice(voice: VoiceOption, where: "voice" | "start"): string {
  const quiet = quietVoice()?.id === voice.id;
  if (!quiet && (voice.source !== "custom" || !voice.profile?.reference_path || voice.ready === 0 || voice.ready >= voice.total)) {
    return "";
  }
  let words: string;
  if (quiet) {
    words = `${quietVoiceText(voice)} ${momentPhrases(voiceTone(voice), "nudge").length ? "Generate them" : "Add a back to work line"}, or pick another voice.`;
  } else if (!voice.selectable) {
    const nudge = momentPhrases(voiceTone(voice), "nudge");
    const done = nudge.filter((phrase) => clipForPhrase(voice, phrase)).length;
    words = `${voice.name} can't be picked yet: ${done} of ${nudge.length} back to work lines are ready. Generate the rest to use this voice.`;
  } else {
    const silent = voiceSilentMoments(voice);
    if (silent.length === 0) {
      return "";
    }
    words = `${voice.name} has no lines for ${new Intl.ListFormat("en-GB").format(silent)}, so ${voice.name} stays silent at those moments. Generate them to hear ${voice.name} there.`;
  }
  const action =
    where === "start"
      ? `<button class="small-button" type="button" data-action="open-voice-from-start">Open voice settings</button>`
      : voice.ready < voice.total
        ? `<button class="small-button" type="button" data-action="generate-missing" ${clipQueue?.phase === "working" ? "disabled" : ""}>Generate the missing lines</button>`
        : "";
  return `<section class="notice notice-access notice-voice-gap"><span>${escapeHtml(words)}</span>${action}</section>`;
}

export function availableVoices(): VoiceOption[] {
  const customVoices =
    voiceBackend?.profiles
      .filter((profile) => !(STARTER_PROFILE_IDS as readonly string[]).includes(profile.profile_id))
      .map((profile) => ({
        id: voiceOptionId(profile.profile_id),
        name: profile.display_name,
        ...ownLineCount(profile),
        source: "custom" as VoiceSource,
        selectable: profileToneReady(profile),
        profile,
      })) ?? [];

  return [noneVoice, ...starterVoiceOptions(), ...customVoices];
}

export function selectedVoice(): VoiceOption {
  return availableVoices().find((voice) => voice.id === draft.voiceId) ?? starterVoiceOptions()[1];
}

export function clipsVoice(): VoiceOption {
  return availableVoices().find((voice) => voice.id === clipsVoiceId) ?? starterVoiceOptions()[1];
}

function modelInstalled(): boolean {
  return Boolean(voiceBackend?.model.installed && voiceBackend.runtime.installed);
}

function ramGenerationLocked(): boolean {
  return voiceBackend?.system.has_enough_ram === false;
}

function ramLockMessage(): string {
  const system = voiceBackend?.system;
  const need = system?.min_free_ram_bytes ? formatBytes(system.min_free_ram_bytes) : "enough";
  const free = system?.available_ram_bytes != null ? formatBytes(system.available_ram_bytes) : "unknown";
  return `Free up some memory first. Lines need about ${need} free; this computer has ${free}.`;
}

/** What stops a line being generated right now, from the live engine and memory checks. */
export function clipGenerateLockTitle(voice: VoiceOption): string {
  const engine = modelInstalled();
  const memory = !ramGenerationLocked();
  if (!engine && !memory) {
    return "Download the voice engine and free up some memory first.";
  }
  if (!engine) {
    return "Download the voice engine first.";
  }
  if (!memory) {
    return ramLockMessage();
  }
  if (!voice.profile?.reference_path) {
    return "This voice has no recording to make lines from.";
  }
  return "";
}

export function canEditPhrases(): boolean {
  return voiceBusy === null;
}

function profileById(profileId: string): VoiceProfileSummary | null {
  return voiceBackend?.profiles.find((profile) => profile.profile_id === profileId) ?? null;
}

export function upsertProfile(profile: VoiceProfileSummary): void {
  if (!voiceBackend) {
    return;
  }

  const profiles = voiceBackend.profiles.filter((item) => item.profile_id !== profile.profile_id);
  profiles.push(profile);
  profiles.sort((left, right) => left.display_name.localeCompare(right.display_name));
  voiceBackend = { ...voiceBackend, profiles };
}

function voiceOptionId(profileId: string): string {
  return `profile:${profileId}`;
}

export function normalizeStoredVoiceId(value: string): string {
  if (value === "none" || value === "starter-male" || value === "starter-female" || value.startsWith("profile:")) {
    return value;
  }
  return "starter-female";
}

export function ensureSelectedVoice(): void {
  if (draft.voiceId !== "none" && draft.voiceId !== "starter-male" && draft.voiceId !== "starter-female") {
    if (voiceBackend && !availableVoices().some((item) => item.id === draft.voiceId)) {
      draft.voiceId = "starter-female";
    }
  }
  if (!availableVoices().some((item) => item.id === clipsVoiceId)) {
    clipsVoiceId = "starter-female";
  }
  if (!clipsVoiceTouched && draft.voiceId !== "none" && availableVoices().some((item) => item.id === draft.voiceId)) {
    clipsVoiceId = draft.voiceId;
  }
}

function uniqueVoiceProfileId(name: string): string {
  const base = cleanSlug(name).slice(0, 42) || "voice";
  const existing = new Set(voiceBackend?.profiles.map((profile) => profile.profile_id) ?? []);
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function cleanSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function defaultVoiceName(): string {
  const count = voiceBackend?.profiles.length ?? 0;
  return `Custom Local ${count + 1}`;
}

function recordingDurationSeconds(): number {
  if (recordingState === "recording" && recordingStartedAtMs !== null) {
    return (Date.now() - recordingStartedAtMs) / 1000;
  }
  return recordedVoice?.seconds ?? 0;
}

export function bumpClipAsset(path: string): void {
  clipAssetRevision.set(path, Date.now());
  waveformFailed.delete(path);
  for (const key of [...waveformPeaks.keys()]) {
    if (key.startsWith(`${path}:`)) {
      waveformPeaks.delete(key);
    }
  }
  waveformPending.delete(path);
  if (voicePreviewPath === path) {
    stopVoicePreview();
  }
}

function clipAssetUrl(path: string): string {
  let src = path;
  try {
    src = convertFileSrc(path);
  } catch {
    src = path;
  }
  const rev = clipAssetRevision.get(path);
  return rev ? `${src}?v=${rev}` : src;
}

function voiceBusyTitle(): string {
  switch (voiceBusy) {
    case "download-model":
      return "Downloading the voice engine";
    case "delete-model":
      return "Deleting the voice engine";
    case "delete-voice":
      return "Deleting voice";
    default:
      return "Working";
  }
}

function voiceBusyCopy(): string {
  if (voiceBusy === "download-model") {
    return "The voice engine is large. Supervisor goes back to using little memory once the line is generated.";
  }
  return "Local voice files are being updated.";
}

export async function voiceAction(action: string, source?: HTMLElement): Promise<void> {
  if (action === "voice-info") {
    const voiceId = source?.dataset.voiceId;
    if (!voiceId) {
      return;
    }
    // Redraws the voice page itself only if the voices changed under it.
    await refreshVoiceStatus();
    if (voiceInfoId !== voiceId) {
      stopVoicePreview();
    }
    voiceInfoId = voiceId;
    paintVoiceLayer();
    return;
  }

  if (action === "close-voice-info") {
    dismissVoiceInfo();
    paintVoiceLayer();
    return;
  }

  if (action === "toggle-voice-preview") {
    await toggleVoicePreview();
    return;
  }

  if (action === "play-clip") {
    const path = source?.dataset.clipPath;
    if (path) {
      await playClip(path);
    }
    return;
  }

  if (action === "check-ram") {
    await refreshVoiceStatus(true);
    return;
  }

  if (/^(open|close)-(voice-help|model-info|memory-info)$/.test(action)) {
    voiceDialog = action.startsWith("open-") ? (action.slice(5) as typeof voiceDialog) : null;
    paintVoiceLayer();
    return;
  }

  if (action === "select-voice") {
    const voiceId = source?.dataset.voiceId;
    const voice = voiceId ? availableVoices().find((item) => item.id === voiceId) : null;
    if (voice?.selectable && voice.id !== draft.voiceId) {
      pickWhenReady = null;
      pickVoice(voice);
    }
    return;
  }

  if (action === "download-model-pack") {
    await startModelDownload();
    return;
  }

  if (action === "cancel-model-download") {
    await cancelModelDownload();
    return;
  }

  if (action === "close-model-download") {
    dismissDownloadModal();
    return;
  }

  if (action === "record-voice") {
    if (!modelInstalled()) {
      showFeedback("Download the voice engine first");
      return;
    }
    openRecordingDialog();
    return;
  }

  if (action === "ask-delete-model") {
    dismissVoiceInfo();
    modelDeleteOpen = true;
    paintVoiceLayer();
    return;
  }

  if (action === "cancel-delete-model") {
    modelDeleteOpen = false;
    paintVoiceLayer();
    return;
  }

  if (action === "delete-model-files") {
    modelDeleteOpen = false;
    await runVoiceBusy("delete-model", async () => {
      const model = await invoke<VoiceModelStatus>("delete_voice_cloning_model");
      if (voiceBackend) {
        voiceBackend = { ...voiceBackend, model };
      }
      await refreshVoiceStatus(false);
      showFeedback("Voice engine deleted");
    });
    return;
  }

  if (action === "set-up-clips") {
    clearFailedQueue();
    clipsVoiceId = source?.dataset.voiceId ?? clipsVoiceId;
    clipsVoiceTouched = true;
    closeToneForms();
    render();
    document.querySelector(".phrase-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    // The card can't be picked yet; say why, and pick it once its lines are made.
    const voice = clipsVoice();
    pickWhenReady = voice.id;
    showFeedback(`Generate ${voice.name}'s back to work lines below. ${voice.name} is picked once they're ready.`, 5000);
    return;
  }

  if (action === "close-recording") {
    await closeRecordingDialog();
    return;
  }

  if (action === "start-recording") {
    await startVoiceRecording();
    return;
  }

  if (action === "stop-recording") {
    await stopVoiceRecording();
    return;
  }

  if (action === "rerecord-voice") {
    resetRecordedVoice();
    await clearVoiceRecording();
    await startVoiceRecording();
    return;
  }

  if (action === "save-recorded-voice") {
    await saveRecordedVoice();
    return;
  }

  if (action === "confirm-delete-voice") {
    voicePreviewAudio?.pause();
    voiceDeleteTargetId = source?.dataset.profileId || null;
    paintVoiceLayer();
    return;
  }

  if (action === "cancel-delete-voice") {
    voiceDeleteTargetId = null;
    paintVoiceLayer();
    return;
  }

  if (action === "delete-voice-profile") {
    await deleteVoiceProfile();
    return;
  }

  if (action === "delete-voice-files") {
    await deleteVoiceFilesOnly();
    return;
  }
}

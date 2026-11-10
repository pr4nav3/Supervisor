import { invoke } from "@tauri-apps/api/core";
import type { CurrentSession, SessionSettings, WebcamFrame } from "../core/types";
import { errorText, escapeHtml, showFeedback } from "../core/dom";
import { activeTab, setSettings, setSettingsView, settings, settingsView, snapshot } from "../core/state";
import { render } from "../core/shell";
import { captureAccess } from "./firstRun";

let webcamFrame: WebcamFrame | null = null;
export let webcamError = "";
/** The last camera error said as a toast, so a repeating one is said once until it clears. */
let lastWebcamToast = "";
/** When the session's camera last stopped sending pictures; 0 while it sends them. */
let cameraDownSince = 0;
/** The worker said the GPU could not run the models this run; the app runs them on the processor instead. */
let webcamGpuFailed = false;
const GPU_FALLBACK_COPY = "The GPU couldn't run the webcam models, so they're running on the processor instead.";
let webcamHitStreak = 0;
let webcamAlarmAtMs = 0;
let webcamPreviewStarted = false;
/** Camera names in the order the worker opens them (empty where the OS gives none). */
let webcamCameras: string[] = [];

export const CAMERA_DOWN_COPY = "The camera isn't sending pictures, so your phone isn't being checked.";

/** The session runs the camera and no picture has come for 30 s. The worker takes seconds to
 *  start and restarts itself after a failure, so a shorter gap says nothing; a toast said once
 *  is easy to miss, so this lasts as long as the camera is out. */
export function cameraDown(current: CurrentSession): boolean {
  const wanted = settings.webcam_enabled && (current.status === "active" || current.status === "snoozed");
  if (!wanted || current.camera.live) {
    cameraDownSince = 0;
    return false;
  }
  cameraDownSince ||= Date.now();
  return Date.now() - cameraDownSince > 30_000;
}

export function renderWebcamSettings(): string {
  const frame = webcamFrame;
  const alerting = webcamWouldAlert(frame);
  return `
    <section class="webcam-page">
      <div class="subpage-head">
        <button type="button" data-action="back-settings">Back</button>
        <div>
          <p class="eyebrow">WEBCAM</p>
          <h2>Live camera check</h2>
        </div>
      </div>

      <section class="webcam-home">
        <section class="state-slab webcam-stage ${webcamStateClass(frame, alerting)}" aria-live="polite">
          <h2 id="webcam-title">${escapeHtml(webcamTitle(frame, alerting))}</h2>
          <p id="webcam-copy">${escapeHtml(webcamCopy(frame, alerting))}</p>
          <div class="webcam-frame-wrap${frame?.jpeg && settings.webcam_enabled ? " is-live" : ""}" id="webcam-frame-wrap">
            <img id="webcam-preview" alt="" />
            <p id="webcam-waiting" class="webcam-waiting">${escapeHtml(webcamWaitingCopy())}</p>
          </div>
          <p id="webcam-live-error" class="webcam-live-error"${settings.webcam_enabled && webcamError ? "" : " hidden"}>${escapeHtml(webcamError)}</p>
        </section>

        <div class="webcam-side">
          <section class="panel">
            <p class="eyebrow">Settings</p>
            <label class="setting-row toggle-row">
              <span>Turn on webcam models</span>
              <span class="toggle-field">
                <input id="webcam-phone-use" class="toggle-input" type="checkbox" ${settings.webcam_enabled ? "checked" : ""} aria-label="Turn on webcam models" />
                <span class="toggle-track" aria-hidden="true"><span class="toggle-knob"></span></span>
              </span>
            </label>
            <label class="setting-row toggle-row">
              <span>Run on GPU</span>
              <span class="toggle-field">
                <input id="webcam-gpu" class="toggle-input" type="checkbox" ${settings.webcam_gpu ? "checked" : ""} aria-label="Run on GPU" />
                <span class="toggle-track" aria-hidden="true"><span class="toggle-knob"></span></span>
              </span>
            </label>
            <small id="webcam-gpu-note" class="field-help is-bad"${webcamGpuFailed && settings.webcam_gpu ? "" : " hidden"}>${GPU_FALLBACK_COPY}</small>
            <label class="setting-row camera-row">
              <span>Camera</span>
              <select id="webcam-camera" aria-label="Camera">${cameraOptions()}</select>
            </label>
          </section>
          <section class="panel webcam-test-panel">
            <p class="eyebrow">Camera test</p>
            ${renderWebcamMetrics(frame)}
            <p class="webcam-note">No images saved. The models run only on this computer and need ${osFloor()}.</p>
          </section>
        </div>
      </section>
    </section>
  `;
}

/** The oldest system the frozen webcam worker runs on (its OpenCV and numpy builds set it). */
function osFloor(): string {
  const mac = captureAccess ? captureAccess.platform === "macos" : /Mac/.test(navigator.platform);
  return mac ? "macOS 14 or later" : "Windows 10 or later";
}

/** Named cameras where the OS lists them; otherwise the first four indexes. The saved one always shows. */
function cameraOptions(): string {
  const names = webcamCameras.length ? [...webcamCameras] : [0, 1, 2, 3].map((index) => `Camera ${index}`);
  while (names.length <= settings.webcam_camera) {
    names.push(`Camera ${names.length}`);
  }
  return names
    .map((name, index) => `<option value="${index}" ${settings.webcam_camera === index ? "selected" : ""}>${escapeHtml(name)}</option>`)
    .join("");
}

async function refreshCameras(): Promise<void> {
  try {
    webcamCameras = await invoke<string[]>("list_cameras");
  } catch {
    webcamCameras = [];
  }
  const select = document.getElementById("webcam-camera");
  if (select) {
    select.innerHTML = cameraOptions();
  }
}

/** Two plain readings. The dot goes green with a face in view and red with a phone or watch. */
function renderWebcamMetrics(frame: WebcamFrame | null): string {
  const face = Boolean(frame?.face_in_frame);
  const phone = Boolean(frame?.phone_in_frame);
  return `
    <dl class="webcam-metrics"${settings.webcam_enabled ? "" : " hidden"}>
      <div class="${face ? "is-good" : ""}"><dt>Face</dt><dd>${face ? "In view" : "Out of view"}</dd></div>
      <div class="${phone ? "is-bad" : ""}"><dt>Phone or watch</dt><dd>${phone ? "Seen" : "Not seen"}</dd></div>
    </dl>
  `;
}

/** Saved, because sessions run the webcam only when this is on. */
export async function setWebcamEnabled(enabled: boolean): Promise<void> {
  const was = settings.webcam_enabled;
  settings.webcam_enabled = enabled;
  webcamHitStreak = 0;
  try {
    setSettings(await invoke<SessionSettings>("update_settings", {
      update: { webcam_enabled: enabled },
    }));
    webcamError = "";
  } catch (error) {
    // A toast, not the error line: that line is hidden while the switch is off, which is
    // where a failed save to turn it on leaves it.
    settings.webcam_enabled = was;
    showFeedback(`Couldn't save that: ${errorText(error)}`, 4000);
    const box = document.getElementById("webcam-phone-use") as HTMLInputElement | null;
    if (box) {
      box.checked = was;
    }
  }
  // The first run's switch shares this; only the Webcam page shows a preview.
  if (settings.webcam_enabled) {
    if (settingsView === "webcam" && activeTab === "settings") {
      void startWebcamPreview();
    }
  } else {
    void stopWebcamPreview();
  }
  paintWebcamDom();
}

export async function setWebcamGpu(enabled: boolean): Promise<void> {
  await updateWebcamWorkerSetting({ webcam_gpu: enabled }, () => {
    const box = document.getElementById("webcam-gpu") as HTMLInputElement | null;
    if (box) {
      box.checked = settings.webcam_gpu;
    }
    paintWebcamDom();
  });
}

export async function setWebcamCamera(camera: number): Promise<void> {
  await updateWebcamWorkerSetting({ webcam_camera: camera }, () => {
    const select = document.getElementById("webcam-camera") as HTMLSelectElement | null;
    if (select) {
      select.value = String(settings.webcam_camera);
    }
  });
}

/** A setting the worker reads at launch: a running preview restarts. On failure the control is put back. */
async function updateWebcamWorkerSetting(update: Partial<SessionSettings>, revert: () => void): Promise<void> {
  try {
    setSettings(await invoke<SessionSettings>("update_settings", { update }));
    if (webcamPreviewStarted) {
      await stopWebcamPreview();
      webcamFrame = null;
      await startWebcamPreview();
    }
    webcamError = "";
  } catch (error) {
    webcamError = errorText(error);
    revert();
  }
  paintWebcamDom();
}

async function startWebcamPreview(): Promise<void> {
  if (webcamPreviewStarted) {
    return;
  }
  try {
    await invoke("start_webcam_preview");
    if (settingsView !== "webcam" || activeTab !== "settings") {
      await invoke("stop_webcam_preview");
      return;
    }
    webcamPreviewStarted = true;
    webcamError = "";
  } catch (error) {
    webcamPreviewStarted = false;
    webcamError = errorText(error);
    render();
  }
}

export async function stopWebcamPreview(): Promise<void> {
  webcamPreviewStarted = false;
  webcamHitStreak = 0;
  try {
    await invoke("stop_webcam_preview");
  } catch {
    // Worker may already be gone.
  }
}

export function applyWebcamFrame(frame: WebcamFrame): void {
  if (frame.error) {
    if (frame.error.includes("GPU mode") && !webcamGpuFailed) {
      webcamGpuFailed = true;
      showFeedback(GPU_FALLBACK_COPY, 5000);
    }
    webcamError = frame.error.includes("GPU mode") ? GPU_FALLBACK_COPY : frame.error;
    if (!frame.jpeg) {
      webcamHitStreak = 0;
      // The last picture is stale now; the stage says what happened instead.
      webcamFrame = null;
      const onWebcamPage = settingsView === "webcam" && activeTab === "settings";
      if (onWebcamPage) {
        paintWebcamDom();
      } else if (snapshot?.current && webcamError !== lastWebcamToast && !frame.error.includes("stopped") && !frame.error.includes("GPU mode")) {
        // A session wanted the camera and it isn't working: say so once, wherever the user is.
        // A stopped worker restarts by itself and a GPU failure has its own toast.
        lastWebcamToast = webcamError;
        showFeedback(`Webcam: ${webcamError}`, 6000);
      }
      return;
    }
  } else {
    webcamError = "";
    lastWebcamToast = "";
  }
  webcamFrame = frame;
  const alerting = webcamWouldAlert(frame);
  if (frame.detected !== false) {
    webcamHitStreak = alerting ? webcamHitStreak + 1 : 0;
  }
  // During a session the session nudges, through the same voice and popup as everything else.
  if (webcamHitStreak >= 8 && !snapshot?.current) {
    void fireWebcamAlert();
  }
  if (settingsView === "webcam" && activeTab === "settings") {
    paintWebcamDom();
  }
}

export function paintWebcamDom(): void {
  const frame = webcamFrame;
  const alerting = webcamWouldAlert(frame);
  const img = document.getElementById("webcam-preview") as HTMLImageElement | null;
  const wrap = document.getElementById("webcam-frame-wrap");
  // A frame from before the switch went off is not shown as live.
  if (img && frame?.jpeg && settings.webcam_enabled) {
    img.src = `data:image/jpeg;base64,${frame.jpeg}`;
    img.alt = "Webcam preview";
    wrap?.classList.add("is-live");
  } else {
    wrap?.classList.remove("is-live");
    if (img) {
      img.removeAttribute("src");
      img.alt = "";
    }
  }
  const title = document.getElementById("webcam-title");
  if (title) {
    title.textContent = webcamTitle(frame, alerting);
  }
  const copy = document.getElementById("webcam-copy");
  if (copy) {
    copy.textContent = webcamCopy(frame, alerting);
  }
  const waiting = document.getElementById("webcam-waiting");
  if (waiting) {
    waiting.textContent = webcamWaitingCopy();
  }
  const slab = document.querySelector(".webcam-stage");
  if (slab) {
    slab.className = `state-slab webcam-stage ${webcamStateClass(frame, alerting)}`;
  }
  const liveError = document.getElementById("webcam-live-error");
  if (liveError) {
    liveError.textContent = webcamError;
    liveError.hidden = !(settings.webcam_enabled && webcamError);
  }
  const gpuNote = document.getElementById("webcam-gpu-note");
  if (gpuNote) {
    gpuNote.hidden = !(webcamGpuFailed && settings.webcam_gpu);
  }
  const metrics = document.querySelector(".webcam-metrics");
  if (metrics) {
    metrics.outerHTML = renderWebcamMetrics(frame);
  }
}

function webcamWouldAlert(frame: WebcamFrame | null): boolean {
  return frame !== null && settings.webcam_enabled && frame.phone_in_frame;
}

/** Red with a phone out, green with someone in frame, plain otherwise. */
function webcamStateClass(frame: WebcamFrame | null, alerting: boolean): string {
  if (alerting) {
    return "state-distracted";
  }
  return frame?.face_in_frame ? "state-focused" : "";
}

function webcamWaitingCopy(): string {
  if (!settings.webcam_enabled) {
    return "Camera off";
  }
  if (webcamError) {
    return "Camera unavailable";
  }
  return "Starting camera";
}

function webcamTitle(frame: WebcamFrame | null, alerting: boolean): string {
  if (!settings.webcam_enabled) {
    return "Webcam models off";
  }
  if (!frame) {
    return "Webcam models on";
  }
  if (alerting) {
    return "Phone or watch in view";
  }
  return frame.face_in_frame ? "In frame" : "Out of frame";
}

function webcamCopy(frame: WebcamFrame | null, alerting: boolean): string {
  if (!settings.webcam_enabled) {
    return "Turn them on to get a reminder when your phone or watch comes out.";
  }
  if (!frame) {
    return "Waiting for the first picture.";
  }
  if (alerting) {
    return "Your phone or watch is out.";
  }
  return frame.face_in_frame ? "You're in view, no phone or watch seen." : "Sit in view of the webcam.";
}

async function fireWebcamAlert(): Promise<void> {
  const now = Date.now();
  if (now - webcamAlarmAtMs < 8000) {
    return;
  }
  webcamAlarmAtMs = now;
  playWebcamAlarm();
}

function playWebcamAlarm(): void {
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "square";
  oscillator.frequency.value = 880;
  oscillator.connect(gain);
  gain.connect(context.destination);
  gain.gain.setValueAtTime(0.08, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.28);
  oscillator.onended = () => void context.close();
  oscillator.start();
  oscillator.stop(context.currentTime + 0.28);
}

export async function webcamAction(action: string, source?: HTMLElement): Promise<void> {
  if (action === "open-webcam-settings") {
    setSettingsView("webcam");
    webcamError = "";
    render();
    void refreshCameras();
    // The backend turns the camera on for a preview: with the switch off it stays off.
    if (settings.webcam_enabled) {
      await startWebcamPreview();
    }
    return;
  }
}

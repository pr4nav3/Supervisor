import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AppRule, CurrentSession, NudgeVoice, PhraseLibraryState, SessionSettings, SessionSnapshot,
  SessionSummary, StorageNotice, Strictness, Tab, WebcamFrame,
} from "./core/types";
import { app, appView, composing, errorText, escapeHtml, showFeedback } from "./core/dom";
import {
  activeTab, clearLastError, draft, history, knownHistoryIds, lastError, setActiveTab, setAppNames,
  setHistory, setLastError, setLastSessionId, setSettings, setSettingsView, setSiteNames,
  setSnapshot, setTheme, settings, settingsView, snapshot, theme,
} from "./core/state";
import {
  captureUiState, invokeSnapshot, reconcilePolling, refreshSnapshot, restoreUiState, wire,
} from "./core/shell";
import { EYE_SVG } from "./core/cards";
import { flippedStats } from "./screens/report";
import { refreshTrends, trends, trendsAction } from "./screens/trends";
import {
  applyWebcamFrame, cameraDown, paintWebcamDom, setWebcamCamera, setWebcamEnabled, setWebcamGpu,
  stopWebcamPreview, webcamAction,
} from "./screens/webcam";
import {
  distractionDismissedFor, distractionIsActive, distractionLatchKey, momentCardActive,
  momentShownAt, overlayAction, overlayMoreOpen, overlayPlacement, renderInterruptVoice,
  renderOverlay, setOverlayMoreOpen, setOverlayVoice, syncOverlayPlacement,
} from "./screens/overlay";
import {
  closeFirstRun, currentFirstRunStep, discardPractice, FIRST_RUN_KEY, firstRunAction, firstRunOpen,
  onboardingVisible, paintFirstRunLive, practice, PRACTICE_KEY, practiceIds, refreshCaptureAccess,
  renderFirstRun, setFirstRunOpen, setFirstRunStep, setPractice, setPracticeQuietUntil,
} from "./screens/firstRun";
import {
  handleRuleAction, paintRuleEditorHost, paintRuleEditorLive, renderRulePreview, ruleEditor,
  saveRuleForm, scheduleRulePreview, setPermanentRules, setRuleEditor,
} from "./screens/rules";
import { bindPreflight, preflightAction, preflightOpen, setPreflightOpen } from "./screens/preflight";
import {
  renderSettings, settingsAction, updateDefaultStrictness, updateStatusWindowEnabled,
} from "./screens/settings";
import {
  bindClipsControls, bindPhraseEditor, clipQueue, closeToneForms, leaveVoiceScreen, linesAction,
  newToneDraft, paintClipsPanel, phraseBank, phraseEditor, setCustomPhrases, setCustomPhraseSets,
  setHiddenPhrases, setNewToneDraft, setPhraseEditor, setPhraseOverrides, toneDeleteArmed,
  toneMenuOpen, toneRename,
} from "./screens/lines";
import {
  announceNudge, bindVoicePreview, bindVoiceWaveforms, closeRecordingDialog, dismissDownloadModal,
  dismissVoiceInfo, ensureSelectedVoice, fitVoiceCardNames, modelDeleteOpen, normalizeStoredVoiceId,
  nudgeAudio, paintPlayingClip, paintVoiceLayer, recordedVoice, recordingOpen, refreshVoiceDownload,
  refreshVoiceStatus, renderVoiceDialogs, setModelDeleteOpen, setVoiceDeleteTargetId,
  setVoiceDialog, voiceAction, voiceBusy, voiceDeleteTargetId, voiceDialog, voiceDownload,
  voiceError, voiceInfoId,
} from "./screens/voice";
import {
  animateOnArrival, appEdit, appEditTitle, closeWeekPicker, fitShareStats, historyAction,
  historyConfirm, historySearch, historyView, historyWeek, historyWeekStart, noteNewHistory,
  openHistoryReport, paintModalLayer, paintWeekPicker, refreshHistoryWeek, renderHistory,
  renderModalLayer, saveAppEdit, scheduleHistorySearch, sessionReport, setAppEdit,
  setHistoryConfirm, setHistorySearch, setHistoryView, setSessionReport, setShareOpen, shareOpen,
  weekPickerOpen, weekRecap,
} from "./screens/history";
import {
  bindSessionReview, breakOverLine, liveTimer, paintReviewLayer, paintSessionRulesLayer, paintSoFar,
  playMoment, playNudge, playSessionOver, quitConfirmOpen, renderSession, sessionAction,
  sessionOver, sessionReview, sessionRulesOpen, setQuitConfirmOpen, setSessionOver,
  setSessionReview, setSessionRulesOpen, stateClass, stateTitle, statusChip,
} from "./screens/session";
import { dayCardKey, fitQuote, homeAction, homeTip, renderStreakChip } from "./screens/home";

wire({ applySnapshot, bindEvents, editorIsOpen, refreshSnapshotNow, render, runAction });

document.documentElement.dataset.theme = theme;
window.addEventListener("storage", (event) => {
  if (event.key !== "supervisor-theme") {
    return;
  }
  setTheme(event.newValue === "dark" ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  bindVoiceWaveforms();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeTopLayer();
  }
});
let historyHydrated = false;
let paintedViewKey = "";
/** History's data is loading after a tab switch; the poll leaves the page to that one draw. */
let historyArriving = false;

async function init(): Promise<void> {
  render();
  try {
    const [loadedSettings, loadedHistory, loadedRules, loadedPhraseLibrary, loadedSiteNames, loadedAppNames] = await Promise.all([
      invoke<SessionSettings>("get_settings"),
      invoke<SessionSummary[]>("get_history"),
      invoke<AppRule[]>("get_rules"),
      invoke<PhraseLibraryState>("get_phrase_library"),
      invoke<Record<string, string>>("get_site_names"),
      invoke<Record<string, string>>("get_app_names"),
    ]);
    setSettings(loadedSettings);
    setSiteNames(loadedSiteNames);
    setAppNames(loadedAppNames);
    setHistory(loadedHistory);
    setPermanentRules(loadedRules);
    setCustomPhraseSets(loadedPhraseLibrary.custom_tones);
    setHiddenPhrases(new Set(loadedPhraseLibrary.hidden_phrases));
    // An edited line whose bundled original is gone (the old break-over set) stays the user's.
    const bundled = new Set(phraseBank.map((phrase) => phrase.id));
    setCustomPhrases([
      ...loadedPhraseLibrary.custom_phrases,
      ...loadedPhraseLibrary.phrase_overrides.filter((phrase) => !bundled.has(phrase.id)),
    ]);
    setPhraseOverrides(Object.fromEntries(
      loadedPhraseLibrary.phrase_overrides.filter((phrase) => bundled.has(phrase.id)).map((phrase) => [phrase.id, phrase]),
    ));
    // Every past session is known, except the newest one no report was ever offered for: a
    // session ended by quitting, or finished while the window was away, is offered on launch.
    const offered = Number(localStorage.getItem("review.lastOffered") ?? "0");
    history.forEach((item, index) => {
      if (index > 0 || item.id <= offered) {
        knownHistoryIds.add(item.id);
      }
    });
    void refreshCaptureAccess();
    // Coming back from System Settings is when a permission changes.
    window.addEventListener("focus", () => void refreshCaptureAccess());
    draft.strictness = loadedSettings.default_strictness;
    draft.voiceId = normalizeStoredVoiceId(loadedSettings.voice_profile);
    // A practice the app closed on: never offered as a report, ended and removed now.
    const stalePractice = Number(localStorage.getItem(PRACTICE_KEY) ?? "0");
    if (stalePractice) {
      practiceIds.add(stalePractice);
      knownHistoryIds.add(stalePractice);
      void (async () => {
        try {
          const now = await invoke<SessionSnapshot>("get_session_snapshot");
          if (now.current?.id === stalePractice) {
            setPracticeQuietUntil(Date.now() + 5000);
            await invoke("stop_session");
          }
        } catch {
          // Removed below either way.
        }
        await discardPractice(stalePractice);
      })();
    }
    // The first launch opens the first run; after that it waits on Home's Getting started line.
    if (appView === "main" && history.length === 0 && localStorage.getItem(FIRST_RUN_KEY) !== "1") {
      setFirstRunOpen(true);
    }
  } catch (error) {
    setLastError(errorText(error));
  }

  if (appView === "main") {
    await listen<WebcamFrame>("webcam-frame", (event) => {
      applyWebcamFrame(event.payload);
    });
    // A rule saved elsewhere (the timer window's Always allow or block) must reach this copy.
    await listen("rules-changed", async () => {
      setPermanentRules(await invoke<AppRule[]>("get_rules"));
      render();
    });
    // The daily check found and installed a new worker build.
    await listen("voice-engine-updated", async () => {
      await refreshVoiceStatus(false);
      showFeedback("Voice engine updated", 3000);
    });
    // The backend sends this once per nudge, the moment it is due (a webview timer would be
    // throttled while the window is minimized).
    await listen("session-nudge", async () => {
      // Past the poll's in-flight guard: the line must come from the snapshot with this nudge.
      await refreshSnapshotNow();
      void playNudge(snapshot?.current ?? null);
      paintFirstRunLive(snapshot?.current ?? null);
    });
    // These read the fresh snapshot, so they skip the poll's in-flight guard.
    await listen<string>("session-moment", async (event) => {
      await refreshSnapshotNow();
      void playMoment(event.payload);
    });
    // Sent once when a session ends, whether it ran out or was ended early.
    await listen("session-end", async () => {
      await refreshSnapshotNow();
      void playSessionOver();
    });
    // Quit from the tray with a session running: ask first.
    await listen("quit-requested", () => {
      setQuitConfirmOpen(true);
      paintModalLayer();
    });
    // The card's orb: stop the line, or hear it again.
    await listen<string>("nudge-control", (event) => {
      if (!nudgeAudio) {
        return;
      }
      if (event.payload === "stop") {
        nudgeAudio.pause();
      } else {
        nudgeAudio.currentTime = 0;
        void nudgeAudio.play().then(() => announceNudge(true)).catch(() => announceNudge(false));
      }
    });
  }
  if (appView === "overlay") {
    // A card due while this window is hidden: its own 1 s timer is throttled, the push is not.
    for (const name of ["session-nudge", "session-moment"]) {
      await listen(name, async () => {
        await refreshSnapshotNow();
        render();
      });
    }
    await listen<NudgeVoice>("nudge-voice", (event) => {
      setOverlayVoice({ ...event.payload, at: Date.now() });
      const moment = momentCardActive(snapshot?.current ?? null);
      if (!moment && !distractionIsActive()) {
        return;
      }
      // Speaking or done: swap the voice row alone, so the card's own entrance (a new tomato
      // dropping in) doesn't replay. The row's first appearance needs the card rebuilt.
      const row = document.querySelector(".interrupt-voice");
      const html = moment ? renderInterruptVoice(momentShownAt) : renderInterruptVoice();
      if (!row || !html.trim()) {
        render();
        return;
      }
      const holder = document.createElement("div");
      holder.innerHTML = html;
      const next = holder.firstElementChild;
      if (next) {
        row.replaceWith(next);
        bindEvents(next);
      }
    });
  }
  await refreshSnapshot();
  historyHydrated = true;

  if (appView === "main") {
    // One rebuild once the focus days and the voice list are both in, so the calendar pops in
    // with its data, once.
    void Promise.all([refreshTrends(false), refreshVoiceStatus(false)]).then(() => render());
    void refreshVoiceDownload(false);
  }
}

/** Takes a snapshot in, from the poll or from a command's reply. A session that just ended
 *  opens its report and review once, from whichever arrives first; while a dialog or editor is
 *  open it stays pending and opens when the next snapshot finds the way clear. True when the
 *  report is opening (the caller draws nothing). */
export function applySnapshot(next: SessionSnapshot): boolean {
  setSnapshot(next);
  if (next.current) {
    setLastSessionId(next.current.id);
  }
  if (!next.current && sessionRulesOpen) {
    setSessionRulesOpen(false);
    setRuleEditor(null);
  }
  // The session ended on its own while Quit was asking: there is nothing left to end.
  if (!next.current) {
    setQuitConfirmOpen(false);
  }
  // The practice ended without the first run ending it (End session, or it ran out).
  if (practice && next.current?.id !== practice.id) {
    const run = practice;
    setPractice(null);
    setPracticeQuietUntil(Date.now() + 5000);
    if (run.caught) {
      setFirstRunStep("done");
    }
    void discardPractice(run.id);
  }
  const newest = noteNewHistory(history);
  if (!newest || !historyHydrated) {
    return false;
  }
  if (practiceIds.has(newest)) {
    knownHistoryIds.add(newest);
    return false;
  }
  if (appView !== "main" || next.current) {
    // The status window never shows reports; a new session already running has moved on.
    knownHistoryIds.add(newest);
    return false;
  }
  // Not while a dialog or editor is open: a recording or clip job would vanish behind History.
  if (!editorIsOpen()) {
    void openHistoryReport(newest, true);
    return true;
  }
  return false;
}

export async function refreshSnapshotNow(): Promise<void> {
  try {
    const next = await invoke<SessionSnapshot>("get_session_snapshot");
    if (applySnapshot(next)) {
      return;
    }
    if (appView === "main") {
      ensureSelectedVoice();
      if (activeTab === "history" && history[0] && !knownHistoryIds.has(history[0].id)) {
        knownHistoryIds.add(history[0].id);
        void refreshTrends(false);
        void refreshHistoryWeek();
      }
    }
    historyHydrated = true;
    setLastError("");
  } catch (error) {
    setLastError(errorText(error));
  }

  const webcamOpen = appView === "main" && activeTab === "settings" && settingsView === "webcam";
  if (!webcamOpen) {
    const current = snapshot?.current ?? null;
    // While something is being edited or typed into, only paint in place. The rebuild
    // waits for the next tick after the editor closes or the field loses focus.
    if (editorIsOpen() || typingInField() || historyArriving || viewKey() === paintedViewKey) {
      paintLive(current);
    } else {
      render();
    }
  }
  reconcilePolling();
}

function closeTopLayer(): void {
  clearLastError();
  if (voiceBusy === "download-model" && ["complete", "cancelling", "error"].includes(voiceDownload?.phase ?? "")) {
    dismissDownloadModal();
    return;
  }
  if (sessionOver) {
    setSessionOver(null);
    paintModalLayer();
    return;
  }
  if (shareOpen) {
    setShareOpen(false);
    paintModalLayer();
    return;
  }
  // The delete confirm sits over the engine popup: it closes first.
  if (modelDeleteOpen) {
    setModelDeleteOpen(false);
    paintVoiceLayer();
    return;
  }
  if (voiceDialog) {
    setVoiceDialog(null);
    paintVoiceLayer();
    return;
  }
  if (newToneDraft !== null) {
    setNewToneDraft(null);
    paintVoiceLayer();
    return;
  }
  if (toneMenuOpen || toneRename || toneDeleteArmed) {
    closeToneForms();
    paintClipsPanel();
    return;
  }
  if (voiceBusy) {
    return;
  }
  if (appEdit) {
    setAppEdit(null);
    paintModalLayer();
    return;
  }
  if (ruleEditor) {
    setRuleEditor(null);
    paintRuleEditorHost();
    return;
  }
  if (phraseEditor) {
    setPhraseEditor(null);
    paintVoiceLayer();
    return;
  }
  if (quitConfirmOpen) {
    setQuitConfirmOpen(false);
    paintModalLayer();
    return;
  }
  if (historyConfirm) {
    setHistoryConfirm(null);
    paintModalLayer();
    return;
  }
  if (voiceDeleteTargetId) {
    setVoiceDeleteTargetId(null);
    paintVoiceLayer();
    return;
  }
  if (voiceInfoId) {
    dismissVoiceInfo();
    paintVoiceLayer();
    return;
  }
  if (recordingOpen) {
    void closeRecordingDialog();
    return;
  }
  if (sessionRulesOpen) {
    setSessionRulesOpen(false);
    setRuleEditor(null);
    paintSessionRulesLayer();
    return;
  }
  // Escape skips the first run, but never walks out on a practice that is running.
  if (firstRunOpen) {
    if (!practice) {
      closeFirstRun();
    }
    return;
  }
  if (preflightOpen) {
    setPreflightOpen(false);
    setRuleEditor(null);
    animateOnArrival("session");
    render();
    return;
  }
  if (sessionReview) {
    // Like Ask me later: nothing saved.
    setSessionReview(null);
    paintReviewLayer();
    return;
  }
  if (historyView === "report" || historyView === "trends") {
    setHistoryView("list");
    setSessionReport(null);
    setHistoryConfirm(null);
    animateOnArrival("history");
    void refreshHistoryWeek();
    return;
  }
  if (weekPickerOpen) {
    closeWeekPicker();
    paintWeekPicker();
    return;
  }
  if (activeTab === "history" && historySearch) {
    setHistorySearch("");
    const input = document.querySelector<HTMLInputElement>("#history-search");
    if (input) {
      input.value = "";
    }
    scheduleHistorySearch();
    return;
  }
  if (overlayMoreOpen) {
    setOverlayMoreOpen(false);
    render();
    return;
  }
  if (appView === "main" && activeTab === "settings" && settingsView !== "home") {
    void runAction("back-settings");
  }
}

export function editorIsOpen(): boolean {
  return (
    firstRunOpen ||
    preflightOpen ||
    sessionRulesOpen ||
    ruleEditor !== null ||
    appEdit !== null ||
    phraseEditor !== null ||
    newToneDraft !== null ||
    toneRename !== null ||
    recordingOpen ||
    historyConfirm !== null ||
    quitConfirmOpen ||
    voiceDeleteTargetId !== null ||
    voiceInfoId !== null ||
    clipQueue?.phase === "working" ||
    voiceDialog !== null ||
    modelDeleteOpen ||
    voiceBusy !== null
  );
}

/** A focused text field or dropdown in the main window; a rebuild would drop the caret or close the list. */
function typingInField(): boolean {
  const el = document.activeElement;
  if (appView !== "main" || !el || !app.contains(el)) {
    return false;
  }
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return true;
  }
  return el instanceof HTMLInputElement && !["checkbox", "radio", "range", "button"].includes(el.type);
}

function sessionViewKey(current: CurrentSession | null): string {
  if (!current) {
    return "";
  }
  const focus = current.focus;
  const sample = focus?.sample;
  const rules = current.exceptions.map((rule) => `${rule.target}\t${rule.value}`).join("\n");
  return [
    current.id,
    current.status,
    current.goal,
    current.duration_seconds,
    current.strictness,
    current.snoozed_until_seconds ?? "",
    focus?.state ?? "",
    current.supervisor_in_front ? 1 : 0,
    current.unreadable_browser ?? "",
    focus?.distracting ? 1 : 0,
    focus?.should_nudge ? 1 : 0,
    focus?.interrupt ? 1 : 0,
    focus?.matched_rule?.value ?? "",
    sample?.app_name ?? "",
    focus?.activity.key ?? "",
    current.metrics.nudges,
    current.camera.phone ? 1 : 0,
    current.camera.phone_distracted ? 1 : 0,
    current.pomodoro ? `${current.pomodoro.round}:${current.pomodoro.phase}` : "",
    rules,
  ].join("\u001f");
}

function viewKey(): string {
  const current = snapshot?.current ?? null;
  return [
    appView,
    activeTab,
    settingsView,
    historyView,
    weekRecap?.start ?? "",
    // Other tabs show the session only in the status chip (painted in place), so a focus
    // change doesn't rebuild History or Settings.
    appView === "overlay" || activeTab === "session" ? sessionViewKey(current) : "",
    current && cameraDown(current) ? 1 : 0,
    settings.status_window_on_top ? 1 : 0,
    settings.status_window_enabled ? 1 : 0,
    draft.voiceId,
    voiceInfoId ?? "",
    overlayPlacement,
    distractionLatchKey,
    distractionDismissedFor,
    lastError,
    voiceError,
    history.length,
    // Home's Getting started line and tips follow history, permissions and settings.
    `${onboardingVisible()}${homeTip()?.id ?? ""}${firstRunOpen ? currentFirstRunStep() : ""}${practice ? `${practice.id}${practice.caught}` : ""}`,
    historyWeekStart,
    historyWeek?.sessions.length ?? "",
    sessionReport?.id ?? "",
    dayCardKey,
    trends.daily_focus.length,
    snapshot?.storage_notice?.kind ?? "",
  ].join("\u001f");
}

/** The parts of a live session that change between rebuilds, painted in place. */
function paintLive(current: CurrentSession | null): void {
  if (!current) {
    return;
  }
  paintFirstRunLive(current);
  const chip = document.querySelector<HTMLElement>(".status-chip");
  if (chip) {
    chip.textContent = statusChip(current);
  }
  const slab = document.querySelector<HTMLElement>(".active-state-card");
  if (slab) {
    slab.className = `state-slab active-state-card ${stateClass(current)}`;
    const title = slab.querySelector("h2");
    if (title) {
      title.textContent = stateTitle(current);
    }
  }
  const { label, percent } = liveTimer(current);
  document.querySelectorAll<HTMLElement>(".active-timer strong, .interrupt-time").forEach((node) => {
    node.textContent = label;
  });
  const overlayTime = document.querySelector<HTMLElement>(".overlay-progress > span");
  if (overlayTime) {
    overlayTime.textContent = `${label} left`;
  }
  const breakOver = document.querySelector<HTMLElement>(".moment-break-over .moment-goal");
  if (breakOver && current.pomodoro?.phase === "break_over") {
    breakOver.textContent = breakOverLine(current.pomodoro);
  }
  paintSoFar(current);
  document
    .querySelectorAll<HTMLElement>(".overlay-progress .progress > span")
    .forEach((node) => {
      node.style.width = `${percent}%`;
    });
}

export function render(): void {
  const current = snapshot?.current ?? null;
  const ui = captureUiState();
  if (appView === "overlay") {
    app.innerHTML = renderOverlay(current);
    bindEvents();
    syncOverlayPlacement(current);
    restoreUiState(ui);
    paintedViewKey = viewKey();
    reconcilePolling();
    return;
  }

  app.innerHTML = `
    <main class="app-shell">
      <header class="topbar">
        <div>
          <h1 class="brand">${EYE_SVG}Supervisor</h1>
        </div>
        <div class="topbar-status">
          ${current ? `<button class="status-chip" type="button" data-tab="session">${escapeHtml(statusChip(current))}</button>` : renderStreakChip()}
          <button class="theme-toggle" type="button" data-action="toggle-theme">${theme === "dark" ? "Dark" : "Light"}</button>
        </div>
      </header>

      <nav class="tabs" aria-label="Supervisor sections">
        ${tabButton("session", "Session")}
        ${tabButton("settings", "Settings")}
        ${tabButton("history", "History")}
      </nav>

      ${lastError ? `<section class="notice" id="last-error">${escapeHtml(lastError)}</section>` : ""}
      ${renderStorageNotice(snapshot?.storage_notice ?? null)}
      ${voiceError && activeTab === "settings" ? `<section class="notice">${escapeHtml(voiceError)}</section>` : ""}

      ${activeTab === "session" ? renderSession(current) : ""}
      ${activeTab === "settings" ? renderSettings() : ""}
      ${activeTab === "history" ? renderHistory() : ""}
      <div id="first-run-layer" class="slot">${renderFirstRun()}</div>
      <div id="voice-layer">${renderVoiceDialogs()}</div>
      <div id="modal-layer" class="slot">${renderModalLayer()}</div>
    </main>
  `;

  bindEvents();
  fitVoiceCardNames();
  fitQuote();
  fitShareStats();
  if (document.fonts.status !== "loaded") {
    void document.fonts.ready.then(() => {
      if (document.querySelector(".voice-card")) {
        fitVoiceCardNames();
      }
      // The webfont changes the other cards' heights, and so the room the quote has.
      fitQuote();
      fitShareStats();
    });
  }
  restoreUiState(ui);
  if (activeTab === "settings" && settingsView === "webcam") {
    paintWebcamDom();
  }
  paintedViewKey = viewKey();
  reconcilePolling();
}

/** History storage trouble, in a sentence, with what it means for this session. */
function renderStorageNotice(notice: StorageNotice | null): string {
  if (!notice) {
    return "";
  }
  const text =
    notice.kind === "reset"
      ? `Supervisor couldn't open its history, so it started a fresh one. The old file is kept at ${notice.moved_to}.`
      : notice.kind === "off"
        ? `History isn't being saved right now (${notice.reason}). Sessions still run; they just won't be kept.`
        : `Saving to history failed (${notice.reason}). The timer keeps running, but this session may be missing from History.`;
  return `<section class="notice notice-storage"><span>${escapeHtml(text)}</span><button class="small-button" type="button" data-action="dismiss-storage-notice">Dismiss</button></section>`;
}
window.addEventListener("resize", () =>
  requestAnimationFrame(() => {
    fitShareStats();
    fitQuote();
  }),
);

// The buttons of every screen, wired once per window: a redraw's markup needs no binding. A button
// inside an action card (a voice card) runs only its own action. Role=button cards take Enter and
// Space like a button.
document.addEventListener("click", (event) => {
  const target = event.target as Element;
  const tab = target.closest<HTMLElement>("[data-tab]");
  const next = tab?.dataset.tab as Tab | undefined;
  if (next && next !== activeTab) {
    clearLastError();
    animateOnArrival(next);
    const leavingWebcam = settingsView === "webcam";
    if (voiceInfoId) {
      dismissVoiceInfo();
    }
    setActiveTab(next);
    if (next !== "settings") {
      if (settingsView === "voice") {
        leaveVoiceScreen();
      }
      setSettingsView("home");
      setRuleEditor(null);
    }
    closeWeekPicker();
    if (next === "history") {
      // Fresh data first, then one draw: a second draw mid-rise would snap the bars to full height.
      historyArriving = true;
      void Promise.all([refreshTrends(false), refreshHistoryWeek(false)]).then(() => {
        historyArriving = false;
        if (activeTab === "history") {
          render();
        }
      });
    } else {
      render();
    }
    if (leavingWebcam) {
      void stopWebcamPreview();
    }
  }
  const button = target.closest<HTMLElement>("[data-action]");
  if (button && button.getAttribute("aria-disabled") !== "true") {
    void runAction(button.dataset.action || "", button);
  }
  const rule = target.closest<HTMLButtonElement>("[data-rule-action]");
  if (rule) {
    void handleRuleAction(rule);
  }
  const flip = target.closest<HTMLButtonElement>("[data-stat-flip]");
  if (flip) {
    const key = flip.dataset.statFlip ?? "";
    const flipped = !flippedStats.has(key);
    if (flipped) {
      flippedStats.add(key);
    } else {
      flippedStats.delete(key);
    }
    flip.classList.toggle("is-flipped", flipped);
    flip.setAttribute("aria-pressed", String(flipped));
  }
});
document.addEventListener("keydown", (event) => {
  const card = event.target as HTMLElement;
  if (card.matches?.("[data-action]:not(button)") && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    card.click();
  }
});
document.addEventListener("click", (event) => {
  if (!weekPickerOpen) {
    return;
  }
  const target = event.target as Element | null;
  if (target?.closest(".week-picker, .history-week-label")) {
    return;
  }
  closeWeekPicker();
  paintWeekPicker();
});

/** Every listener for the markup inside `root`: the whole document after a full rebuild, or one
 *  slot after paintSlot, so a partial redraw is wired exactly like a full one. */
export function bindEvents(root: ParentNode = document): void {
  // The closing line's pop-up also goes away on a click outside it.
  root.querySelector(".session-over-backdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      clearLastError();
      setSessionOver(null);
      paintModalLayer();
    }
  });
  root.querySelectorAll<HTMLFormElement>("[data-rule-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void saveRuleForm(form);
    });
  });

  root.querySelector("#rule-value")?.addEventListener("input", (event) => {
    if (ruleEditor) {
      ruleEditor.value = (event.currentTarget as HTMLInputElement).value;
      paintRuleEditorLive();
      scheduleRulePreview();
    }
  });

  root.querySelector("#rule-name")?.addEventListener("input", (event) => {
    if (ruleEditor) {
      ruleEditor.name = (event.currentTarget as HTMLInputElement).value;
      ruleEditor.nameTouched = true;
      const preview = document.getElementById("rule-preview");
      if (preview) {
        preview.innerHTML = renderRulePreview(ruleEditor);
      }
    }
  });

  const searchInput = root.querySelector("#history-search") as HTMLInputElement | null;
  searchInput?.addEventListener("input", () => {
    setHistorySearch(searchInput.value);
    scheduleHistorySearch();
  });
  // The app popup's fields: the title follows the name as it is typed; Enter saves.
  root.querySelectorAll<HTMLInputElement>("#app-edit-name, #app-edit-address").forEach((input) => {
    input.addEventListener("input", () => {
      if (!appEdit) {
        return;
      }
      if (input.id === "app-edit-name") {
        appEdit.name = input.value;
      } else {
        appEdit.address = input.value;
      }
      appEdit.error = "";
      const title = document.getElementById("app-edit-title");
      if (title) {
        title.textContent = appEditTitle(appEdit);
      }
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !composing(event)) {
        event.preventDefault();
        void saveAppEdit();
      }
    });
  });

  bindPhraseEditor(root);

  root.querySelector("#overlay-snooze")?.addEventListener("change", (event) => {
    const mute = (event.target as HTMLInputElement).checked;
    void invokeSnapshot(mute ? "snooze_session" : "resume_session");
  });

  bindPreflight(root);
  bindClipsControls(root);
  bindSessionReview(root);
  // The chart on the Trends door: a click in a gap between its bars is a miss, not the door.
  root.querySelectorAll<HTMLElement>(".trend-door .trend-spark").forEach((chart) => {
    chart.addEventListener("click", (event) => {
      if (!(event.target as Element).closest("button")) {
        event.stopPropagation();
      }
    });
  });
  root.querySelector("#default-strictness")?.addEventListener("change", (event) => {
    void updateDefaultStrictness((event.target as HTMLSelectElement).value as Strictness);
  });

  root.querySelector("#status-window-enabled")?.addEventListener("change", (event) => {
    void updateStatusWindowEnabled((event.target as HTMLInputElement).checked);
  });

  root.querySelectorAll<HTMLInputElement>("#webcam-phone-use, #first-run-webcam").forEach((box) => {
    box.addEventListener("change", () => void setWebcamEnabled(box.checked));
  });

  root.querySelector("#webcam-gpu")?.addEventListener("change", (event) => {
    void setWebcamGpu((event.target as HTMLInputElement).checked);
  });

  root.querySelector("#webcam-camera")?.addEventListener("change", (event) => {
    void setWebcamCamera(Number((event.target as HTMLSelectElement).value));
  });

  root.querySelector("#voice-name")?.addEventListener("input", (event) => {
    if (recordedVoice) {
      recordedVoice.name = (event.target as HTMLInputElement).value;
      const canSave = Boolean(recordedVoice.bytes && recordedVoice.name.trim() && voiceBusy === null);
      document.querySelector<HTMLButtonElement>('[data-action="save-recorded-voice"]')?.toggleAttribute("disabled", !canSave);
    }
  });

  // The preview transport lives in the voice dialogs; another slot's paint leaves it playing.
  if (root === document || (root as Element).id === "voice-layer") {
    bindVoicePreview();
  }
  bindVoiceWaveforms(root);
  paintPlayingClip(root);
}

export async function runAction(action: string, source?: HTMLElement): Promise<void> {
  if (action === "toggle-theme") {
    setTheme(theme === "dark" ? "light" : "dark");
    localStorage.setItem("supervisor-theme", theme);
    document.documentElement.dataset.theme = theme;
    // Waves are drawn in the theme's ink; the drawn key includes the theme, so they redraw.
    bindVoiceWaveforms();
    // The share cards are drawn in the theme's colours too.
    if (shareOpen) {
      paintModalLayer();
    }
    const button = document.querySelector(".theme-toggle");
    if (button) {
      button.textContent = theme === "dark" ? "Dark" : "Light";
    }
    return;
  }

  if (action === "dismiss-storage-notice") {
    await invokeSnapshot("dismiss_storage_notice");
    return;
  }

  // Each action name belongs to one screen. Every screen is asked without waiting between them,
  // so the one that has it starts exactly as it did when all the branches were one chain.
  await Promise.all([
    trendsAction(action, source),
    webcamAction(action, source),
    overlayAction(action, source),
    firstRunAction(action, source),
    preflightAction(action, source),
    settingsAction(action, source),
    linesAction(action, source),
    voiceAction(action, source),
    historyAction(action, source),
    sessionAction(action, source),
    homeAction(action, source),
  ]);
}

function tabButton(tab: Tab, text: string): string {
  return `<button data-tab="${tab}" class="${activeTab === tab ? "active" : ""}" type="button">${text}</button>`;
}

void init();

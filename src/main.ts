import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AppRule, CurrentSession, NudgeVoice, PhraseLibraryState, PhraseMoment, PomodoroStatus, RecapApp,
  ReportSpan, RulesSaved, SessionReport, SessionSettings, SessionSnapshot, SessionSummary,
  StorageNotice, Strictness, Tab, WebcamFrame,
} from "./core/types";
import {
  dayKey, formatDuration, formatHours, formatMinutes, medianOf, mondayOf, monthLabel, parseDayKey,
  STREAK_DAY_SECONDS, streakLabel,
} from "./core/format";
import {
  app, appView, attr, composing, confirmModal, errorText, escapeHtml, modal, showFeedback,
} from "./core/dom";
import {
  activeTab, clearLastError, draft, history, knownHistoryIds, lastError, lastSessionId,
  setActiveTab, setAppNames, setHistory, setLastError, setLastSessionId, setSettings,
  setSettingsView, setSiteNames, setSnapshot, setTheme, settings, settingsView, snapshot, theme,
} from "./core/state";
import {
  captureUiState, invokeSnapshot, paintSlot, reconcilePolling, refreshSnapshot, restoreUiState,
  wire,
} from "./core/shell";
import {
  CARD_MONO, CARD_PAD, CARD_SANS, CARD_WIDTH, cardCanvas, cardPalette, copyCanvas, drawCardTile,
  drawWordmark, EYE_SVG, STRIP_GREEN, STRIP_RED,
} from "./core/cards";
import { flippedStats, timelineSeconds } from "./screens/report";
import { refreshTrends, trends, trendsAction, trendsLoaded } from "./screens/trends";
import {
  applyWebcamFrame, CAMERA_DOWN_COPY, cameraDown, paintWebcamDom, setWebcamCamera, setWebcamEnabled,
  setWebcamGpu, stopWebcamPreview, webcamAction, webcamError,
} from "./screens/webcam";
import {
  distractionDismissedFor, distractionIsActive, distractionLatchKey, momentCardActive,
  momentShownAt, overlayAction, overlayMoreOpen, overlayPlacement, renderInterruptVoice,
  renderOverlay, renderVoiceRow, setOverlayMoreOpen, setOverlayVoice, syncOverlayPlacement,
} from "./screens/overlay";
import {
  closeFirstRun, currentFirstRunStep, discardPractice, FIRST_RUN_KEY, firstRunAction, firstRunOpen,
  onboardingVisible, paintFirstRunLive, practice, PRACTICE_KEY, practiceIds, practiceQuietUntil,
  refreshCaptureAccess, renderAccessNotice, renderFirstRun, renderOnboardingLine,
  renderUnreadableBrowserNotice, setFirstRunOpen, setFirstRunStep, setPractice,
  setPracticeQuietUntil,
} from "./screens/firstRun";
import {
  handleRuleAction, paintRuleEditorHost, paintRuleEditorLive, permanentRules, renderRuleManager,
  renderRulePreview, ruleEditor, ruleName, sameRule, saveRuleForm, scheduleRulePreview,
  setPermanentRules, setRuleEditor,
} from "./screens/rules";
import {
  bindPreflight, preflightAction, preflightOpen, renderPreflightModal, setPreflightOpen,
} from "./screens/preflight";
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
  dismissVoiceInfo, ensureSelectedVoice, fitVoiceCardNames, lastNudgeVoice, modelDeleteOpen,
  normalizeStoredVoiceId, nudgeAudio, paintPlayingClip, paintVoiceLayer, playLine, readyClips,
  recordedVoice, recordingOpen, refreshVoiceDownload, refreshVoiceStatus, renderVoiceDialogs,
  selectedNudgeClip, selectedVoice, setModelDeleteOpen, setVoiceDeleteTargetId, setVoiceDialog,
  STARTER_PROFILE_IDS, voiceAction, voiceBackend, voiceBusy, voiceDeleteTargetId, voiceDialog,
  voiceDownload, voiceError, voiceInfoId,
} from "./screens/voice";
import {
  animateOnArrival, appEdit, appEditTitle, closeWeekPicker, fitShareStats, historyAction,
  historyConfirm, historySearch, historyView, historyWeek, historyWeekStart, noteNewHistory,
  openHistoryReport, paintModalLayer, paintWeekPicker, refreshHistoryWeek, renderHistory,
  renderModalLayer, saveAppEdit, scheduleHistorySearch, sessionReport, setAppEdit,
  setHistoryConfirm, setHistorySearch, setHistoryView, setSessionReport, setShareOpen, shareOpen,
  takeAnimation, weekPickerOpen, weekRecap,
} from "./screens/history";

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
/** Quit was picked from the tray while a session runs. */
let quitConfirmOpen = false;
let historyHydrated = false;
export let sessionRulesOpen = false;
let paintedViewKey = "";
/** History's data is loading after a tab switch; the poll leaves the page to that one draw. */
let historyArriving = false;
/** "Any distractions here?" after a session: what it counted as work, each one tapped or renamed. */
interface ReviewItem extends RecapApp {
  distraction: boolean;
  renaming: boolean;
  name: string;
}
let sessionReview: { id: number; items: ReviewItem[]; saving: boolean } | null = null;
export function setSessionReview(value: { id: number; items: ReviewItem[]; saving: boolean } | null): void {
  sessionReview = value;
}
/** The closing line that just played and the session it closed, shown over the report until
 *  clicked away. */
export let sessionOver: { voice: NudgeVoice; session: SessionSummary | null } | null = null;

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
      quitConfirmOpen = true;
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
    sessionRulesOpen = false;
    setRuleEditor(null);
  }
  // The session ended on its own while Quit was asking: there is nothing left to end.
  if (!next.current) {
    quitConfirmOpen = false;
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
    sessionOver = null;
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
    quitConfirmOpen = false;
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
    sessionRulesOpen = false;
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
    sessionReview = null;
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

function renderSession(current: CurrentSession | null): string {
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
function paintSoFar(current: CurrentSession): void {
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
    dayCardKey = "";
    await openHistoryReport(review.id);
  } catch (error) {
    review.saving = false;
    showFeedback(errorText(error));
    paintReviewLayer();
  }
}

function bindSessionReview(root: ParentNode): void {
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

/** Later, one at a time on Home: the next thing worth knowing, once it's worth knowing. */
interface HomeTip {
  id: string;
  text: string;
  label: string;
  action: string;
}

function homeTip(): HomeTip | null {
  const hidden = (id: string) => localStorage.getItem(`tip.${id}`) === "1";
  const recorded = (voiceBackend?.profiles ?? []).some(
    (profile) => !(STARTER_PROFILE_IDS as readonly string[]).includes(profile.profile_id) && Boolean(profile.reference_path),
  );
  if (history.length >= 1 && !recorded && !hidden("voice")) {
    return { id: "voice", text: "Record a voice you know", label: "Open", action: "tip-voice" };
  }
  if (history.length >= 3 && !settings.webcam_enabled && !hidden("webcam")) {
    return { id: "webcam", text: "Catch your phone or watch too", label: "Turn on", action: "tip-webcam" };
  }
  const oldest = history[history.length - 1];
  if (oldest && Date.now() - new Date(oldest.started_at).getTime() >= 6 * 86_400_000 && !hidden("share")) {
    return { id: "share", text: "Share your week", label: "Open", action: "tip-share" };
  }
  return null;
}

function renderHomeTip(): string {
  const tip = homeTip();
  if (!tip) {
    return "";
  }
  return `
    <article class="panel onboard-card">
      <div class="onboard-head">
        <p class="eyebrow">${escapeHtml(tip.text)}</p>
        <div class="home-tip-actions">
          <button class="small-button" type="button" data-action="${tip.action}">${escapeHtml(tip.label)}</button>
          <button class="small-button" type="button" data-action="tip-hide" data-tip="${tip.id}">Hide</button>
        </div>
      </div>
    </article>
  `;
}
window.addEventListener("resize", () =>
  requestAnimationFrame(() => {
    fitShareStats();
    fitQuote();
  }),
);

function fitQuote(): void {
  const card = document.querySelector<HTMLElement>(".quote-card");
  const quote = card?.querySelector<HTMLElement>("blockquote");
  if (!card || !quote) {
    return;
  }
  // The grid stretches the card to the side column, so the smallest size shows the real room.
  // The quote takes at most 60% of it: a card full of text reads like a wall. In a short window
  // the eyebrow and the attribution leave less than that, so the card must not overflow either.
  quote.style.fontSize = "18px";
  const room = card.clientHeight * 0.6;
  const fits = (px: number) => {
    quote.style.fontSize = `${px}px`;
    return quote.offsetHeight <= room && quote.scrollWidth <= quote.clientWidth && card.scrollHeight <= card.clientHeight;
  };
  let low = 18;
  let high = 60;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (fits(mid)) {
      low = mid;
    } else {
      high = mid;
    }
  }
  quote.style.fontSize = `${low}px`;
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
      sessionOver = null;
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

export function renderReviewLayer(): string {
  return sessionReview && sessionReview.id === sessionReport?.id ? renderSessionReview(sessionReview) : "";
}

function paintReviewLayer(): void {
  paintSlot("review-layer", renderReviewLayer());
}

export function paintSessionRulesLayer(): void {
  paintSlot("session-rules-layer", sessionRulesOpen ? renderSessionRulesModal() : "");
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

  if (action === "tip-hide") {
    localStorage.setItem(`tip.${source?.dataset.tip ?? ""}`, "1");
    render();
    return;
  }

  if (action === "tip-voice") {
    setActiveTab("settings");
    await runAction("open-voice-settings");
    return;
  }

  if (action === "tip-webcam") {
    await setWebcamEnabled(true);
    localStorage.setItem("tip.webcam", "1");
    showFeedback("Webcam on. Change it in Settings › Webcam");
    render();
    return;
  }

  if (action === "tip-share") {
    localStorage.setItem("tip.share", "1");
    document.querySelector<HTMLButtonElement>('nav.tabs [data-tab="history"]')?.click();
    return;
  }

  if (action === "copy-card") {
    await copyCard();
    return;
  }

  if (action === "streak-start") {
    // The start screen, set to the missing minutes as a plain timer. The goal is the user's to
    // type, as with the Start button.
    draft.mode = "timer";
    draft.duration_minutes = streakSessionMinutes(streakMinutesLeft());
    // The start screen lives on the Session tab; from History or Settings, go there first (the
    // tab button carries the leaving steps: voice screen, webcam preview, week picker).
    if (activeTab !== "session") {
      document.querySelector<HTMLButtonElement>('nav.tabs [data-tab="session"]')?.click();
    }
    await runAction("open-preflight");
    return;
  }

  if (action === "dismiss-storage-notice") {
    await invokeSnapshot("dismiss_storage_notice");
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
  ]);

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

function tabButton(tab: Tab, text: string): string {
  return `<button data-tab="${tab}" class="${activeTab === tab ? "active" : ""}" type="button">${text}</button>`;
}

/** Minutes today still needs to count toward the streak (0 once it counts). */
function streakMinutesLeft(): number {
  const seconds = dayFocusMap().get(dayKey(new Date())) ?? 0;
  // Rounded like the day card's minutes, so card + chip make 25. Between 24.5 and 25 minutes
  // the day doesn't count yet, so the chip still asks for 1.
  const left = Math.round(STREAK_DAY_SECONDS / 60) - Math.round(seconds / 60);
  return Math.max(seconds < STREAK_DAY_SECONDS ? 1 : 0, left);
}

/** The start screen's length for the missing minutes: the slider's steps of 5, from 15. */
function streakSessionMinutes(left: number): number {
  return Math.min(90, Math.max(15, Math.ceil(left / 5) * 5));
}

/** While no session runs: yellow with the minutes today still needs, one click to start them;
 *  green once today counts. */
function renderStreakChip(): string {
  const left = streakMinutesLeft();
  const streak = streakDays();
  if (left === 0) {
    return `<button class="status-chip streak-chip is-kept" type="button" data-tab="session" aria-label="Today counts toward your streak">Day ${streak} kept</button>`;
  }
  const minutes = streakSessionMinutes(left);
  const text = streak > 0 ? `${left} min to keep your ${streak}-day streak` : `${left} min to start a streak`;
  return `<button class="status-chip streak-chip is-short" type="button" data-action="streak-start" title="Opens a ${minutes}-minute focus session">${escapeHtml(text)}</button>`;
}

function statusChip(current: CurrentSession | null): string {
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

async function playNudge(current: CurrentSession | null): Promise<void> {
  if (!current || current.status !== "active" || draft.voiceId === "none") {
    return;
  }
  await playLine(selectedNudgeClip(current.metrics.nudges, current.camera.phone));
}

/** A Pomodoro round ended: a round-over line. A break ending plays nothing: the green card and
 *  its button say it, and the user did nothing to be corrected. Breaks are pauses, so the round
 *  line plays whatever the session's status. */
async function playMoment(phase: string): Promise<void> {
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
async function playSessionOver(): Promise<void> {
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

/** One per day of the year, cycling. Short enough to read at a glance and to stand alone. */
const DAILY_NOTES = [
  { text: "To be everywhere is to be nowhere.", by: "Seneca" },
  { text: "How we spend our days is, of course, how we spend our lives.", by: "Annie Dillard" },
  { text: "Tell me to what you pay attention and I will tell you who you are.", by: "José Ortega y Gasset" },
  { text: "Well begun is half done.", by: "Aristotle" },
  { text: "Inspiration exists, but it has to find you working.", by: "Pablo Picasso" },
  { text: "Confine yourself to the present.", by: "Marcus Aurelius" },
  { text: "It is not enough to be busy. So are the ants. The question is: what are we busy about?", by: "Henry David Thoreau" },
  { text: "Resolve to perform what you ought; perform without fail what you resolve.", by: "Benjamin Franklin" },
  { text: "No great thing is created suddenly.", by: "Epictetus" },
  { text: "Lost time is never found again.", by: "Benjamin Franklin" },
  { text: "Attention is the rarest and purest form of generosity.", by: "Simone Weil" },
  { text: "You don't have to be great to start, but you have to start to be great.", by: "Zig Ziglar" },
  { text: "The mind is not a vessel to be filled, but a fire to be kindled.", by: "Plutarch" },
  { text: "Do not wait to strike till the iron is hot; but make it hot by striking.", by: "W. B. Yeats" },
  { text: "My experience is what I agree to attend to.", by: "William James" },
  { text: "Tomorrow is often the busiest day of the week.", by: "Spanish proverb" },
  { text: "It is not that we have a short time to live, but that we waste a good deal of it.", by: "Seneca" },
  { text: "Amateurs sit and wait for inspiration, the rest of us just get up and go to work.", by: "Stephen King" },
  { text: "Concentration is the secret of strength.", by: "Ralph Waldo Emerson" },
  { text: "The best time to plant a tree was twenty years ago. The second best time is now.", by: "Chinese proverb" },
  { text: "Nothing will work unless you do.", by: "Maya Angelou" },
  { text: "Focus is a matter of deciding what things you are not going to do.", by: "John Carmack" },
  { text: "If you seek tranquillity, do less. Or, more accurately, do what is essential.", by: "Marcus Aurelius" },
  { text: "Work expands so as to fill the time available for its completion.", by: "C. Northcote Parkinson" },
  { text: "Begin at once to live, and count each separate day as a separate life.", by: "Seneca" },
  { text: "Finish each day and be done with it.", by: "Ralph Waldo Emerson" },
  { text: "The scariest moment is always just before you start.", by: "Stephen King" },
  { text: "Great things are done by a series of small things brought together.", by: "Vincent van Gogh" },
  { text: "Don't mistake activity with achievement.", by: "John Wooden" },
  { text: "A wealth of information creates a poverty of attention.", by: "Herbert Simon" },
  { text: "How long are you going to wait before you demand the best for yourself?", by: "Epictetus" },
  { text: "Someday is not a day of the week.", by: "Janet Dailey" },
  { text: "The first and greatest victory is to conquer yourself.", by: "Plato" },
  { text: "Do what you can, with what you have, where you are.", by: "Theodore Roosevelt" },
  { text: "Things which matter most must never be at the mercy of things which matter least.", by: "Goethe" },
  { text: "Never leave that till tomorrow which you can do today.", by: "Benjamin Franklin" },
  { text: "Almost everything will work again if you unplug it for a few minutes, including you.", by: "Anne Lamott" },
  { text: "Our life is frittered away by detail. Simplify, simplify.", by: "Henry David Thoreau" },
  { text: "Deciding what not to do is as important as deciding what to do.", by: "Steve Jobs" },
  { text: "Waste no more time arguing what a good man should be. Be one.", by: "Marcus Aurelius" },
  { text: "Dig the well before you are thirsty.", by: "Chinese proverb" },
  { text: "Nothing is so fatiguing as the eternal hanging on of an uncompleted task.", by: "William James" },
  { text: "Little by little, one travels far.", by: "Spanish proverb" },
  { text: "What is important is seldom urgent and what is urgent is seldom important.", by: "Dwight D. Eisenhower" },
  { text: "First say to yourself what you would be; and then do what you have to do.", by: "Epictetus" },
  { text: "Do every act of your life as though it were the very last act of your life.", by: "Marcus Aurelius" },
  { text: "Energy and persistence conquer all things.", by: "Benjamin Franklin" },
  { text: "The impediment to action advances action. What stands in the way becomes the way.", by: "Marcus Aurelius" },
  { text: "You will never find time for anything. If you want time, you must make it.", by: "Charles Buxton" },
  { text: "When walking, walk. When eating, eat.", by: "Zen proverb" },
  { text: "Knowing is not enough; we must apply. Willing is not enough; we must do.", by: "Goethe" },
  { text: "There is no substitute for hard work.", by: "Thomas Edison" },
  { text: "The art of being wise is the art of knowing what to overlook.", by: "William James" },
  { text: "Either you run the day or the day runs you.", by: "Jim Rohn" },
  { text: "Do the thing and you shall have the power.", by: "Ralph Waldo Emerson" },
  { text: "Fall seven times, stand up eight.", by: "Japanese proverb" },
  { text: "We suffer more often in imagination than in reality.", by: "Seneca" },
  { text: "Make each day your masterpiece.", by: "John Wooden" },
  { text: "The journey of a thousand miles begins with a single step.", by: "Laozi" },
  { text: "Procrastination is the thief of time.", by: "Edward Young" },
  { text: "Attention is the beginning of devotion.", by: "Mary Oliver" },
  { text: "Don't explain your philosophy. Embody it.", by: "Epictetus" },
  { text: "Plans are worthless, but planning is everything.", by: "Dwight D. Eisenhower" },
  { text: "A year from now you may wish you had started today.", by: "Karen Lamb" },
  { text: "Give yourself a gift: the present moment.", by: "Marcus Aurelius" },
  { text: "The reward of a thing well done is to have done it.", by: "Ralph Waldo Emerson" },
  { text: "If you spend too much time thinking about a thing, you will never get it done.", by: "Bruce Lee" },
  { text: "Motivation is what gets you started. Habit is what keeps you going.", by: "Jim Rohn" },
  { text: "Action is the antidote to despair.", by: "Joan Baez" },
  { text: "You can't cross the sea merely by standing and staring at the water.", by: "Rabindranath Tagore" },
  { text: "Little strokes fell great oaks.", by: "Benjamin Franklin" },
  { text: "Measure twice, cut once.", by: "Proverb" },
  { text: "There is nothing so useless as doing efficiently that which should not be done at all.", by: "Peter Drucker" },
  { text: "It does not matter how slowly you go as long as you do not stop.", by: "Confucius" },
  { text: "Difficulties strengthen the mind, as labor does the body.", by: "Seneca" },
  { text: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", by: "Will Durant" },
  { text: "Do not let what you cannot do interfere with what you can do.", by: "John Wooden" },
  { text: "We are kept from our goal not by obstacles but by a clear path to a lesser goal.", by: "Robert Brault" },
  { text: "The best way out is always through.", by: "Robert Frost" },
  { text: "Begin, be bold, and venture to be wise.", by: "Horace" },
  { text: "Don't count the days, make the days count.", by: "Muhammad Ali" },
  { text: "If you want to improve, be content to be thought foolish and stupid.", by: "Epictetus" },
  { text: "A ship in harbor is safe, but that is not what ships are built for.", by: "John A. Shedd" },
  { text: "Tell me, what is it you plan to do with your one wild and precious life?", by: "Mary Oliver" },
];

function dailyNote(): { date: string; text: string; by: string } {
  const notes = DAILY_NOTES;
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const day = Math.floor((now.getTime() - start.getTime()) / 86400000);
  const note = notes[day % notes.length];
  const date = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }).toUpperCase();
  return { date, text: note.text, by: note.by };
}

function dayFocusMap(): Map<string, number> {
  return new Map(trends.daily_focus.map((day) => [day.date, day.focus_seconds]));
}

/** The current streak: consecutive days with 25 focused minutes, ending today or yesterday.
 *  Today doesn't break it while there is still time to count. */
function streakDays(asOf = dayKey(new Date())): number {
  const focus = dayFocusMap();
  const cursor = parseDayKey(asOf);
  let days = 0;
  for (let step = 0; step < 400; step += 1) {
    const key = dayKey(cursor);
    if ((focus.get(key) ?? 0) >= STREAK_DAY_SECONDS) {
      days += 1;
    } else if (!(step === 0 && key === dayKey(new Date()))) {
      break;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return days;
}

function renderCalendar(): string {
  const focus = dayFocusMap();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const start = mondayOf(first);
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const cells = Math.ceil(((last.getTime() - start.getTime()) / 86400000 + 1) / 7) * 7;
  const letters = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const days: string[] = [];
  for (let index = 0; index < cells; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = dayKey(date);
    const seconds = focus.get(key) ?? 0;
    const classes = ["cal-day"];
    if (date.getMonth() !== today.getMonth()) classes.push("is-out");
    if (date > today) classes.push("is-future");
    else if (key === dayKey(today)) classes.push("is-today");
    else if (seconds >= STREAK_DAY_SECONDS) classes.push("is-on");
    // Hovering a day lifts it and swaps its date for its focused time; the parts wrap onto
    // two lines when the day is narrow.
    const time = date > today ? "" : `<b class="cal-time">${formatHours(seconds).split(" ").map((part) => `<span>${part}</span>`).join("")}</b>`;
    days.push(
      `<span class="${classes.join(" ")}" style="animation-delay: ${index * 12}ms"><span class="cal-num">${date.getDate()}</span>${time}</span>`,
    );
  }
  return `
    <div class="cal-grid ${!trendsLoaded ? "is-waiting" : takeAnimation("calendar") ? "is-animated" : ""}" role="img" aria-label="${attr(monthLabel(today))}, days with focus shaded">
      ${letters.map((letter) => `<span class="cal-dow">${letter}</span>`).join("")}
      ${days.join("")}
    </div>
  `;
}

/**
 * The day the Home card shows: today once it has a session, else the latest day with one. The
 * card never goes blank in the morning; it flips to Today with the first session.
 */
let dayCard: { day: string; reports: SessionReport[] } | null = null;
/** Day plus the session ids in it; a new session on that day refetches. */
let dayCardKey = "";
export function setDayCardKey(value: string): void {
  dayCardKey = value;
}

async function ensureDayCard(): Promise<void> {
  const newest = history[0];
  if (!newest) {
    dayCard = null;
    dayCardKey = "";
    return;
  }
  const day = dayKey(new Date(newest.started_at));
  const items = history.filter((item) => dayKey(new Date(item.started_at)) === day);
  const key = `${day}:${items.map((item) => item.id).join(",")}`;
  if (key === dayCardKey) {
    return;
  }
  dayCardKey = key;
  dayCard = null;
  try {
    const reports = await Promise.all(items.map((item) => invoke<SessionReport>("get_session_report", { id: item.id })));
    if (dayCardKey === key) {
      reports.sort((a, b) => a.started_at.localeCompare(b.started_at));
      dayCard = { day, reports };
      // Only the card: a full rebuild here would cut the calendar's pop-in short.
      if (paintSlot("day-card-slot", renderDayCard(streakDays()))) {
        fitShareStats();
        fitQuote(); // the card's height sets the quote's room
      }
    }
  } catch {
    // The card stays off until the next snapshot.
  }
}

/** Mirrors the backend: on-task time runs together until a drift, an absence or a gap breaks it. */
function focusedStretches(spans: ReportSpan[]): number[] {
  const stretches: number[] = [];
  let current = 0;
  let previousEnd = 0;
  for (const span of spans) {
    if ((span.started_offset_seconds > previousEnd || span.after_pause) && current > 0) {
      stretches.push(current);
      current = 0;
    }
    previousEnd = span.started_offset_seconds + span.seconds;
    if (stripOnTask(span.state)) {
      current += span.seconds;
    } else if (current > 0) {
      stretches.push(current);
      current = 0;
    }
  }
  if (current > 0) {
    stretches.push(current);
  }
  return stretches;
}

/** The strip has two colours: work and distraction. Time away is left blank. */
function stripOnTask(state: string): boolean {
  return state === "focused";
}

function stripOffTask(state: string): boolean {
  return state === "distracted" || state === "phone" || state === "suspicious";
}

interface DaySummary {
  day: string;
  isToday: boolean;
  focusedSeconds: number;
  attentionSeconds: number;
  /** Sessions laid end to end: each segment's share of the strip and its spans and nudges. */
  segments: { start: number; width: number; report: SessionReport; duration: number }[];
}

function summarizeDay(card: { day: string; reports: SessionReport[] }): DaySummary {
  const durations = card.reports.map((report) => timelineSeconds(report));
  const total = Math.max(1, durations.reduce((sum, seconds) => sum + seconds, 0));
  let start = 0;
  const segments = card.reports.map((report, index) => {
    const segment = { start, width: durations[index] / total, report, duration: durations[index] };
    start += segment.width;
    return segment;
  });
  return {
    day: card.day,
    isToday: card.day === dayKey(new Date()),
    focusedSeconds: card.reports.reduce((sum, report) => sum + report.focused_seconds, 0),
    attentionSeconds: medianOf(card.reports.flatMap((report) => focusedStretches(report.spans))) ?? 0,
    segments,
  };
}

/** The card's date, written out: "30 October, 2026". */
function cardDayLabel(day: string): string {
  const date = parseDayKey(day);
  return `${date.getDate()} ${date.toLocaleDateString(undefined, { month: "long" })}, ${date.getFullYear()}`;
}

/** The day's strip as runs of on/off-task, cut into equal bins and each bin given the state
 *  that filled most of it. A few seconds in a tab can't paint a line, a real drift still shows,
 *  and the picture stays readable for any length of day. The stats stay exact. */
const STRIP_BINS = 48;

function stripRuns(segments: DaySummary["segments"], bins = STRIP_BINS): { on: boolean; left: number; width: number }[] {
  const onSeconds = new Array<number>(bins).fill(0);
  const offSeconds = new Array<number>(bins).fill(0);
  for (const segment of segments) {
    for (const span of segment.report.spans) {
      const on = stripOnTask(span.state);
      if (!on && !stripOffTask(span.state)) continue;
      const a = segment.start + (span.started_offset_seconds / segment.duration) * segment.width;
      const b = a + (span.seconds / segment.duration) * segment.width;
      for (let k = Math.floor(a * bins); k < Math.min(bins, Math.ceil(b * bins)); k += 1) {
        const overlap = Math.min(b, (k + 1) / bins) - Math.max(a, k / bins);
        if (overlap > 0) (on ? onSeconds : offSeconds)[k] += overlap;
      }
    }
  }
  const runs: { on: boolean; left: number; width: number }[] = [];
  for (let k = 0; k < bins; k += 1) {
    if (onSeconds[k] + offSeconds[k] === 0) continue;
    const on = onSeconds[k] >= offSeconds[k];
    const last = runs[runs.length - 1];
    if (last && last.on === on && Math.abs(last.left + last.width - k / bins) < 1e-9) {
      last.width += 1 / bins;
    } else {
      runs.push({ on, left: k / bins, width: 1 / bins });
    }
  }
  return runs;
}

function renderDayCard(todayStreakDays: number): string {
  if (!dayCard) {
    if (history.length > 0) {
      return "";
    }
    // Nothing recorded yet: the card's outline, so the first session has a visible place to land.
    return `
      <section class="panel last-session-card">
        <p class="eyebrow">Your day</p>
        <div class="share-card is-empty" aria-label="No sessions yet">
          <span class="share-head">
            <strong>Your first card</strong>
          </span>
          <span class="share-strip" aria-hidden="true"></span>
          <span class="share-stats">
            <span><small>Focused</small><strong>—</strong></span>
            <span><small>Attention span</small><strong>—</strong></span>
            <span><small>Streak</small><strong>${streakLabel(todayStreakDays)}</strong></span>
          </span>
        </div>
        <p class="share-hint">Finish a session and its card lands here</p>
      </section>
    `;
  }
  const summary = summarizeDay(dayCard);
  const streakText = streakLabel(streakDays());
  const strip = stripRuns(summary.segments)
    .map((run) => `<i class="${run.on ? "strip-on" : "strip-off"}" style="left: ${(run.left * 100).toFixed(2)}%; width: ${(run.width * 100).toFixed(2)}%"></i>`)
    .join("");
  return `
    <section class="panel last-session-card">
      <p class="eyebrow">Your day</p>
      <button class="share-card" type="button" data-action="copy-card" title="Copy the card as an image">
        <span class="share-head">
          <strong>${escapeHtml(cardDayLabel(summary.day))}</strong>
        </span>
        <span class="share-strip" aria-hidden="true"><span class="share-strip-fill">${strip}</span></span>
        <span class="share-stats">
          <span><small>Focused</small><strong>${escapeHtml(formatHours(summary.focusedSeconds))}</strong></span>
          <span><small>Attention span</small><strong>${escapeHtml(formatMinutes(summary.attentionSeconds))}</strong></span>
          <span><small>Streak</small><strong>${streakText}</strong></span>
        </span>
      </button>
      <p class="share-hint">Click the card to copy it and share it</p>
    </section>
  `;
}

/** Draws the day card to a canvas and puts the PNG on the clipboard, in the current theme's colours. */
async function copyCard(): Promise<void> {
  if (!dayCard) {
    return;
  }
  const summary = summarizeDay(dayCard);
  const streak = streakDays(summary.day);
  const width = CARD_WIDTH;
  const tileH = 84;
  const tilesY = 176;
  const drawn = cardCanvas(tilesY + tileH + 4 + CARD_PAD, true);
  if (!drawn) {
    return;
  }
  const { canvas, ctx } = drawn;
  const palette = cardPalette();

  // The same header as the week and month cards: the wordmark, then the eyebrow over the date.
  ctx.fillStyle = palette.ink;
  drawWordmark(ctx, CARD_PAD, CARD_PAD, 24);
  ctx.textAlign = "right";
  ctx.fillStyle = palette.muted;
  ctx.font = `600 15px ${CARD_MONO}`;
  ctx.fillText("YOUR DAY", width - CARD_PAD, CARD_PAD + 2);
  ctx.fillStyle = palette.ink;
  ctx.font = `650 28px ${CARD_SANS}`;
  ctx.fillText(cardDayLabel(summary.day), width - CARD_PAD, CARD_PAD + 24);
  ctx.textAlign = "left";

  const stripX = CARD_PAD;
  const stripY = 108;
  const stripW = width - CARD_PAD * 2;
  const stripH = 44;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(stripX, stripY, stripW, stripH, 6);
  ctx.clip();
  ctx.fillStyle = palette.track;
  ctx.fillRect(stripX, stripY, stripW, stripH);
  for (const run of stripRuns(summary.segments)) {
    ctx.fillStyle = run.on ? STRIP_GREEN : STRIP_RED;
    ctx.fillRect(stripX + run.left * stripW, stripY, run.width * stripW, stripH);
  }
  ctx.restore();
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(stripX, stripY, stripW, stripH, 6);
  ctx.stroke();

  const stats: [string, string][] = [
    ["FOCUSED", formatHours(summary.focusedSeconds)],
    ["ATTENTION SPAN", formatMinutes(summary.attentionSeconds)],
    ["STREAK", streakLabel(streak)],
  ];
  const tileGap = 12;
  const tileW = (width - CARD_PAD * 2 - tileGap * 2) / 3;
  stats.forEach(([label, value], index) => drawCardTile(ctx, CARD_PAD + index * (tileW + tileGap), tilesY, tileW, tileH, label, value));

  await copyCanvas(canvas);
}

void init();

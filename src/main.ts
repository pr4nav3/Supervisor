import "./styles.css";
import starterLines from "../scripts/starter_lines.json";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import type {
  AppRule, ClipQueue, CurrentSession, DailyFocus, HistoryConfirm, HistoryView, HistoryWeek,
  MonthRecap, NudgeVoice, PhraseDefinition, PhraseEditor, PhraseLibraryState, PhraseMoment,
  PomodoroStatus, RecapApp, RecordedVoice, RecordingState, ReportSpan, RuleEditor, RulePreview,
  RulesSaved, SessionReport, SessionSettings, SessionSnapshot, SessionSummary, StorageNotice,
  Strictness, Tab, TrendPeriod, VoiceBackendStatus, VoiceBusy, VoiceClipSummary,
  VoiceDownloadSnapshot, VoiceModelStatus, VoiceOption, VoiceProfileSummary, VoiceRecordingSnapshot,
  VoiceSource, VoiceTone, WebcamFrame, WeekRecap,
} from "./core/types";
import {
  addDaysKey, addMonthsKey, dayKey, formatBytes, formatDuration, formatHours, formatMinutes,
  formatQueueTime, formatRecovery, formatSpan, formatStretchChip, formatWeekRange, formatWeekStart,
  medianOf, mondayKey, mondayOf, monthKey, monthLabel, parseDayKey, smartBarHeight,
  STREAK_DAY_SECONDS, streakLabel, thisMondayKey,
} from "./core/format";
import {
  afterPointer, app, appView, attr, composing, confirmModal, errorText, escapeHtml, formValue,
  label, modal, showFeedback,
} from "./core/dom";
import { playVolume } from "./core/audio";
import {
  activeTab, appNames, clearLastError, draft, history, knownHistoryIds, lastError, lastSessionId,
  setActiveTab, setAppNames, setHistory, setLastError, setLastSessionId, setSettings,
  setSettingsView, setSiteNames, setSnapshot, setTheme, settings, settingsView, siteNames, snapshot,
  theme,
} from "./core/state";
import {
  captureUiState, invokeSnapshot, paintSlot, reconcilePolling, refreshSnapshot, restoreUiState,
  wire,
} from "./core/shell";
import {
  CARD_MONO, CARD_PAD, CARD_SANS, CARD_WIDTH, cardCanvas, cardPalette, copyCanvas, drawCardTile,
  drawMonthCard, drawWeekCard, drawWordmark, EYE_SVG, STRIP_GREEN, STRIP_RED,
} from "./core/cards";
import { flippedStats, flipStat, renderSessionReport, timelineSeconds } from "./screens/report";
import {
  refreshTrendPeriods, refreshTrends, renderTrends, setTrendPage, trends, trendsAction,
  trendsLoaded,
} from "./screens/trends";
import {
  applyWebcamFrame, CAMERA_DOWN_COPY, cameraDown, paintWebcamDom, renderWebcamSettings,
  setWebcamCamera, setWebcamEnabled, setWebcamGpu, stopWebcamPreview, webcamAction, webcamError,
} from "./screens/webcam";
import {
  distractionDismissedFor, distractionIsActive, distractionLatchKey, momentCardActive,
  momentShownAt, overlayAction, overlayMoreOpen, overlayPlacement, renderInterruptVoice,
  renderOverlay, renderVoiceRow, setOverlayMoreOpen, setOverlayVoice, syncOverlayPlacement,
} from "./screens/overlay";
import {
  closeFirstRun, currentFirstRunStep, discardPractice, FIRST_RUN_KEY, firstRunAction, firstRunOpen,
  onboardingVisible, paintFirstRun, paintFirstRunLive, practice, PRACTICE_KEY, practiceIds,
  practiceQuietUntil, refreshCaptureAccess, renderAccessNotice, renderFirstRun,
  renderOnboardingLine, renderUnreadableBrowserNotice, setFirstRunOpen, setFirstRunStep,
  setPractice, setPracticeQuietUntil,
} from "./screens/firstRun";

wire({ applySnapshot, bindEvents, refreshSnapshotNow, render });

/** Work / break rhythms on the start screen. */
const POMODORO_RHYTHMS = [
  { work: 25, rest: 5 },
  { work: 50, rest: 10 },
  { work: 90, rest: 20 },
] as const;

/** A few seconds of burst photos on a phone. History is a sliver of that. */
const PHOTO_BURST_BYTES = 30 * 1024 ** 2;

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

/** Every personality has lines for each moment. The two that repeat all session want a few. */
const MOMENTS: { id: PhraseMoment; label: string; when: string; often: boolean }[] = [
  { id: "nudge", label: "Back to work", when: "When you get distracted", often: true },
  { id: "phone", label: "Phone down", when: "When the camera sees your phone or watch", often: true },
  { id: "roundover", label: "Take a break", when: "When a Pomodoro round ends", often: false },
  { id: "sessionover", label: "Session done", when: "When a session ends", often: false },
];
const toneOrder: VoiceTone[] = ["gentle", "mom", "genz", "stern"];

const phraseBank = starterLines.phrases as PhraseDefinition[];

const noneVoice: VoiceOption = {
  id: "none",
  name: "No voice",
  ready: 0,
  total: 0,
  source: "none",
  selectable: true,
  profile: null,
};

const STARTER_PROFILE_IDS = ["derek", "elise"] as const;

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
let historyWeekStart = "";
/** Bumped per week request, so a slow earlier week cannot land over the one shown now. */
let historyWeekRequest = 0;
let historyWeek: HistoryWeek | null = null;
let sessionReport: SessionReport | null = null;
let weekRecap: WeekRecap | null = null;
export let historyView: HistoryView = "list";
/** Which list sits under the week: its sessions or where its time went. */
let historyPane: "sessions" | "apps" = "sessions";
let historySearch = "";
/** Null until the first search of the current text answers. */
let historySearchResults: SessionSummary[] | null = null;
let historySearchTimer: number | undefined;
let historySearchRequest = 0;
/** The week (and data state) whose charts already played their entrance. */
let historyChartsFor = "";
/** The week picker under the toolbar: open, the month it shows (its first day), and that
 * month's days with sessions. */
let weekPickerOpen = false;
let pickerMonth = "";
let pickerDays: Record<string, DailyFocus> = {};
let pickerRequest = 0;
let historyConfirm: HistoryConfirm | null = null;
/** Quit was picked from the tray while a session runs. */
let quitConfirmOpen = false;
/** The Share popup over History, and the month it shows (loaded when it opens). */
let shareOpen = false;
let shareMonth: MonthRecap | null = null;
let historyHydrated = false;
export let permanentRules: AppRule[] = [];
let preflightOpen = false;
/** Distractions the user allowed for the session about to start. */
let preflightExceptions: AppRule[] = [];
let preflightBlocksOpen = false;
let preflightAdvancedOpen = false;
let sessionRulesOpen = false;
let paintedViewKey = "";
/** History's data is loading after a tab switch; the poll leaves the page to that one draw. */
let historyArriving = false;
let ruleEditor: RuleEditor | null = null;
export function setRuleEditor(value: RuleEditor | null): void {
  ruleEditor = value;
}
let rulePreviewTimer: number | undefined;
/**
 * The popup a row of Apps & sites opens: its name, a website's address, and whether it counts as
 * work or a distraction. One choice for both: it rewrites the sessions it was opened from (the
 * report's one, or every session of the week shown) and puts the item on the distractions list
 * or takes it off, so it counts the same way from then on. `listable` is false for a browser,
 * which can't be a distraction by itself; null until that is known.
 */
interface AppEdit {
  kind: "app" | "website";
  key: string;
  label: string;
  name: string;
  address: string;
  distraction: boolean;
  wasDistraction: boolean;
  sessionIds: number[];
  listable: boolean | null;
  /** Allowed once in the report's session, so its time there counted as work. */
  allowed: boolean;
  error: string;
}
let appEdit: AppEdit | null = null;
/** "Any distractions here?" after a session: what it counted as work, each one tapped or renamed. */
interface ReviewItem extends RecapApp {
  distraction: boolean;
  renaming: boolean;
  name: string;
}
let sessionReview: { id: number; items: ReviewItem[]; saving: boolean } | null = null;
let customPhrases: PhraseDefinition[] = [];
let customPhraseSets: string[] = [];
let phraseOverrides: Record<string, PhraseDefinition> = {};
let phraseEditor: PhraseEditor | null = null;
let hiddenPhrases = new Set<string>();
let clipsVoiceId = "starter-female";
let clipsVoiceTouched = false;
/** A recorded voice clicked before it had its lines: picked for the user once they are made. */
let pickWhenReady: string | null = null;
/** The personality forms under the cards: a rename, a delete awaiting its confirm, a new name. */
let toneRename: { from: VoiceTone; value: string } | null = null;
let toneDeleteArmed: VoiceTone | null = null;
let newToneDraft: string | null = null;
/** The ⋯ menu on your own personality's card: Rename and Delete. */
let toneMenuOpen = false;
let clipQueue: ClipQueue | null = null;
let clipQueueTicker: number | undefined;
/** A one-line job started from the line popup reopens that line when its clip lands. */
let reopenLineAfterQueue: string | null = null;
const clipAssetRevision = new Map<string, number>();
/** The voice page's info popup, named as its open- and close- actions name it. */
let voiceDialog: "voice-help" | "model-info" | "memory-info" | null = null;
let modelDeleteOpen = false;
let voiceBackend: VoiceBackendStatus | null = null;
let voiceDownload: VoiceDownloadSnapshot | null = null;
let voiceBusy: VoiceBusy = null;
let voiceDeleteTargetId: string | null = null;
let voiceInfoId: string | null = null;
let voicePreviewAudio: HTMLAudioElement | null = null;
const waveformPeaks = new Map<string, number[]>();
const waveformPending = new Map<string, Promise<AudioBuffer>>();
let waveformContext: AudioContext | null = null;
let voicePreviewPath = "";
let previewWaveRaf = 0;
let previewBarDragging = false;
let recordingOpen = false;
let recordingState: RecordingState = "idle";
let recordingError = "";
let recordedVoice: RecordedVoice | null = null;
let recordingTickId: number | undefined;
let recordingStartedAtMs: number | null = null;
let voiceError = "";
let downloadPollId: number | undefined;
let nudgeAudio: HTMLAudioElement | null = null;
/** The voice and line of the nudge playing or last played (main window). */
let lastNudgeVoice: Omit<NudgeVoice, "speaking"> | null = null;
/** The closing line that just played and the session it closed, shown over the report until
 *  clicked away. */
let sessionOver: { voice: NudgeVoice; session: SessionSummary | null } | null = null;

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
    permanentRules = loadedRules;
    customPhraseSets = loadedPhraseLibrary.custom_tones;
    hiddenPhrases = new Set(loadedPhraseLibrary.hidden_phrases);
    // An edited line whose bundled original is gone (the old break-over set) stays the user's.
    const bundled = new Set(phraseBank.map((phrase) => phrase.id));
    customPhrases = [
      ...loadedPhraseLibrary.custom_phrases,
      ...loadedPhraseLibrary.phrase_overrides.filter((phrase) => !bundled.has(phrase.id)),
    ];
    phraseOverrides = Object.fromEntries(
      loadedPhraseLibrary.phrase_overrides.filter((phrase) => bundled.has(phrase.id)).map((phrase) => [phrase.id, phrase]),
    );
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
      permanentRules = await invoke<AppRule[]>("get_rules");
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

async function refreshVoiceStatus(shouldRender = true): Promise<void> {
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

async function refreshVoiceDownload(shouldRender = true): Promise<void> {
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
    ruleEditor = null;
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
    shareOpen = false;
    paintModalLayer();
    return;
  }
  // The delete confirm sits over the engine popup: it closes first.
  if (modelDeleteOpen) {
    modelDeleteOpen = false;
    paintVoiceLayer();
    return;
  }
  if (voiceDialog) {
    voiceDialog = null;
    paintVoiceLayer();
    return;
  }
  if (newToneDraft !== null) {
    newToneDraft = null;
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
    appEdit = null;
    paintModalLayer();
    return;
  }
  if (ruleEditor) {
    ruleEditor = null;
    paintRuleEditorHost();
    return;
  }
  if (phraseEditor) {
    phraseEditor = null;
    paintVoiceLayer();
    return;
  }
  if (quitConfirmOpen) {
    quitConfirmOpen = false;
    paintModalLayer();
    return;
  }
  if (historyConfirm) {
    historyConfirm = null;
    paintModalLayer();
    return;
  }
  if (voiceDeleteTargetId) {
    voiceDeleteTargetId = null;
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
    ruleEditor = null;
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
    preflightOpen = false;
    ruleEditor = null;
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
    historyView = "list";
    sessionReport = null;
    historyConfirm = null;
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
    historySearch = "";
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

function editorIsOpen(): boolean {
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
function allowChip(rule: AppRule, index: number, allowed: boolean, action: string): string {
  return `<button type="button" class="rule-chip rule-chip-distracting ${allowed ? "is-allowed" : ""}" data-action="${action}" data-rule-index="${index}" aria-pressed="${allowed}" title="${attr(allowed ? "Allowed once. Click to count it as a distraction again." : "Click to allow it once, for this session.")}">${escapeHtml(ruleName(rule))}</button>`;
}

/** The same rule, however it was typed: matching ignores case, so the chips must too. */
function sameRule(a: AppRule, b: AppRule): boolean {
  return a.target === b.target && a.value.toLowerCase() === b.value.toLowerCase();
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
    permanentRules = saved.rules;
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

function renderPreflightModal(): string {
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

function renderSettings(): string {
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

/** The one list. Chips open the editor; the same component serves Settings and the live dialog. */
export function renderRuleManager(title: string): string {
  return `
    <div class="rule-manager permanent-rule-manager">
      <div class="rule-toolbar">
        <div>
          ${title ? `<p class="eyebrow">${escapeHtml(title)}</p>` : ""}
          <strong>Everything else counts as work.</strong>
        </div>
        <div class="rule-toolbar-actions">
          <button class="primary add-rule-button" type="button" data-rule-action="add">+ Add</button>
        </div>
      </div>
      ${ruleEditor ? renderRuleEditor(ruleEditor) : ""}
      <div class="rule-group">
        <div class="rule-chip-list">
          ${
            permanentRules.length === 0
              ? `<span class="no-session-rules">None yet. Add the sites and apps that pull you off task.</span>`
              : permanentRules
                  .map((rule, index) => ({ rule, index }))
                  .reverse()
                  .map(
                    ({ rule, index }) => `
                      <button class="rule-chip rule-chip-distracting" type="button" data-rule-action="edit" data-rule-index="${index}"${rule.target === "website" ? ` title="${attr(rule.value)}"` : ""}>
                        ${escapeHtml(ruleName(rule))}
                      </button>
                    `,
                  )
                  .join("")
          }
        </div>
      </div>
    </div>
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

function siteName(key: string): string {
  return siteNames[key] ?? key;
}

export function ruleName(rule: AppRule): string {
  return rule.target === "website" ? siteName(rule.value) : appNames[rule.value.toLowerCase()] ?? rule.value;
}

function previewSite(editor: RuleEditor): string | null {
  const preview = editor.preview;
  return preview && "value" in preview && preview.target === "website" ? preview.value : null;
}

/** True once what was typed resolved to a site or an app. */
function rulePreviewReady(editor: RuleEditor): boolean {
  return Boolean(editor.value.trim() && editor.preview && "value" in editor.preview);
}

function renderRulePreview(editor: RuleEditor): string {
  const preview = editor.preview;
  if (!editor.value.trim() || !preview) {
    return `<span class="rule-preview-note">Paste a link or type a name.</span>`;
  }
  if ("error" in preview) {
    return `<span class="rule-preview-error">${escapeHtml(preview.error)}</span>`;
  }
  const site = preview.target === "website";
  // A site reads as the name typed beside it, or its address until there is one.
  const value = site ? editor.name.trim() || preview.value : appNames[preview.value.toLowerCase()] ?? preview.value;
  // An app Supervisor hasn't seen is only caught by its exact name, and "Teams" isn't "Microsoft Teams".
  const like = value.length >= 3 ? Object.values(appNames).find((name) => name.toLowerCase().includes(value.toLowerCase())) : undefined;
  const unseen = site || appNames[preview.value.toLowerCase()]
    ? ""
    : like
      ? `Did you mean ${like}? Type its full name.`
      : `Not seen on this computer yet. It's caught only if the app's name is exactly ${value}.`;
  return `
    <span class="rule-kind">${site ? "Website" : "App"}</span>
    <strong class="rule-preview-value">${escapeHtml(value)}</strong>
    ${unseen ? `<span class="rule-preview-note">${escapeHtml(unseen)}</span>` : ""}
  `;
}

function renderRuleEditor(editor: RuleEditor): string {
  const site = previewSite(editor);
  return `
    <form class="rule-editor" data-rule-form="rules" autocomplete="off">
      <label>
        <span>Website or app</span>
        <input id="rule-value" name="value" maxlength="300" spellcheck="false" value="${attr(editor.value)}" placeholder="youtube.com or Spotify" />
      </label>
      <label class="rule-name-field" ${site ? "" : "hidden"}>
        <span>Name</span>
        <input id="rule-name" name="name" maxlength="60" value="${attr(editor.name)}" placeholder="${attr(site ?? "")}" />
      </label>
      <p class="rule-preview" id="rule-preview" aria-live="polite">${renderRulePreview(editor)}</p>
      ${
        editor.index !== null && editor.confirmDelete
          ? `<div class="rule-editor-actions">
              <span class="rule-editor-ask">Stop counting ${escapeHtml(permanentRules[editor.index] ? ruleName(permanentRules[editor.index]) : "this")} as a distraction?</span>
              <button class="danger" type="button" data-rule-action="delete" data-rule-index="${editor.index}">Delete</button>
              <button type="button" data-rule-action="keep">Keep it</button>
            </div>`
          : `<div class="rule-editor-actions">
              <button class="primary ${rulePreviewReady(editor) ? "" : "is-quiet"}" type="submit">Save</button>
              ${editor.index === null ? "" : `<button class="danger" type="button" data-rule-action="delete" data-rule-index="${editor.index}">Delete</button>`}
              <button type="button" data-rule-action="cancel">Cancel</button>
            </div>`
      }
    </form>
  `;
}

function renderVoiceSettings(): string {
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
window.addEventListener("resize", () =>
  requestAnimationFrame(() => {
    fitShareStats();
    fitQuote();
  }),
);

/** Stat values never wrap or ellipsize: shrink the font until the value fits its tile. The
 *  report tiles use the system monospace, which is wider on a Mac (SF Mono) than on Windows,
 *  so "40:00 min" overflows there at the stylesheet's size. */
function fitShareStats(): void {
  document.querySelectorAll<HTMLElement>(".share-stats strong").forEach((value) => {
    let size = 1.1;
    value.style.fontSize = `${size}rem`;
    while (size > 0.72 && value.scrollWidth > value.clientWidth) {
      size -= 0.04;
      value.style.fontSize = `${size.toFixed(2)}rem`;
    }
  });
  document.querySelectorAll<HTMLElement>(".report-stat strong").forEach((value) => {
    value.style.fontSize = "";
    let size = parseFloat(getComputedStyle(value).fontSize) / 16;
    while (size > 0.9 && value.scrollWidth > value.clientWidth) {
      size -= 0.04;
      value.style.fontSize = `${size.toFixed(2)}rem`;
    }
  });
}

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

function fitVoiceCardNames(): void {
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

/** The first clip waits for the worker to load the model and the voice (about 90 s on a typical
 *  laptop); the worker stays loaded, so each later clip takes seconds (3-6 s measured on a Mac
 *  and a Windows laptop). Both rounded up, so the estimate is never the slow surprise. */
const FIRST_CLIP_SECONDS = 90;
const NEXT_CLIP_SECONDS = 15;

/** How long `count` clips take when `started` of the queue are already done. */
function clipQueueSeconds(count: number, started = 0): number {
  if (count <= 0) {
    return 0;
  }
  return started === 0 ? FIRST_CLIP_SECONDS + (count - 1) * NEXT_CLIP_SECONDS : count * NEXT_CLIP_SECONDS;
}

/** Redraws the personality and lines panels alone, so the voices, the tiles and the page scroll
 *  stay put. */
function paintClipsPanel(): void {
  if (!paintSlot("voice-lines", renderVoiceLinesArea())) {
    render();
  }
}

/** After a line or personality change: the lines panel and any open voice dialog. Voice cards don't show
 *  lines, so the rest of the page stays; an error shows above the page, so it needs the page. */
function paintLines(): void {
  if (voiceError) {
    render();
    return;
  }
  paintClipsPanel();
  paintVoiceLayer();
}

/** The personality forms and the voice rename form, inside `root`. */
function bindClipsControls(root: ParentNode): void {
  root.querySelector<HTMLFormElement>("#tone-rename")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void renameTone();
  });
  root.querySelector<HTMLInputElement>("#tone-rename-input")?.addEventListener("input", (event) => {
    if (toneRename) {
      toneRename.value = (event.target as HTMLInputElement).value;
    }
  });
  root.querySelector<HTMLFormElement>("#new-tone")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void createTone();
  });
  root.querySelector<HTMLInputElement>("#new-tone-input")?.addEventListener("input", (event) => {
    newToneDraft = (event.target as HTMLInputElement).value;
  });
  root.querySelector<HTMLFormElement>("#voice-rename")?.addEventListener("submit", (event) => {
    event.preventDefault();
    (document.getElementById("voice-rename-input") as HTMLInputElement | null)?.blur();
  });
  root.querySelector<HTMLInputElement>("#voice-rename-input")?.addEventListener("blur", () => void renameVoice());
}
function bindPhraseEditor(root: ParentNode): void {
  const phraseForm = root.querySelector<HTMLFormElement>("#phrase-editor");
  phraseForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveLine(true);
  });
  const text = phraseForm?.querySelector<HTMLTextAreaElement>('textarea[name="text"]');
  if (text) {
    fitLineBox(text);
  }
  text?.addEventListener("input", () => {
    fitLineBox(text);
    if (phraseEditor) {
      phraseEditor.text = text.value;
      const count = document.querySelector(".line-count");
      if (count) {
        count.textContent = `${text.value.length}/140`;
      }
      paintLinePopupButtons();
    }
  });
  // Enter submits, as the old single-line field did; a line is one sentence, never two rows.
  text?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !composing(event)) {
      event.preventDefault();
      phraseForm?.requestSubmit();
    }
  });
  phraseForm?.querySelector<HTMLSelectElement>('select[name="moment"]')?.addEventListener("change", (event) => {
    if (phraseEditor) {
      phraseEditor.moment = (event.target as HTMLSelectElement).value as PhraseMoment;
      paintLinePopupButtons();
    }
  });
}

/** The line box starts one row tall and grows with the words. */
function fitLineBox(text: HTMLTextAreaElement): void {
  text.style.height = "auto";
  text.style.height = `${text.scrollHeight + text.offsetHeight - text.clientHeight}px`;
}

/** Typing changes which buttons make sense; redraw just the popup's action row and audio note. */
function paintLinePopupButtons(): void {
  const holder = document.createElement("div");
  holder.innerHTML = renderLinePopup();
  for (const selector of [".line-popup-actions", ".line-audio-note"]) {
    const now = document.querySelector(selector);
    const next = holder.querySelector(selector);
    if (!now || !next) {
      continue;
    }
    now.replaceWith(next);
  }
}
/** A voice popup opening or closing repaints only the dialog layer; the page under it stays put. */
function paintVoiceLayer(): void {
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

/** "Derek speaks like Mom": the personality cards, then that personality's lines by moment. */
function renderVoiceLinesArea(): string {
  return `${renderVoiceGapNotice(clipsVoice(), "voice")}${renderPersonalityPanel()}${renderVoiceClipsPanel()}`;
}

function renderPersonalityPanel(): string {
  const voice = clipsVoice();
  const speaks = voiceTone(voice);
  const locked = !voice.profile || voiceBusy !== null || clipQueue?.phase === "working";
  const cards = phraseToneOrder()
    .map((tone) => {
      const on = sameTone(tone, speaks);
      const card = `<button class="personality-card ${on ? "is-on" : ""}" type="button" data-action="use-tone" data-tone="${attr(tone)}" aria-pressed="${on}" title="${attr(toneLabel(tone))}" ${locked ? "disabled" : ""}><span>${escapeHtml(toneLabel(tone))}</span></button>`;
      if (!on || !isCustomTone(tone)) {
        return card;
      }
      const menu = toneMenuOpen
        ? `<div class="personality-menu" role="menu">
            <button type="button" role="menuitem" data-action="rename-tone" data-tone="${attr(tone)}">Rename</button>
            <button class="danger" type="button" role="menuitem" data-action="arm-delete-tone" data-tone="${attr(tone)}">Delete</button>
          </div>`
        : "";
      return `
        <div class="personality-own">
          ${card}
          <button class="personality-more" type="button" data-action="toggle-tone-menu" aria-label="Rename or delete ${attr(toneLabel(tone))}" aria-haspopup="menu" aria-expanded="${toneMenuOpen}" ${locked ? "disabled" : ""}>⋯</button>
          ${menu}
        </div>`;
    })
    .join("");
  let form = "";
  if (toneRename) {
    form = `
      <form class="personality-form" id="tone-rename">
        <input id="tone-rename-input" maxlength="80" value="${attr(toneRename.value)}" aria-label="Personality name" autocomplete="off" />
        <button class="primary small-button" type="submit">Save</button>
        <button class="small-button" type="button" data-action="cancel-rename-tone">Cancel</button>
      </form>`;
  } else if (toneDeleteArmed) {
    const count = tonePhrases(toneDeleteArmed).length;
    form = `
      <div class="personality-form">
        <span>Delete ${escapeHtml(toneLabel(toneDeleteArmed))}${count ? ` and its ${count === 1 ? "1 line" : `${count} lines`}` : ""}? Voices that speak like it go back to ${escapeHtml(toneLabel(toneOrder[0]))}.</span>
        <button class="small-button danger" type="button" data-action="delete-tone" data-tone="${attr(toneDeleteArmed)}">Delete</button>
        <button class="small-button" type="button" data-action="cancel-delete-tone">Cancel</button>
      </div>`;
  }
  return `
    <section class="panel personality-panel">
      <p class="eyebrow">Personality</p>
      <div class="personality-head">
        <h2 class="speaks-like"><span class="speaks-voice" title="${attr(voice.name)}">${escapeHtml(voice.name)}</span> speaks like <span class="speaks-tone" title="${attr(toneLabel(speaks))}">${escapeHtml(toneLabel(speaks))}</span></h2>
        <button class="small-button" type="button" data-action="new-tone" aria-haspopup="dialog" ${canEditPhrases() ? "" : "disabled"}>+ New personality</button>
      </div>
      <div class="personality-list">${cards}</div>
      ${form}
    </section>
  `;
}

/** A name, and where its lines start: a copy of one you like, or nothing. */
function renderNewPersonalityModal(): string {
  if (newToneDraft === null) {
    return "";
  }
  const speaks = voiceTone(clipsVoice());
  return modal("voice-popup new-personality-popup", "new-personality-title", `
        <h2 id="new-personality-title">New personality</h2>
        <p>A personality is what your voices say. Start from one you like and change a few of its lines, or start with nothing and write your own.</p>
        <form class="phrase-editor" id="new-tone">
          <label>
            <span>Name</span>
            <input id="new-tone-input" maxlength="80" value="${attr(newToneDraft)}" placeholder="Coach, dry humor, drill sergeant…" autocomplete="off" />
          </label>
          <label>
            <span>Start from</span>
            <select id="new-tone-from">
              ${phraseToneOrder().map((tone) => `<option value="${attr(tone)}" ${sameTone(tone, speaks) ? "selected" : ""}>${escapeHtml(toneLabel(tone))}</option>`).join("")}
              <option value="">Nothing</option>
            </select>
          </label>
          <div class="modal-actions">
            <button type="button" data-action="cancel-new-tone">Cancel</button>
            <button class="primary" type="submit">Create</button>
          </div>
        </form>
      `);
}

/** The voice's personality, one card per moment. */
function renderVoiceClipsPanel(): string {
  const voice = clipsVoice();
  const tone = voiceTone(voice);
  return `
    <section class="panel phrase-panel">
      <h3 class="lines-title">What ${escapeHtml(voice.name)} says as ${escapeHtml(toneLabel(tone))}</h3>
      <div class="moment-grid">
        ${MOMENTS.map((moment) => renderMomentCard(voice, tone, moment)).join("")}
      </div>
      ${renderClipsFooter(voice, tonePhrases(tone))}
    </section>
  `;
}

function renderMomentCard(voice: VoiceOption, tone: VoiceTone, moment: (typeof MOMENTS)[number]): string {
  const phrases = momentPhrases(tone, moment.id);
  const count = phrases.length;
  const quiet: Record<PhraseMoment, string> = {
    nudge: `${voice.name} stays quiet when you get distracted.`,
    phone: `${voice.name} says a back to work line instead.`,
    roundover: `${voice.name} stays quiet when a round ends.`,
    sessionover: `${voice.name} stays quiet when a session ends.`,
  };
  const more = 3 - count;
  const nudge =
    moment.often && more > 0
      ? `<div class="moment-nudge" role="note"><strong>${count ? `Only ${count}? That gets old fast.` : "This one plays a lot."}</strong><span>Three or more keeps it from repeating. Write ${more} more.</span></div>`
      : "";
  return `
    <div class="clips-card moment-card">
      <div class="moment-head">
        <p class="eyebrow">${escapeHtml(moment.label)}</p>
        <span>${count === 1 ? "1 line" : `${count} lines`}</span>
        <span class="moment-when">${escapeHtml(moment.when)}</span>
      </div>
      ${count ? `<div class="line-list">${phrases.map((phrase) => renderLineRow(voice, phrase)).join("")}</div>` : `<p class="empty">No lines yet. ${escapeHtml(quiet[moment.id])}</p>`}
      ${nudge}
      <div class="moment-foot">
        <button class="small-button" type="button" data-action="add-line" data-moment="${moment.id}" ${canEditPhrases() ? "" : "disabled"}>+ Add line</button>
      </div>
    </div>
  `;
}

function renderLineRow(voice: VoiceOption, phrase: PhraseDefinition): string {
  const clip = clipForPhrase(voice, phrase);
  const job = clipQueue && clipQueue.voiceId === voice.id ? clipQueue : null;
  const position = job ? job.phraseIds.indexOf(phrase.id) : -1;
  const busy = Boolean(job && position === job.index && job.phase === "working");
  const failed = Boolean(job && position === job.index && job.phase === "error");
  const queued = Boolean(job && job.phase === "working" && position > job.index);
  const edit = `<button class="small-button" type="button" data-action="open-phrase-editor" data-phrase-id="${attr(phrase.id)}" ${!busy && canEditPhrases() ? "" : "disabled"}>Edit</button>`;
  const play = clip
    ? `<button class="voice-play" type="button" data-action="play-clip" data-clip-path="${attr(clip.path)}" aria-label="Play">
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.2v9.6L11 6z" fill="currentColor"/></svg>${MINI_ORB}
      </button>`
    : "";
  let trail: string;
  if (busy) {
    trail = `<span class="line-state is-busy" data-clip-elapsed>${escapeHtml(clipElapsedText())}</span>`;
  } else if (failed) {
    trail = `<span class="line-state is-bad" title="${attr(job?.error ?? "")}">Failed</span><button class="small-button" type="button" data-action="generate-clip" data-phrase-id="${attr(phrase.id)}">Retry</button>${edit}`;
  } else if (queued) {
    trail = `<span class="line-state">Queued</span>${edit}${play}`;
  } else if (clip) {
    trail = `${edit}${play}`;
  } else {
    trail = `<span class="line-state">Not generated</span>${edit}`;
  }
  return `
    <div class="line-row ${clip ? "" : "is-missing"} ${busy ? "is-busy" : ""}">
      <span class="line-dot ${clip ? "is-ready" : ""}" aria-hidden="true"></span>
      <span class="line-text">${escapeHtml(phrase.text)}</span>
      <span class="line-actions">${trail}</span>
    </div>
  `;
}
function clipElapsedText(): string {
  const seconds = clipQueue ? Math.max(0, Math.round((performance.now() - clipQueue.startedAt) / 1000)) : 0;
  const expected = clipQueue && clipQueue.index > 0 ? NEXT_CLIP_SECONDS : FIRST_CLIP_SECONDS;
  return `Making · ${seconds} s of ~${expected} s`;
}

function paintClipQueue(): void {
  const label = document.querySelector("[data-clip-elapsed]");
  if (label && clipQueue?.phase === "working") {
    label.textContent = clipElapsedText();
  }
}

function renderClipsFooter(voice: VoiceOption, phrases: PhraseDefinition[]): string {
  const job = clipQueue && clipQueue.voiceId === voice.id ? clipQueue : null;
  if (job && job.phase === "working") {
    const total = job.phraseIds.length;
    const left = clipQueueSeconds(Math.max(1, total - job.index), job.index);
    return `
      <div class="clips-foot">
        <button class="small-button" type="button" data-action="stop-clip-queue" ${job.stopAfter ? "disabled" : ""}>${job.stopAfter ? "Stopping after this line" : "Stop after this line"}</button>
        <button class="small-button danger" type="button" data-action="cancel-clip-queue">Cancel</button>
        <span class="clips-hint">${job.index} of ${total} done · about ${escapeHtml(formatQueueTime(left))} left</span>
      </div>
    `;
  }
  if (phrases.length === 0) {
    return `
      <div class="clips-foot">
        <span class="clips-hint">A personality needs at least one back to work line before a voice can use it.</span>
      </div>
    `;
  }
  const missing = phrases.filter((phrase) => !clipForPhrase(voice, phrase));
  if (missing.length === 0) {
    return `
      <div class="clips-foot">
        <span class="clips-hint is-ready">All ${phrases.length} lines ready.</span>
      </div>
    `;
  }
  const lock = clipGenerateLockTitle(voice);
  // A failed line says why here, where the eye already is; the row only says "Failed".
  const failed = job?.phase === "error" && !lock ? job.error || "This line could not be generated." : "";
  const hint = lock || (failed ? `Last line failed: ${failed}` : `The first line takes about ${FIRST_CLIP_SECONDS} s while the voice engine warms up, then about ${NEXT_CLIP_SECONDS} s each.`);
  return `
    <div class="clips-foot">
      <div class="clips-foot-actions">
        <button class="primary small-button clips-generate" type="button" data-action="generate-missing" ${lock || clipQueue?.phase === "working" ? "disabled" : ""}>Generate ${missing.length} ${missing.length === 1 ? "line" : "lines"} · ~${escapeHtml(formatQueueTime(clipQueueSeconds(missing.length)))}</button>
        <span class="clips-hint ${failed || lock ? "is-bad" : ""}" role="${failed ? "alert" : "status"}">${escapeHtml(hint)}</span>
      </div>
    </div>
  `;
}
/** One popup per line: edit the words, move it, make its clip, or delete it. The primary button
 * says what it will do, and one click does all of it. */
function renderLinePopup(): string {
  const editor = phraseEditor;
  if (!editor) {
    return "";
  }
  const voice = clipsVoice();
  const existing = editor.phraseId ? effectivePhrases().find((item) => item.id === editor.phraseId) ?? null : null;
  const clip = existing ? clipForPhrase(voice, existing) : null;
  const text = editor.text.trim();
  const changed = existing ? text !== existing.text : text.length > 0;
  const moved = Boolean(existing && existing.moment !== editor.moment);
  const lock = clipQueue?.phase === "working" ? "Wait for the current line to finish" : clipGenerateLockTitle(voice);
  const primary = !existing ? "Add and generate" : changed ? "Save and regenerate" : clip ? "Regenerate" : "Generate";
  const primaryDisabled = Boolean(lock) || !text || voiceBusy !== null;
  const audio = clip
    ? `<div class="line-audio-block">
        <span class="line-audio-label">Audio</span>
        <div class="line-audio ${changed ? "is-stale" : ""}">
          <button class="voice-preview-play" type="button" data-action="play-clip" data-clip-path="${attr(clip.path)}" aria-label="Play"><span class="voice-preview-icon" aria-hidden="true"></span>${MINI_ORB}</button>
          <canvas class="line-audio-wave" width="300" height="36" data-wave-path="${attr(clip.path)}" data-wave-bars="32"></canvas>
        </div>
        <p class="line-audio-note">${changed ? "This audio says the old words. Saving removes it from every voice." : ""}</p>
      </div>`
    : "";
  return modal("voice-popup line-popup", "line-popup-title", `
        <div class="voice-info-head">
          <div>
            <p class="eyebrow">${escapeHtml(toneLabel(editor.tone))} · ${escapeHtml(voice.name)}</p>
            <h2 id="line-popup-title">${existing ? "Edit line" : "New line"}</h2>
          </div>
          <button class="small-button" type="button" data-action="cancel-phrase-editor">Close</button>
        </div>
        <form class="phrase-editor" id="phrase-editor">
          <label>
            <textarea id="phrase-editor-text" aria-label="Line" name="text" rows="1" maxlength="140" placeholder="Back to the task." autocomplete="off">${escapeHtml(editor.text)}</textarea>
          </label>
          <span class="line-count">${editor.text.length}/140</span>
          <label>
            <span>Plays when</span>
            <select id="phrase-editor-moment" name="moment">
              ${MOMENTS.map((moment) => `<option value="${moment.id}" ${moment.id === editor.moment ? "selected" : ""}>${escapeHtml(moment.label)}: ${escapeHtml(moment.when.charAt(0).toLowerCase() + moment.when.slice(1))}</option>`).join("")}
            </select>
          </label>
          ${audio}
          ${
            existing && editor.confirmDelete
              ? `<div class="modal-actions line-popup-actions">
                  <span class="line-popup-ask">Delete this line?</span>
                  <button type="button" data-action="keep-phrase">Keep it</button>
                  <button class="danger" type="button" data-action="delete-phrase" data-phrase-id="${attr(existing.id)}">Delete</button>
                </div>`
              : `<div class="modal-actions line-popup-actions">
                  ${existing ? `<button class="danger" type="button" data-action="delete-phrase" data-phrase-id="${attr(existing.id)}" ${canEditPhrases() ? "" : "disabled"}>Delete</button>` : ""}
                  <span class="line-popup-gap"></span>
                  ${changed || moved || !existing ? `<button type="button" data-action="save-line" ${text && canEditPhrases() ? "" : "disabled"}>${existing ? "Save only" : "Add only"}</button>` : ""}
                  <button class="primary" type="submit" ${primaryDisabled ? "disabled" : ""} title="${attr(lock)}">${primary}</button>
                </div>`
          }
        </form>
        ${lock ? `<p class="quiet">${escapeHtml(lock)}</p>` : ""}
      `);
}

function closeToneForms(): void {
  toneRename = null;
  toneDeleteArmed = null;
  newToneDraft = null;
  toneMenuOpen = false;
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

function renderVoiceDialogs(): string {
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

/** Size first (it's tiny), then what deleting costs. */
function deleteAllCopy(bytes: number | null | undefined): string[] {
  const cost =
    "It's also how Supervisor shows you where your time actually goes. Delete it and your attention span, trends and recaps start over from nothing. This can't be undone.";
  if (!bytes) {
    return [cost.replace("It's also how", "History is how")];
  }
  const ratio = PHOTO_BURST_BYTES / bytes;
  const comparison =
    ratio >= 2
      ? `so deleting it frees about 1/${Math.round(ratio)} of a single burst`
      : ratio >= 0.5
        ? "so it's about one burst"
        : `so it's about ${Math.round(1 / ratio)} bursts`;
  return [
    `All of it takes up ${formatBytes(bytes)}. A quick burst of phone photos is around 30 MB, ${comparison}.`,
    cost,
  ];
}

function renderHistoryConfirm(): string {
  if (!historyConfirm) {
    return "";
  }

  const copy =
    historyConfirm.kind === "delete-all"
      ? {
          eyebrow: "YOUR DATA",
          title: "Delete all history?",
          body: deleteAllCopy(historyConfirm.bytes),
          cancel: "Keep my history",
          confirm: "Delete everything",
        }
      : {
          eyebrow: "HISTORY",
          title: "Delete this session?",
          body: ["This session will be removed from this computer. You cannot undo this."],
          cancel: "Cancel",
          confirm: "Delete session",
        };
  const body = copy.body.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
  return confirmModal("history-confirm-title", copy.eyebrow, copy.title, body, ["cancel-history-confirm", copy.cancel], ["confirm-history", copy.confirm]);
}

function renderQuitConfirm(): string {
  if (!quitConfirmOpen) {
    return "";
  }
  const body = "<p>The session so far is saved to History.</p>";
  return confirmModal("quit-confirm-title", "QUIT", "End this session and quit?", body, ["cancel-quit", "Cancel"], ["confirm-quit", "End and quit"]);
}

/** Session done (yellow, the round-over card's shape): the session's title and focused time,
 *  the voice with its orb, and one button to the report under it. */
function renderSessionOver(): string {
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

function renderHistory(): string {
  if (historyView === "report" && sessionReport) {
    return `${renderSessionReport(sessionReport)}<div id="review-layer" class="slot">${renderReviewLayer()}</div>`;
  }
  if (historyView === "trends") {
    return renderTrends();
  }
  return `
    <section class="history-page">
      ${renderHistoryToolbar(historyWeekShown())}
      <div id="history-body" class="slot">${renderHistoryBody()}</div>
    </section>
  `;
}

function historyWeekShown(): string {
  return historyWeek?.week_start || historyWeekStart || thisMondayKey();
}

/** Everything under the toolbar: search results, or the week's charts and lists. */
function renderHistoryBody(): string {
  if (historySearch.trim()) {
    return renderSearchResults();
  }
  const weekStart = historyWeekShown();
  const sessions = historyWeek?.sessions ?? [];
  const recap = weekRecap && weekRecap.start === weekStart ? weekRecap : null;
  // Both charts rise together on arriving at the tab and on the first draw of another week's
  // data; a pane switch or a poll later leaves the bars standing.
  const animate = recap !== null && (takeAnimation("history") || historyChartsFor !== weekStart);
  if (recap) {
    historyChartsFor = weekStart;
  }
  const emptyWeek = historyWeek?.oldest_day
    ? "No sessions this week."
    : "Finish a session and its report shows up here. Nothing leaves this computer.";
  return `
    <div class="history-hero">
      ${renderWeekHero(weekStart, recap, animate)}
      <div class="history-side">
        ${renderShareDoor(weekStart, recap)}
        ${renderTrendsDoor(weekStart, recap, animate)}
      </div>
    </div>
    <div class="history-seg-row">
      <div class="history-seg" role="group" aria-label="Show">
        <button type="button" class="${historyPane === "sessions" ? "is-on" : ""}" aria-pressed="${historyPane === "sessions"}" data-action="history-pane" data-pane="sessions">Sessions · ${sessions.length}</button>
        <button type="button" class="${historyPane === "apps" ? "is-on" : ""}" aria-pressed="${historyPane === "apps"}" data-action="history-pane" data-pane="apps">Apps &amp; sites · ${recap?.apps.length ?? 0}</button>
      </div>
    </div>
    ${historyPane === "apps" ? renderWeekAppsPane(recap) : renderSessionsPane(sessions, emptyWeek)}
  `;
}

/** A small card above the Trends door that opens the Share popup: the viewed week and its
 *  month as pictures. Before the first session it stays, dimmed, so the column keeps its shape. */
function renderShareDoor(weekStart: string, recap: WeekRecap | null): string {
  const ready = recap !== null && recap.start === weekStart && historyWeek?.oldest_day != null;
  return `
    <button type="button" class="panel share-door" data-action="open-share" ${ready ? "" : 'aria-disabled="true"'}>
      <span class="share-door-text">
        <span class="eyebrow">Share</span>
        <strong>${ready ? "Week and month cards" : "Nothing to share yet"}</strong>
      </span>
      ${ready ? '<span class="trend-door-go" aria-hidden="true">Open ›</span>' : ""}
    </button>
  `;
}

/** The Share popup: the week card and the month card drawn as they will be copied, each with
 *  its button. The month is fetched before it opens, so it opens once, at its full size. */
function renderShareModal(): string {
  if (!shareOpen) {
    return "";
  }
  // The cards go in as canvases, not encoded images: encoding two large PNGs on every paint
  // held up the popup. They are swapped in once this markup is in the page, before it paints.
  queueMicrotask(mountShareCards);
  const week = weekRecap && weekRecap.start === historyWeekStart ? weekRecap : null;
  const month = shareMonth && shareMonth.start.slice(0, 7) === historyWeekStart.slice(0, 7) ? shareMonth : null;
  return modal("share-panel", "share-title", `
        <div class="modal-head share-head">
          <div>
            <p class="eyebrow">History</p>
            <h2 id="share-title">Share</h2>
            <p class="share-sub">Click a card to copy it, then paste it anywhere.</p>
          </div>
          <button type="button" data-action="close-share">Cancel</button>
        </div>
        <div class="share-grid">
          ${renderShareColumn(week !== null, "week", "copy-week-card", week !== null && week.session_count > 0, "No sessions this week")}
          ${renderShareColumn(month !== null, "month", "copy-month-card", month !== null && month.session_count > 0, "No sessions this month")}
        </div>
      `);
}

/** The card is the button, like the day card on Home: a click copies it. A period with no
 *  sessions shows its card, still, with a line saying why it can't be copied. */
function renderShareColumn(drawn: boolean, card: "week" | "month", action: string, ready: boolean, note: string): string {
  if (!drawn) {
    return `<div class="share-col"><div class="share-preview share-preview-empty" aria-hidden="true"></div></div>`;
  }
  const slot = `<span class="share-preview" data-share-card="${card}"></span>`;
  return `
    <div class="share-col">
      ${ready ? `<button type="button" class="share-pick" data-action="${action}" aria-label="Copy the ${card} card">${slot}</button>` : slot}
      ${ready ? "" : `<p class="share-note">${escapeHtml(note)}</p>`}
    </div>
  `;
}

/** Draws each card into its place in the popup. */
function mountShareCards(): void {
  document.querySelectorAll<HTMLElement>("[data-share-card]").forEach((slot) => {
    const week = slot.dataset.shareCard === "week";
    const canvas = week ? (weekRecap ? drawWeekCard(weekRecap) : null) : shareMonth ? drawMonthCard(shareMonth) : null;
    if (!canvas) {
      return;
    }
    canvas.className = "share-preview";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", week ? "Week card" : "Month card");
    slot.replaceWith(canvas);
  });
}

async function fetchShareMonth(): Promise<MonthRecap | null> {
  try {
    return await invoke<MonthRecap>("get_month_recap", { start: historyWeekStart });
  } catch (error) {
    showFeedback(`Could not load the month: ${errorText(error)}`);
    return null;
  }
}

/** The Monday of the first recorded week. With no history yet it is this week: nothing
 *  before the app was in use can be reached, by arrow or by picker. */
function oldestWeekMonday(): string {
  return historyWeek?.oldest_day ? mondayKey(historyWeek.oldest_day) : thisMondayKey();
}

function renderHistoryToolbar(weekStart: string): string {
  const oldestMonday = oldestWeekMonday();
  const current = thisMondayKey();
  const prevDisabled = weekStart <= oldestMonday;
  const nextDisabled = weekStart >= current;
  const tag = weekStart === current ? "This week" : weekStart === addDaysKey(current, -7) ? "Last week" : "";
  return `
    <div class="panel history-toolbar">
      <div class="history-week-nav">
        <button type="button" class="history-week-arrow" data-action="history-week-prev" ${prevDisabled ? "disabled" : ""} aria-label="Previous week">‹</button>
        <button type="button" class="history-week-label ${weekPickerOpen ? "is-open" : ""}" data-action="toggle-week-picker" aria-expanded="${weekPickerOpen}" aria-haspopup="dialog" title="Pick a week">
          <h2>${escapeHtml(formatWeekRange(weekStart))}${tag ? `<span>${tag}</span>` : ""}</h2>
        </button>
        <button type="button" class="history-week-arrow" data-action="history-week-next" ${nextDisabled ? "disabled" : ""} aria-label="Next week">›</button>
        ${weekStart === current ? "" : `<button type="button" class="history-week-today" data-action="history-week-today">This week</button>`}
      </div>
      <div id="week-picker-slot" class="slot">${weekPickerOpen ? renderWeekPicker(weekStart, oldestMonday) : ""}</div>
      <label class="history-search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
        <input id="history-search" type="search" value="${attr(historySearch)}" placeholder="Search session names" aria-label="Search sessions by name" autocomplete="off" spellcheck="false" />
      </label>
    </div>
  `;
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const PICKER_GRID_DAYS = 42;

/** A month of days, shaded by focused time, with the viewed week outlined; a click picks that
 * day's week. */
function renderWeekPicker(weekStart: string, oldestMonday: string): string {
  const month = pickerMonth || monthKey(weekStart);
  const today = dayKey(new Date());
  const currentMonth = monthKey(today);
  const weekEnd = addDaysKey(weekStart, 6);
  const gridStart = mondayKey(month);
  const prevDisabled = month <= monthKey(oldestMonday);
  const nextDisabled = month >= currentMonth;
  const title = parseDayKey(month).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const cells = Array.from({ length: PICKER_GRID_DAYS }, (_, index) => {
    const day = addDaysKey(gridStart, index);
    const inMonth = day.slice(0, 7) === month.slice(0, 7);
    // Nothing before the first recorded week, same bound as the ‹ arrow.
    const future = day > today || mondayKey(day) < oldestMonday;
    const focus = pickerDays[day]?.focus_seconds ?? 0;
    const level = focus <= 0 ? "" : focus >= 90 * 60 ? "l3" : focus >= 25 * 60 ? "l2" : "l1";
    const classes = [
      "wp-day",
      inMonth ? "" : "is-out",
      future ? "is-future" : "",
      level,
      day >= weekStart && day <= weekEnd ? "is-selected" : "",
      day === today ? "is-today" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const info = pickerDays[day];
    const label = info
      ? `${parseDayKey(day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}, ${formatHours(info.focus_seconds)} focused`
      : parseDayKey(day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    return `<button type="button" class="${classes}" data-action="pick-week" data-day="${day}" ${future ? "disabled" : ""} aria-label="${attr(label)}" title="${attr(label)}">${Number(day.slice(8))}</button>`;
  });
  // Each week is one row, so hovering any of its days lights the whole week: the thing a click picks.
  const rows = Array.from({ length: cells.length / 7 }, (_, week) => `<div class="wp-week">${cells.slice(week * 7, week * 7 + 7).join("")}</div>`).join("");
  return `
    <div class="panel week-picker" role="dialog" aria-label="Pick a week">
      <div class="week-picker-head">
        <button type="button" data-action="picker-month-prev" ${prevDisabled ? "disabled" : ""} aria-label="Previous month">‹</button>
        <strong>${escapeHtml(title)}</strong>
        <button type="button" data-action="picker-month-next" ${nextDisabled ? "disabled" : ""} aria-label="Next month">›</button>
      </div>
      <div class="week-picker-grid">
        ${["M", "T", "W", "T", "F", "S", "S"].map((d) => `<span class="wp-dow" aria-hidden="true">${d}</span>`).join("")}
        ${rows}
      </div>
      <p class="week-picker-note">Click any day to see its week. Greener days had more focused time.</p>
    </div>
  `;
}

/** Loads the days with sessions for the month the picker shows. */
async function loadPickerDays(): Promise<void> {
  const month = pickerMonth || monthKey(historyWeekStart || thisMondayKey());
  const start = mondayKey(month);
  const request = ++pickerRequest;
  try {
    const days = await invoke<DailyFocus[]>("get_focus_days", { start, end: addDaysKey(start, PICKER_GRID_DAYS) });
    if (request !== pickerRequest) {
      return;
    }
    pickerDays = Object.fromEntries(days.map((day) => [day.date, day]));
  } catch (error) {
    if (request !== pickerRequest) {
      return;
    }
    setLastError(errorText(error));
    render();
    return;
  }
  paintWeekPicker();
}

function closeWeekPicker(): void {
  weekPickerOpen = false;
  pickerMonth = "";
  pickerDays = {};
  pickerRequest += 1;
}

/** Focused hours, longest stretch and recovery for the week, over its daily bars. */
function renderWeekHero(weekStart: string, recap: WeekRecap | null, animate: boolean): string {
  const current = weekStart === thisMondayKey();
  const empty = recap !== null && recap.session_count === 0;
  const note = !recap
    ? ""
    : empty
      ? current
        ? "No sessions yet this week. Finish one and today's bar fills in."
        : "No sessions that week."
      : current && recap.session_count === 1
        ? "1 session so far"
        : `${recap.session_count} sessions${current ? " so far" : ""}`;
  const buckets = recap?.buckets ?? WEEKDAY_LABELS.map((label) => ({ label, focus_seconds: 0 }));
  const max = Math.max(...buckets.map((bucket) => bucket.focus_seconds), 1);
  const todayIndex = current ? (new Date().getDay() + 6) % 7 : -1;
  const longest = recap?.longest_stretch_seconds ? formatStretchChip(recap.longest_stretch_seconds) : "—";
  const recovery =
    recap?.recovery_median_seconds != null
      ? formatRecovery(recap.recovery_median_seconds)
      : recap && recap.session_count > 0
        ? "None"
        : "—";
  return `
    <section class="panel week-hero" aria-label="${current ? "This week" : "That week"}">
      <p class="eyebrow">${current ? "This week" : "Focused time"}</p>
      <div class="week-hero-top">
        <div class="week-hero-figure">
          <strong class="week-hero-value">${escapeHtml(formatHours(recap?.focus_seconds ?? 0))}</strong>
          ${note ? `<p class="week-hero-note">${escapeHtml(note)}</p>` : ""}
        </div>
        <div class="week-hero-stats">
          ${flipStat("week-hero-stat", "Longest stretch", longest, empty ? "Longest run of work in one go, once there is one." : "Longest run of work without a distraction or stepping away.")}
          ${flipStat("week-hero-stat", "Recovery", recovery, recovery === "None" ? "No distraction this week, so nothing to recover from." : "Typical time back to work after a distraction.")}
        </div>
      </div>
      <div class="recap-bars week-hero-bars ${animate ? "is-animated" : ""}" style="grid-template-columns: repeat(${buckets.length}, minmax(0, 1fr))">
        ${buckets
          .map((bucket, index) => {
            const on = bucket.focus_seconds > 0;
            const focused = formatHours(bucket.focus_seconds);
            const classes = ["recap-bar", on ? "is-on" : "", index === todayIndex ? "is-today" : ""].filter(Boolean).join(" ");
            return `
              <button type="button" class="recap-bar-col" aria-label="${attr(bucket.label)}, ${attr(focused)} focused">
                <span class="recap-bar-track">
                  <span class="${classes}" style="--i: ${index}; ${on ? `height: ${smartBarHeight(bucket.focus_seconds, max, 14)}%` : ""}">
                    <span class="week-tip">${escapeHtml(focused)}</span>
                  </span>
                </span>
                <span class="recap-bar-label">${escapeHtml(bucket.label)}</span>
              </button>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

/** The week against the one before it, a sparkline of recent weeks, and the way into Trends. */
function renderTrendsDoor(weekStart: string, recap: WeekRecap | null, animate: boolean): string {
  const weeks = trends.weeks;
  const previousStart = addDaysKey(weekStart, -7);
  const previous = weeks.find((week) => week.start === previousStart);
  const current = weekStart === thisMondayKey();
  const todayIndex = (new Date().getDay() + 6) % 7;
  let value = "—";
  let caption = "Nothing to compare";
  if (!recap) {
    caption = "";
  } else if (weeks.length === 0) {
    value = "No weeks yet";
    caption = "Finish a session and this week starts the chart.";
  } else if (!previous) {
    const first = weeks[0].start === weekStart && !trends.has_earlier;
    value = first ? "First week" : "Off the chart";
    caption = first ? "nothing before it" : "older weeks are in Trends";
  } else if (previous.session_count === 0 && recap.session_count === 0) {
    value = "Quiet";
    caption = current ? "no sessions this week or last" : "no sessions either week";
  } else if (recap && previous && (previous.session_count > 0 || recap.session_count > 0)) {
    const before = current && todayIndex < 6 ? focusThrough(previousStart, todayIndex) : previous.focus_seconds;
    // A running week is measured against last week up to the same weekday; "so far" says so.
    const against = current ? "last week" : "the week before";
    const soFar = current && todayIndex < 6 ? ", so far" : "";
    const change = recap.focus_seconds - before;
    if (Math.abs(change) < 60) {
      value = "Steady";
      caption = `same as ${against}${soFar}`;
    } else {
      value = `${change > 0 ? "↑" : "↓"} ${formatHours(Math.abs(change))}`;
      caption = `vs ${against}${soFar}`;
    }
  }
  const shown = weeks.slice(-DOOR_WEEKS);
  // The card is the door: a click anywhere on it opens Trends, except on a week's bar, which
  // is its own button and opens that week here. Keyboard: the card takes focus; Enter opens.
  return `
    <section class="panel trend-door ${shown.length ? "has-chart" : ""}" role="button" tabindex="0" data-action="open-trends" aria-label="View trends">
      <div class="trend-door-head">
        <p class="eyebrow">Trends</p>
        <span class="trend-door-go" aria-hidden="true">View trends ›</span>
      </div>
      <div class="trend-door-line ${weeks.length === 0 && recap ? "is-stacked" : ""}">
        <strong class="trend-door-value">${escapeHtml(value)}</strong>
        <span class="trend-door-caption">${escapeHtml(caption)}</span>
      </div>
      ${shown.length ? renderDoorChart(shown, weekStart, animate) : ""}
    </section>
  `;
}

/** Weeks on the door's chart. */
const DOOR_WEEKS = 4;

/** Plain bars, newest week at the right, no axis: the figure above says what they mean. */
function renderDoorChart(shown: TrendPeriod[], weekStart: string, animate: boolean): string {
  const maxWeek = Math.max(...shown.map((week) => week.focus_seconds), 1);
  const pad = DOOR_WEEKS - shown.length;
  const running = thisMondayKey();
  return `
    <div class="trend-spark ${animate ? "is-animated" : ""}" role="img" aria-label="Focused hours per week, last ${shown.length} weeks">
      ${'<span class="trend-spark-track"><span class="trend-spark-bar is-empty"></span></span>'.repeat(pad)}
      ${shown
        .map((week, index) => {
          const classes = ["trend-spark-bar", week.start === weekStart ? "is-viewed" : "", week.start === running ? "is-running" : "", week.focus_seconds === 0 ? "is-empty" : ""].filter(Boolean).join(" ");
          const sessions = week.session_count === 1 ? "1 session" : `${week.session_count} sessions`;
          const tip = `${formatWeekStart(week.start)} · ${formatHours(week.focus_seconds)}${week.start === running ? " so far" : ""}`;
          return `
            <button type="button" class="trend-spark-track" data-action="pick-week" data-day="${attr(week.start)}" aria-label="${attr(`${tip} · ${sessions}. Show this week`)}">
              <span class="${classes}" style="--i: ${index}; ${week.focus_seconds ? `height: ${smartBarHeight(week.focus_seconds, maxWeek, 14)}%` : ""}">
                <span class="week-tip">${escapeHtml(tip)}</span>
              </span>
            </button>
          `;
        })
        .join("")}
    </div>
    <div class="trend-spark-labels" aria-hidden="true">
      ${"<span></span>".repeat(pad)}
      ${shown
        .map((week) => {
          const text = week.start === running ? "So far" : formatWeekStart(week.start);
          return `<span class="${week.start === weekStart ? "is-viewed" : ""}">${escapeHtml(text)}</span>`;
        })
        .join("")}
    </div>
  `;
}

/** Focused seconds from `weekStart` through its `weekdayIndex`th day (0 = Monday). */
function focusThrough(weekStart: string, weekdayIndex: number): number {
  const end = addDaysKey(weekStart, weekdayIndex);
  return trends.daily_focus
    .filter((day) => day.date >= weekStart && day.date <= end)
    .reduce((sum, day) => sum + day.focus_seconds, 0);
}

function renderSessionsPane(sessions: SessionSummary[], emptyText: string): string {
  return `
    <section class="panel history-list-panel">
      <div class="history-list">
        ${
          sessions.length === 0
            ? `<p class="empty">${escapeHtml(emptyText)}</p>`
            : groupSessionsByDay(sessions)
                .map(
                  (group) => `
            <section class="history-day">
              <div class="history-day-head">
                <p class="eyebrow">${escapeHtml(group.label)}</p>
                <p class="history-day-total">${escapeHtml(dayTotalLine(group.items))}</p>
              </div>
              ${group.items.map(renderHistoryItem).join("")}
            </section>
          `,
                )
                .join("")
        }
      </div>
    </section>
  `;
}

function renderSearchResults(): string {
  const query = historySearch.trim();
  const results = historySearchResults;
  if (results === null) {
    return `<section class="panel history-list-panel"><p class="empty">Searching…</p></section>`;
  }
  const count = results.length === 1 ? "1 session" : `${results.length} sessions`;
  return `
    <div class="history-search-head">
      <p class="eyebrow">${count} matching “${escapeHtml(query)}”</p>
      ${results.length >= SEARCH_LIMIT ? `<p>Showing the newest ${SEARCH_LIMIT}</p>` : ""}
    </div>
    ${renderSessionsPane(results, "No session name matches that.")}
  `;
}

/** `search_sessions` stops here; past it the list says so. */
const SEARCH_LIMIT = 100;

function renderWeekAppsPane(recap: WeekRecap | null): string {
  if (!recap || recap.session_count === 0) {
    return `<section class="panel history-list-panel"><p class="empty">No sessions this week, so there are no apps and sites to show yet.</p></section>`;
  }
  const work = recap.apps.filter((app) => app.group === "Work");
  const distractions = recap.apps.filter((app) => app.group === "Distractions");
  const away = recap.apps.filter((app) => app.group === "Away");
  if (work.length + distractions.length === 0) {
    return `<section class="panel history-list-panel"><p class="empty">Sessions ran, but Supervisor couldn't name any app or site. Time on the desktop or in a window it couldn't read isn't listed.</p></section>`;
  }
  return `<section class="panel week-apps">${renderAppColumns(recap.apps, null, "week")}</section>`;
}

function renderHistoryItem(item: SessionSummary): string {
  const time = new Date(item.started_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const hints = item.top_hints.join(" / ");
  return `
    <button class="history-item" type="button" data-action="open-report" data-session-id="${item.id}">
      <div>
        <h3>${escapeHtml(item.goal)}</h3>
        <p>${escapeHtml(hints ? `${time} · ${hints}` : time)}</p>
      </div>
      <div class="history-item-stats">
        <dl>
          <div title="Time on work: not on a distraction, your phone or watch, or away"><dt>Focused</dt><dd>${escapeHtml(formatHours(item.focus_seconds))}</dd></div>
          <div title="How long the session ran"><dt>Duration</dt><dd>${formatSpan(item.duration_seconds)}</dd></div>
          <div title="Times Supervisor spoke up about a distraction"><dt>Reminders</dt><dd>${item.nudges}</dd></div>
        </dl>
        ${renderMiniTimeline(item)}
      </div>
    </button>
  `;
}

/** A row the user can rename or move: a real app or site, not the phone, Away or Supervisor. */
function editableApp(app: RecapApp): boolean {
  return (app.kind === "website" || app.kind === "app") && !["untracked", "supervisor", "phone"].includes(app.key);
}

/** What the session allowed once, at any point: "website:youtube.com", "app:slack". */
export function allowedInReport(report: SessionReport): Set<string> {
  return new Set(report.events.filter((event) => event.kind === "allowed" && event.detail).map((event) => (event.detail ?? "").toLowerCase()));
}

export function renderAppColumns(apps: RecapApp[], sessionId: number | null, period: "session" | "week", allowed = new Set<string>()): string {
  const work = apps.filter((app) => app.group === "Work");
  const distractions = apps.filter((app) => app.group === "Distractions");
  const away = apps.filter((app) => app.group === "Away");
  const column = (title: string, items: RecapApp[], emptyText: string) => {
    const total = items.reduce((sum, app) => sum + app.seconds, 0);
    return `
      <div class="recap-app-block">
        <p class="eyebrow">${escapeHtml(title)}${items.length ? ` · ${escapeHtml(formatHours(total))}` : ""}</p>
        <div class="recap-app-group">${items.length ? renderAppRows(items, sessionId, allowed) : `<p class="week-app-empty">${escapeHtml(emptyText)}</p>`}</div>
      </div>
    `;
  };
  const awayLine = away.map((row) => `${row.label} ${formatHours(row.seconds)}`).join(" · ");
  const editable = apps.some((item) => editableApp(item));
  return `
    <div class="week-app-cols">
      ${column("Work", work, "Every minute was on something from the distractions list.")}
      ${column("Distractions", distractions, period === "week" ? "Nothing from the distractions list came up this week." : "Nothing from the distractions list came up.")}
    </div>
    ${awayLine || editable ? `<div class="week-app-foot">${awayLine ? `<span>${escapeHtml(awayLine)}</span>` : ""}${editable ? `<span>${APP_EDIT_HINT}</span>` : ""}</div>` : ""}
  `;
}

const APP_EDIT_HINT = "Click a row to rename it or change how it counts.";

/** One line per app or site: its name and its time. A real app or site is a quiet button that
 *  opens its popup (see AppEdit); `sessionId` is the report's session, or null for the week. */
function renderAppRows(items: RecapApp[], sessionId: number | null = null, allowed = new Set<string>()): string {
  return items
    .map((app) => {
      const tone = app.group === "Distractions" ? "is-distraction" : "";
      // A listed distraction the session allowed once: it sits in Work, and says why.
      const wasAllowed = app.group === "Work" && allowed.has(`${app.kind}:${app.key.toLowerCase()}`);
      const cells = `
        <span class="recap-app-name">${escapeHtml(app.label)}${wasAllowed ? `<span class="recap-app-tag">Allowed</span>` : ""}</span>
        <strong>${escapeHtml(formatHours(app.seconds))}</strong>
      `;
      if (!editableApp(app)) {
        return `<div class="recap-app-row ${tone}">${cells}</div>`;
      }
      return `
        <button type="button" class="recap-app-row is-editable ${tone}" data-action="edit-app" data-kind="${app.kind}" data-key="${attr(app.key)}" data-label="${attr(app.label)}" data-distraction="${app.group === "Distractions"}" data-allowed="${wasAllowed}" data-session-id="${sessionId ?? ""}" aria-label="${attr(`Edit ${app.label}`)}">
          ${cells}
        </button>
      `;
    })
    .join("");
}

/** The popup over History for one app or site. */
function renderAppEdit(): string {
  const edit = appEdit;
  if (!edit) {
    return "";
  }
  const site = edit.kind === "website";
  const counts = edit.listable === false
    ? `<p class="app-edit-note">A browser counts by the sites open in it, so it can't be a distraction by itself.</p>`
    : `
      ${edit.allowed ? `<p class="app-edit-note">Allowed once this session, so its time counted as work. It's still on your distractions list.</p>` : ""}
      <div class="app-edit-field">
        <span>Counts as</span>
        <div class="mode-tabs" role="group" aria-label="Counts as">
          <button class="${edit.distraction ? "" : "active"}" type="button" data-action="app-edit-counts" data-counts="work" aria-pressed="${!edit.distraction}">Work</button>
          <button class="${edit.distraction ? "active" : ""}" type="button" data-action="app-edit-counts" data-counts="distraction" aria-pressed="${edit.distraction}">Distraction</button>
        </div>
      </div>
    `;
  return modal("app-edit-panel", "app-edit-title", `
        <div class="modal-head app-edit-head">
          <div>
            <p class="eyebrow">${site ? "Website" : "App"}</p>
            <h2 id="app-edit-title">${escapeHtml(appEditTitle(edit))}</h2>
          </div>
          <div class="app-edit-actions">
            <button class="small-button" type="button" data-action="app-edit-cancel">Cancel</button>
            <button class="small-button primary" type="button" data-action="app-edit-save">Save</button>
          </div>
        </div>
        <label class="app-edit-field">
          <span>Name</span>
          <input id="app-edit-name" maxlength="60" value="${attr(edit.name)}" placeholder="${attr(site ? edit.key : edit.label)}" spellcheck="false" />
        </label>
        ${site ? `<label class="app-edit-field"><span>Address</span><input id="app-edit-address" maxlength="300" value="${attr(edit.address)}" spellcheck="false" /></label>` : ""}
        ${counts}
        ${edit.error ? `<p class="app-edit-error">${escapeHtml(edit.error)}</p>` : ""}
      `);
}

function appEditTitle(edit: AppEdit): string {
  return edit.name.trim() || (edit.kind === "website" ? edit.address.trim() || edit.key : edit.label);
}

/** The name the user has given it, or nothing when it shows its own. */
function givenName(kind: "app" | "website", key: string): string {
  return kind === "website" ? siteNames[key] ?? "" : appNames[key] ?? appNames[key.toLowerCase()] ?? "";
}

async function openAppEdit(source: HTMLElement): Promise<void> {
  const kind = source.dataset.kind === "website" ? "website" : "app";
  const key = source.dataset.key ?? "";
  const label = source.dataset.label ?? key;
  const sessionId = Number(source.dataset.sessionId || "0");
  const sessionIds = sessionId ? [sessionId] : (historyWeek?.sessions ?? []).map((item) => item.id);
  const edit: AppEdit = {
    kind,
    key,
    label,
    name: givenName(kind, key) || label,
    address: key,
    distraction: source.dataset.distraction === "true",
    wasDistraction: source.dataset.distraction === "true",
    sessionIds,
    listable: kind === "website" ? true : null,
    allowed: source.dataset.allowed === "true",
    error: "",
  };
  appEdit = edit;
  paintModalLayer();
  document.querySelector<HTMLInputElement>("#app-edit-name")?.focus();
  // An app the list can't hold (a browser) loses the choice; the resolver says which.
  if (kind === "app") {
    try {
      await invoke<AppRule>("resolve_rule_input", { text: key });
      edit.listable = true;
    } catch {
      edit.listable = false;
    }
    if (appEdit === edit) {
      paintModalLayer();
    }
  }
}

/** Name, then address, then how it counts: the list first, then the sessions it was opened from. */
async function saveAppEdit(): Promise<void> {
  const edit = appEdit;
  if (!edit) {
    return;
  }
  const site = edit.kind === "website";
  let ruleValue = edit.key;
  if (site) {
    const typed = edit.address.trim();
    if (!typed) {
      edit.error = "Type an address, like youtube.com.";
      paintModalLayer();
      return;
    }
    if (typed.toLowerCase() !== edit.key.toLowerCase()) {
      try {
        const rule = await invoke<AppRule>("resolve_rule_input", { text: typed });
        if (rule.target !== "website") {
          throw new Error("Type a web address, like youtube.com.");
        }
        ruleValue = rule.value;
      } catch (error) {
        edit.error = errorText(error);
        paintModalLayer();
        return;
      }
    }
  }
  try {
    const name = edit.name.trim() === edit.label && !givenName(edit.kind, edit.key) ? "" : edit.name.trim();
    if (name !== givenName(edit.kind, edit.key)) {
      if (site) {
        setSiteNames(await invoke<Record<string, string>>("set_site_name", { key: edit.key, name }));
      } else {
        setAppNames(await invoke<Record<string, string>>("set_app_name", { key: edit.key, name }));
      }
    }
    // The list changes only when Counts as was changed, or a listed site's address was: a row
    // in Work can be on the list (allowed once that session), and a rename must not drop it.
    const countsChanged = edit.distraction !== edit.wasDistraction;
    const addressChanged = ruleValue.toLowerCase() !== edit.key.toLowerCase();
    if (edit.listable !== false && (countsChanged || addressChanged)) {
      // Fresh from the backend: the timer window may have added rules since this window loaded.
      permanentRules = await invoke<AppRule[]>("get_rules");
      const target: AppRule["target"] = site ? "website" : "app";
      const named = (rule: AppRule, value: string) => rule.target === target && rule.value.toLowerCase() === value.toLowerCase();
      const others = permanentRules.filter((rule) => !named(rule, edit.key) && !named(rule, ruleValue));
      const listed = permanentRules.some((rule) => named(rule, edit.key));
      // A new address keeps the item on the list it was on; Counts as decides otherwise.
      const keep = countsChanged ? edit.distraction : listed;
      const rules = keep ? [{ target, value: ruleValue }, ...others] : others;
      if (JSON.stringify(rules) !== JSON.stringify(permanentRules)) {
        permanentRules = (await invoke<RulesSaved>("update_rules", { rules })).rules;
      }
    }
    // Each reclassified session comes back as its report, already carrying the new name.
    const reclassify = edit.listable !== false && edit.distraction !== edit.wasDistraction;
    if (reclassify) {
      for (const id of edit.sessionIds) {
        const report = await invoke<SessionReport>("reclassify_session_app", { id, kind: edit.kind, key: edit.key, distraction: edit.distraction });
        if (sessionReport?.id === id) {
          sessionReport = report;
        }
      }
    } else if (sessionReport && edit.sessionIds.includes(sessionReport.id)) {
      sessionReport = await invoke<SessionReport>("get_session_report", { id: sessionReport.id });
    }
    // Totals or names changed: the week, Trends and the day card read them too.
    dayCardKey = "";
    await refreshSnapshotNow();
    await Promise.all([refreshHistoryWeek(false), refreshTrends(false)]);
  } catch (error) {
    edit.error = errorText(error);
    paintModalLayer();
    return;
  }
  appEdit = null;
  paintModalLayer();
  paintHistoryBody();
  showFeedback(`${appEditTitle(edit)} saved`);
}

/** The report's bar in miniature: each run of a state at its real place and length, gaps left bare. */
function renderMiniTimeline(item: SessionSummary): string {
  const segments = item.segments ?? [];
  const end = segments.reduce((max, segment) => Math.max(max, segment.started_offset_seconds + segment.seconds), 0);
  const total = Math.max(item.duration_seconds, end, 1);
  return `
    <div class="mini-timeline" aria-hidden="true">
      ${segments
        .map(
          (segment) =>
            `<span class="state-${escapeHtml(segment.state)}" style="left: ${((segment.started_offset_seconds / total) * 100).toFixed(2)}%; width: ${((segment.seconds / total) * 100).toFixed(2)}%"></span>`,
        )
        .join("")}
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
      ruleEditor = null;
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
    historySearch = searchInput.value;
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

/** The preflight's own controls, inside `root`: the whole document after a rebuild, or just the layer. */
function bindPreflight(root: ParentNode): void {
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

function paintPreflightLayer(): void {
  // The name field takes focus when the start screen opens, not on every rebuild after a click.
  const opening = !document.querySelector("#preflight-layer #preflight-goal");
  const layer = paintSlot("preflight-layer", preflightOpen ? renderPreflightModal() : "");
  if (layer && preflightOpen && opening) {
    layer.querySelector<HTMLTextAreaElement>("#preflight-goal")?.focus();
  }
}

/** The confirm boxes and the session-over card, over whatever page is showing. */
function renderModalLayer(): string {
  return renderHistoryConfirm() + renderQuitConfirm() + renderSessionOver() + renderShareModal() + renderAppEdit();
}

function paintModalLayer(): void {
  paintSlot("modal-layer", renderModalLayer());
}

function renderReviewLayer(): string {
  return sessionReview && sessionReview.id === sessionReport?.id ? renderSessionReview(sessionReview) : "";
}

function paintReviewLayer(): void {
  paintSlot("review-layer", renderReviewLayer());
}

function paintSessionRulesLayer(): void {
  paintSlot("session-rules-layer", sessionRulesOpen ? renderSessionRulesModal() : "");
}

/** The History list under its toolbar; anywhere else in History, the whole page. */
function paintHistoryBody(): void {
  if (!paintSlot("history-body", renderHistoryBody())) {
    render();
  }
}

// A click anywhere but the ⋯ menu closes it.
window.addEventListener("pointerdown", (event) => {
  if (toneMenuOpen && !(event.target as Element | null)?.closest(".personality-own")) {
    toneMenuOpen = false;
    paintClipsPanel();
  }
});

/** The picker and the toolbar button that opens it. */
function paintWeekPicker(): void {
  paintSlot("week-picker-slot", weekPickerOpen ? renderWeekPicker(historyWeekShown(), oldestWeekMonday()) : "");
  const label = document.querySelector<HTMLElement>(".history-week-label");
  label?.classList.toggle("is-open", weekPickerOpen);
  label?.setAttribute("aria-expanded", String(weekPickerOpen));
}

/** The rule editor shows on the start screen, in the session's distractions box, or in Settings. */
function paintRuleEditorHost(): void {
  if (firstRunOpen) {
    paintFirstRun();
  } else if (preflightOpen) {
    paintPreflightLayer();
  } else if (sessionRulesOpen) {
    paintSessionRulesLayer();
  } else {
    render();
  }
}

function releaseVoiceWorker(): void {
  void invoke("release_voice_worker").catch(() => null);
}

function leaveVoiceScreen(): void {
  if (clipQueue?.phase === "working") {
    clipQueue.stopAfter = true;
    showFeedback("Generating stops after this line. Come back to the Voice page to continue.", 5000);
  } else {
    clipQueue = null;
  }
  stopVoicePreview();
  stopClip();
  releaseVoiceWorker();
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

async function runAction(action: string, source?: HTMLElement): Promise<void> {
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

  if (action === "open-session-rules") {
    if (snapshot?.current) {
      sessionRulesOpen = true;
      ruleEditor = null;
      paintSessionRulesLayer();
    }
    return;
  }

  if (action === "close-session-rules") {
    clearLastError();
    sessionRulesOpen = false;
    ruleEditor = null;
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

  if (action === "open-share") {
    shareMonth = await fetchShareMonth();
    shareOpen = true;
    paintModalLayer();
    return;
  }

  if (action === "close-share") {
    shareOpen = false;
    paintModalLayer();
    return;
  }

  // Both draw from data already in memory, so the clipboard write stays inside the click.
  if (action === "copy-week-card") {
    const week = weekRecap && weekRecap.start === historyWeekStart ? weekRecap : null;
    const canvas = week ? drawWeekCard(week, true) : null;
    if (canvas) {
      await copyCanvas(canvas);
    }
    return;
  }

  if (action === "copy-month-card") {
    const canvas = shareMonth ? drawMonthCard(shareMonth, true) : null;
    if (canvas) {
      await copyCanvas(canvas);
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
    ruleEditor = null;
    paintPreflightLayer();
    return;
  }

  // Cancel goes back to the session screen, so the calendar pops in again, as on Escape.
  if (action === "close-preflight") {
    clearLastError();
    preflightOpen = false;
    ruleEditor = null;
    animateOnArrival("session");
    render();
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

  if (action === "confirm-start-session") {
    if (!draft.goal.trim()) {
      showFeedback("Name the session");
      return;
    }
    preflightOpen = false;
    ruleEditor = null;
    const source = startSource;
    startSource = "start screen";
    if (!(await startSession(source))) {
      preflightOpen = true;
      render();
    }
    return;
  }

  if (action === "open-trends") {
    historyView = "trends";
    sessionReport = null;
    setTrendPage(0);
    pendingAnimations.add("trends");
    await refreshTrends(false);
    await refreshTrendPeriods();
    render();
    return;
  }

  if (action === "close-recap") {
    historyView = "list";
    animateOnArrival("history");
    await refreshHistoryWeek();
    return;
  }

  if (action === "toggle-week-picker") {
    if (weekPickerOpen) {
      closeWeekPicker();
      paintWeekPicker();
      return;
    }
    weekPickerOpen = true;
    pickerMonth = monthKey(historyWeekStart || thisMondayKey());
    paintWeekPicker();
    await loadPickerDays();
    return;
  }

  if (action === "picker-month-prev" || action === "picker-month-next") {
    pickerMonth = addMonthsKey(pickerMonth || monthKey(historyWeekStart || thisMondayKey()), action === "picker-month-prev" ? -1 : 1);
    pickerDays = {};
    paintWeekPicker();
    await loadPickerDays();
    return;
  }

  if (action === "pick-week") {
    const day = source?.dataset.day;
    closeWeekPicker();
    if (day && day <= dayKey(new Date()) && mondayKey(day) >= oldestWeekMonday()) {
      historyWeekStart = mondayKey(day);
    }
    await refreshHistoryWeek();
    return;
  }

  if (action === "history-week-today") {
    closeWeekPicker();
    historyWeekStart = thisMondayKey();
    await refreshHistoryWeek();
    return;
  }

  if (action === "history-pane") {
    historyPane = source?.dataset.pane === "apps" ? "apps" : "sessions";
    paintHistoryBody();
    return;
  }

  if (action === "edit-app" && source) {
    await openAppEdit(source);
    return;
  }

  if (action === "app-edit-counts" && appEdit) {
    appEdit.distraction = source?.dataset.counts === "distraction";
    appEdit.error = "";
    paintModalLayer();
    return;
  }

  if (action === "app-edit-cancel") {
    clearLastError();
    appEdit = null;
    paintModalLayer();
    return;
  }

  if (action === "app-edit-save") {
    await saveAppEdit();
    return;
  }

  if (action === "history-week-prev") {
    closeWeekPicker();
    const previous = addDaysKey(historyWeekStart || thisMondayKey(), -7);
    if (previous >= oldestWeekMonday()) {
      historyWeekStart = previous;
    }
    await refreshHistoryWeek();
    return;
  }

  if (action === "history-week-next") {
    closeWeekPicker();
    const current = thisMondayKey();
    const next = addDaysKey(historyWeekStart || current, 7);
    if (next <= current) {
      historyWeekStart = next;
      await refreshHistoryWeek();
    }
    return;
  }

  if (action === "open-report") {
    const id = Number(source?.dataset.sessionId);
    if (Number.isInteger(id) && id > 0) {
      await openHistoryReport(id);
    }
    return;
  }

  if (action === "close-report") {
    historyView = "list";
    sessionReport = null;
    historyConfirm = null;
    // A row's rename popup belongs to the report; it must not outlive it.
    appEdit = null;
    animateOnArrival("history");
    await refreshHistoryWeek();
    return;
  }

  if (action === "ask-delete-session") {
    const id = Number(source?.dataset.sessionId);
    if (Number.isInteger(id) && id > 0) {
      appEdit = null;
      historyConfirm = { kind: "delete-session", id };
      paintModalLayer();
    }
    return;
  }

  if (action === "report-problem") {
    await openProblemForm();
    return;
  }

  if (action === "ask-delete-all") {
    const bytes = await invoke<number>("get_history_size").catch(() => null);
    historyConfirm = { kind: "delete-all", bytes };
    paintModalLayer();
    return;
  }

  if (action === "cancel-history-confirm") {
    clearLastError();
    historyConfirm = null;
    paintModalLayer();
    return;
  }

  if (action === "confirm-history") {
    await confirmHistoryAction();
    return;
  }

  if (action === "open-voice-settings") {
    setSettingsView("voice");
    await refreshVoiceStatus(false);
    render();
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

  if (action === "back-settings") {
    const leavingWebcam = settingsView === "webcam";
    const leavingVoice = settingsView === "voice";
    setSettingsView("home");
    phraseEditor = null;
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

  if (action === "use-tone") {
    const tone = source?.dataset.tone;
    if (tone) {
      clearFailedQueue();
      closeToneForms();
      await setVoiceTone(clipsVoice(), tone);
    }
    return;
  }

  if (action === "open-voice-from-start") {
    preflightOpen = false;
    clipsVoiceId = draft.voiceId;
    setActiveTab("settings");
    setSettingsView("voice");
    await refreshVoiceStatus(false);
    render();
    return;
  }

  if (action === "generate-missing") {
    const voice = clipsVoice();
    const missing = tonePhrases(voiceTone(voice)).filter((phrase) => !clipForPhrase(voice, phrase));
    await runClipQueue(missing.map((phrase) => phrase.id));
    return;
  }

  if (action === "stop-clip-queue") {
    if (clipQueue?.phase === "working") {
      clipQueue.stopAfter = true;
      paintClipsPanel();
    }
    return;
  }

  // The line in flight is abandoned too: for one that hangs, Stop after this line never comes.
  if (action === "cancel-clip-queue") {
    if (clipQueue?.phase === "working") {
      clipQueueCancelled = true;
      await invoke("cancel_voice_generation").catch(() => null);
    }
    return;
  }

  if (action === "new-tone" || action === "cancel-new-tone") {
    const hadForm = toneMenuOpen || toneRename !== null || toneDeleteArmed !== null;
    closeToneForms();
    newToneDraft = action === "new-tone" ? "" : null;
    if (hadForm) {
      paintClipsPanel();
    }
    paintVoiceLayer();
    if (action === "new-tone") {
      document.getElementById("new-tone-input")?.focus();
    }
    return;
  }

  if (action === "toggle-tone-menu") {
    const open = !toneMenuOpen;
    closeToneForms();
    toneMenuOpen = open;
    paintClipsPanel();
    return;
  }

  if (action === "add-line") {
    if (canEditPhrases()) {
      openPhraseEditor(null, voiceTone(clipsVoice()), (source?.dataset.moment as PhraseMoment | undefined) ?? "nudge");
    }
    return;
  }

  if (action === "save-line") {
    await saveLine(false);
    return;
  }

  if (action === "rename-tone") {
    const tone = source?.dataset.tone ?? "";
    if (isCustomTone(tone)) {
      closeToneForms();
      toneRename = { from: tone, value: tone };
      paintClipsPanel();
      (document.getElementById("tone-rename-input") as HTMLInputElement | null)?.select();
    }
    return;
  }

  if (action === "cancel-rename-tone") {
    toneRename = null;
    paintClipsPanel();
    return;
  }

  if (action === "arm-delete-tone" || action === "cancel-delete-tone") {
    const tone = source?.dataset.tone ?? "";
    closeToneForms();
    toneDeleteArmed = action === "arm-delete-tone" && isCustomTone(tone) ? tone : null;
    paintClipsPanel();
    return;
  }

  if (action === "delete-tone") {
    await deleteTone(source?.dataset.tone ?? "");
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

  if (action === "open-phrase-editor") {
    if (canEditPhrases()) {
      dismissVoiceInfo();
      openPhraseEditor(source?.dataset.phraseId || null, voiceTone(clipsVoice()), "nudge");
    }
    return;
  }

  if (action === "delete-phrase") {
    const phraseId = source?.dataset.phraseId;
    if (!phraseId || !canEditPhrases() || !phraseEditor) {
      return;
    }
    // The first press asks; the second, on the question, deletes.
    if (!phraseEditor.confirmDelete) {
      phraseEditor.confirmDelete = true;
      paintLinePopupButtons();
      return;
    }
    await deletePhrase(phraseId);
    return;
  }

  if (action === "keep-phrase") {
    if (phraseEditor) {
      phraseEditor.confirmDelete = false;
      paintLinePopupButtons();
    }
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

  if (action === "cancel-phrase-editor") {
    phraseEditor = null;
    paintVoiceLayer();
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

  if (action === "generate-clip") {
    const phraseId = source?.dataset.phraseId;
    if (phraseId) {
      clearFailedQueue();
      await runClipQueue([phraseId]);
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

async function handleRuleAction(button: HTMLButtonElement): Promise<void> {
  const action = button.dataset.ruleAction;
  if (!action) {
    return;
  }

  if (action === "add") {
    ruleEditor = { index: null, target: "website", value: "", name: "", nameTouched: false, preview: null };
    paintRuleEditorHost();
    document.getElementById("rule-value")?.focus();
    return;
  }

  if (action === "cancel") {
    ruleEditor = null;
    paintRuleEditorHost();
    return;
  }

  if (action === "keep") {
    if (ruleEditor) {
      ruleEditor.confirmDelete = false;
      paintRuleEditorHost();
    }
    return;
  }

  const index = Number(button.dataset.ruleIndex);
  const rules = permanentRules;
  if (!Number.isInteger(index) || !rules[index]) {
    return;
  }

  if (action === "edit") {
    const rule = rules[index];
    ruleEditor = {
      index,
      ...rule,
      name: rule.target === "website" ? siteNames[rule.value] ?? "" : "",
      nameTouched: false,
      preview: { target: rule.target, value: rule.value },
    };
    paintRuleEditorHost();
    return;
  }

  if (action === "delete") {
    // The first press asks; the second, on the question, deletes.
    if (ruleEditor && !ruleEditor.confirmDelete) {
      ruleEditor.confirmDelete = true;
      paintRuleEditorHost();
      return;
    }
    const previous = cloneRules(rules);
    rules.splice(index, 1);
    ruleEditor = null;
    await persistPermanentRuleChanges(previous);
  }
}

async function saveRuleForm(form: HTMLFormElement): Promise<void> {
  const editor = ruleEditor;
  if (!editor) {
    return;
  }

  const text = formValue(form, "value").trim();
  if (!text) {
    showFeedback("Enter a website or an app name");
    return;
  }
  let rule: AppRule;
  try {
    rule = await invoke<AppRule>("resolve_rule_input", { text });
  } catch (error) {
    showFeedback(errorText(error));
    return;
  }
  if (ruleEditor !== editor) {
    return;
  }
  if (rule.target === "website" && previewSite(editor) === rule.value) {
    const name = formValue(form, "name").trim();
    if (name !== (siteNames[rule.value] ?? "")) {
      try {
        setSiteNames(await invoke<Record<string, string>>("set_site_name", { key: rule.value, name }));
      } catch (error) {
        showFeedback(errorText(error));
        return;
      }
    }
  }
  if (ruleEditor !== editor) {
    return;
  }

  const previous = cloneRules(permanentRules);
  if (editor.index === null) {
    permanentRules.unshift(rule);
  } else {
    permanentRules[editor.index] = rule;
  }
  ruleEditor = null;
  await persistPermanentRuleChanges(previous);
}

function scheduleRulePreview(delay = 140): void {
  clearTimeout(rulePreviewTimer);
  rulePreviewTimer = window.setTimeout(() => {
    void resolveRulePreview();
  }, delay);
}

async function resolveRulePreview(): Promise<void> {
  const editor = ruleEditor;
  if (!editor) {
    return;
  }
  const text = editor.value.trim();
  let preview: RulePreview = null;
  if (text) {
    try {
      const rule = await invoke<AppRule>("resolve_rule_input", { text });
      preview = { target: rule.target, value: rule.value };
    } catch (error) {
      preview = { error: errorText(error) };
    }
  }
  if (ruleEditor !== editor || editor.value.trim() !== text) {
    return;
  }
  const before = previewSite(editor);
  editor.preview = preview;
  const site = previewSite(editor);
  if (site !== before) {
    editor.nameTouched = false;
  }
  if (!editor.nameTouched) {
    editor.name = site ? siteNames[site] ?? "" : "";
  }
  paintRuleEditorLive();
}

function paintRuleEditorLive(): void {
  const editor = ruleEditor;
  if (!editor) {
    return;
  }
  const preview = document.getElementById("rule-preview");
  const nameInput = document.getElementById("rule-name") as HTMLInputElement | null;
  if (preview) {
    preview.innerHTML = renderRulePreview(editor);
    preview.closest("form")?.querySelector('button[type="submit"]')?.classList.toggle("is-quiet", !rulePreviewReady(editor));
  }
  if (nameInput) {
    const site = previewSite(editor);
    const field = nameInput.closest("label");
    if (field) {
      field.hidden = !site;
    }
    nameInput.placeholder = site ?? "";
    if (!editor.nameTouched) {
      nameInput.value = editor.name;
    }
  }
}

const ruleKey = (rule: AppRule) => `${rule.target}\n${rule.value.toLowerCase()}`;

async function persistPermanentRuleChanges(previous: AppRule[]): Promise<void> {
  try {
    // The timer window can add rules behind this window's back: apply this edit (what changed
    // from previous) to the backend's fresh list, so a stale copy never overwrites it.
    const before = new Set(previous.map(ruleKey));
    const after = new Set(permanentRules.map(ruleKey));
    const added = permanentRules.filter((rule) => !before.has(ruleKey(rule)));
    const addedKeys = new Set(added.map(ruleKey));
    const fresh = await invoke<AppRule[]>("get_rules");
    const rules = [...added, ...fresh.filter((rule) => !addedKeys.has(ruleKey(rule)) && (after.has(ruleKey(rule)) || !before.has(ruleKey(rule))))];
    const saved = await invoke<RulesSaved>("update_rules", { rules });
    permanentRules = saved.rules;
    setLastError("");
    render();
    return;
  } catch (error) {
    permanentRules = previous;
    setLastError(errorText(error));
  }
  render();
}

/** Edits the line library and saves it. A failed save puts the library back and redraws. */
async function editLibrary(mutate: () => void): Promise<boolean> {
  const backup = {
    customPhrases: customPhrases.map((phrase) => ({ ...phrase })),
    customPhraseSets: [...customPhraseSets],
    phraseOverrides: { ...phraseOverrides },
    hiddenPhrases: new Set(hiddenPhrases),
  };
  mutate();
  try {
    const library = await invoke<PhraseLibraryState>("update_phrase_library", {
      library: {
        custom_tones: customPhraseSets,
        custom_phrases: customPhrases,
        phrase_overrides: Object.values(phraseOverrides),
        hidden_phrases: [...hiddenPhrases],
      },
    });
    customPhraseSets = library.custom_tones;
    customPhrases = library.custom_phrases;
    phraseOverrides = Object.fromEntries(library.phrase_overrides.map((phrase) => [phrase.id, phrase]));
    hiddenPhrases = new Set(library.hidden_phrases);
    voiceError = "";
    return true;
  } catch (error) {
    voiceError = errorText(error);
    ({ customPhrases, customPhraseSets, phraseOverrides, hiddenPhrases } = backup);
    render();
    return false;
  }
}

/** Saves the Line popup. With `regenerate`, the line's clip is made right after, in the queue.
 * Saving never waits on the model: a changed line keeps its old clip until a new one exists. */
async function saveLine(regenerate: boolean): Promise<void> {
  const editor = phraseEditor;
  if (!editor || !canEditPhrases()) {
    return;
  }
  const text = editor.text.replace(/\s+/g, " ").trim();
  const tone = phraseToneOrder().find((item) => sameTone(item, editor.tone)) ?? editor.tone;
  const moment = editor.moment;
  if (!text) {
    showFeedback("The line needs words");
    return;
  }
  const existing = editor.phraseId ? effectivePhrases().find((item) => item.id === editor.phraseId) : null;
  let id = "";
  const saved = await editLibrary(() => {
    if (!phraseToneOrder().some((item) => sameTone(item, tone))) {
      customPhraseSets.push(tone);
    }
    if (existing) {
      id = existing.id;
      const index = customPhrases.findIndex((phrase) => phrase.id === existing.id);
      if (index >= 0) {
        customPhrases[index] = { id, tone, moment, text };
      } else {
        phraseOverrides[id] = { id, tone, moment, text };
      }
    } else {
      id = uniqueCustomPhraseId(text);
      customPhrases.push({ id, tone, moment, text });
    }
  });
  if (!saved) {
    return;
  }
  if (existing && existing.text !== text) {
    await dropLineAudio(id);
  }
  phraseEditor = null;
  paintLines();
  if (regenerate) {
    reopenLineAfterQueue = id;
    if (!(await runClipQueue([id]))) {
      reopenLineAfterQueue = null;
      showFeedback(existing ? "Line saved" : "Line added");
    }
    return;
  }
  const moved = existing && existing.text === text && existing.moment !== moment;
  const label = MOMENTS.find((item) => item.id === moment)?.label ?? "";
  showFeedback(moved ? `Moved to ${label}` : existing ? "Line saved" : "Line added");
}

/** A line's words changed: every voice's audio of it says the old ones, and a reminder would
 *  play them under the new words on the card. Dropping it makes the row say Not generated, and
 *  a voice left without lines is warned about like any quiet voice. */
async function dropLineAudio(phraseId: string): Promise<void> {
  for (const profile of [...(voiceBackend?.profiles ?? [])]) {
    for (const clip of profile.clips.filter((item) => clipBelongsToPhrase(item, phraseId))) {
      try {
        upsertProfile(await invoke<VoiceProfileSummary>("delete_voice_clip", { input: { profile_id: profile.profile_id, clip_id: clip.clip_id } }));
      } catch (error) {
        voiceError = `Could not remove the old audio of this line: ${errorText(error)}`;
      }
    }
  }
}

/** A new personality, empty or with a copy of another's lines, that the viewed voice takes on. */
async function createTone(): Promise<void> {
  const name = (newToneDraft ?? "").trim().slice(0, 80);
  if (!name) {
    showFeedback("Name the personality");
    return;
  }
  if (phraseToneOrder().some((tone) => sameTone(tone, name))) {
    showFeedback(`There is already a ${toneLabel(name)} personality`);
    return;
  }
  const from = (document.getElementById("new-tone-from") as HTMLSelectElement | null)?.value ?? "";
  const saved = await editLibrary(() => {
    customPhraseSets.push(name);
    for (const phrase of from ? tonePhrases(from) : []) {
      customPhrases.push({ id: uniqueCustomPhraseId(phrase.text), tone: name, moment: phrase.moment, text: phrase.text });
    }
  });
  if (!saved) {
    return;
  }
  closeToneForms();
  await setVoiceTone(clipsVoice(), name);
}
/** Custom phrases go; bundled ones are hidden, so they stay deletable without a clip cleanup. */
async function deletePhrase(phraseId: string): Promise<void> {
  const saved = await editLibrary(() => {
    if (customPhrases.some((phrase) => phrase.id === phraseId)) {
      customPhrases = customPhrases.filter((phrase) => phrase.id !== phraseId);
    } else {
      hiddenPhrases.add(phraseId);
      delete phraseOverrides[phraseId];
    }
  });
  if (!saved) {
    return;
  }
  phraseEditor = null;
  paintLines();
  showFeedback("Line deleted");
}

async function updateDefaultStrictness(default_strictness: Strictness): Promise<void> {
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

async function updateStatusWindowEnabled(enabled: boolean): Promise<void> {
  if (await invokeSnapshot("set_status_window_enabled", { enabled }, false)) {
    showFeedback(enabled ? "Session timer shown" : "Session timer hidden");
  }
}

async function updateSelectedVoice(voiceId: string): Promise<boolean> {
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

function dismissDownloadModal(): void {
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
async function runVoiceBusy(kind: Exclude<VoiceBusy, null>, task: () => Promise<void>, redrawAfter = true): Promise<boolean> {
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

async function closeRecordingDialog(): Promise<void> {
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

/** Cancel was pressed: the line in flight was abandoned, so its error is not one to show. */
let clipQueueCancelled = false;

/** A failed line stays on screen until the user moves on; the next action clears it. */
function clearFailedQueue(): void {
  if (clipQueue?.phase === "error") {
    clipQueue = null;
  }
}

/** Makes the given lines for the Clips-for voice, one after another, in place. Returns false
 * when nothing started. The busy modal stays away: the rows themselves show the progress. */
async function runClipQueue(phraseIds: string[]): Promise<boolean> {
  clearFailedQueue();
  if (clipQueue || voiceBusy !== null || phraseIds.length === 0) {
    return false;
  }
  const voice = clipsVoice();
  const profile = voice.profile;
  const reference = profile?.reference_path;
  const lock = clipGenerateLockTitle(voice);
  if (lock || !profile || !reference) {
    showFeedback(lock || "Pick one of your recorded voices first.");
    return false;
  }
  dismissVoiceInfo();
  clipQueue = { voiceId: voice.id, phraseIds, index: 0, phase: "working", error: "", startedAt: performance.now(), stopAfter: false };
  clipQueueCancelled = false;
  clipQueueTicker = window.setInterval(paintClipQueue, 1000);
  await runVoiceBusy("generate-clips", async () => {
    while (clipQueue && clipQueue.phase === "working" && clipQueue.index < clipQueue.phraseIds.length) {
      const phraseId = clipQueue.phraseIds[clipQueue.index];
      const phrase = effectivePhrases().find((item) => item.id === phraseId);
      if (!phrase) {
        clipQueue = { ...clipQueue, index: clipQueue.index + 1 };
        continue;
      }
      clipQueue = { ...clipQueue, startedAt: performance.now() };
      paintClipsPanel();
      try {
        const generated = await invoke<VoiceProfileSummary>("generate_voice_clips", {
          input: {
            profile_id: profile.profile_id,
            reference_audio_path: reference,
            phrases: [{ id: phrase.id, tone: phrase.tone, text: phrase.text }],
          },
        });
        upsertProfile(generated);
        const ready = clipForPhraseId(generated.clips, phrase.id);
        if (ready) {
          bumpClipAsset(ready.path);
        }
      } catch (error) {
        if (clipQueueCancelled) {
          clipQueue = null;
          showFeedback("Stopped");
          break;
        }
        if (clipQueue) {
          clipQueue = { ...clipQueue, phase: "error", error: errorText(error) };
        }
        paintClipsPanel();
        break;
      }
      if (!clipQueue) {
        break;
      }
      clipQueue = { ...clipQueue, index: clipQueue.index + 1 };
      if (clipQueue.stopAfter) {
        break;
      }
    }
  }, false);
  clearInterval(clipQueueTicker);
  const finished = clipQueue;
  if (finished?.phase !== "error") {
    clipQueue = null;
  }
  await refreshVoiceStatus(false);
  if (finished && finished.phase === "working" && finished.index >= finished.phraseIds.length) {
    const now = clipsVoice();
    if (now.selectable && pickWhenReady === now.id) {
      pickWhenReady = null;
      pickVoice(now);
    } else {
      showFeedback(
        now.source === "custom" && now.selectable
          ? `${now.name} is ready to select`
          : finished.phraseIds.length === 1
            ? "Line ready"
            : "Lines ready",
      );
    }
  }
  const reopen = reopenLineAfterQueue;
  reopenLineAfterQueue = null;
  const done = finished && finished.phase === "working" && finished.index >= finished.phraseIds.length;
  const onPage = appView === "main" && activeTab === "settings" && settingsView === "voice";
  const phrase = reopen ? effectivePhrases().find((item) => item.id === reopen) : null;
  if (done && onPage && phrase && !editorIsOpen() && clipForPhrase(clipsVoice(), phrase)) {
    render();
    openPhraseEditor(phrase.id, phrase.tone, phrase.moment);
    return true;
  }
  render();
  return true;
}

function pickVoice(voice: VoiceOption): void {
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

async function setVoiceTone(voice: VoiceOption, tone: VoiceTone): Promise<void> {
  const profile = voice.profile;
  if (!profile) {
    return;
  }
  try {
    const saved = await invoke<VoiceProfileSummary>("set_voice_tone", { profileId: profile.profile_id, tone });
    upsertProfile(saved);
    voiceError = "";
    showFeedback(
      profileToneReady(saved)
        ? `${voice.name} speaks like ${toneLabel(tone)}`
        : `${voice.name} speaks like ${toneLabel(tone)}. Generate the lines below to hear ${voice.name}.`,
    );
  } catch (error) {
    voiceError = errorText(error);
  }
  // The voice cards say who speaks like what, so the page redraws.
  render();
}

/** Saves the name in Edit voice as the field is left. An empty name puts the old one back. */
async function renameVoice(): Promise<void> {
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

/** Renames a custom personality everywhere it is written: its lines, its set, and the voices that speak like it. */
async function renameTone(): Promise<void> {
  const edit = toneRename;
  if (!edit || !canEditPhrases()) {
    return;
  }
  const next = edit.value.trim().slice(0, 80);
  if (!next) {
    showFeedback("Name the personality");
    return;
  }
  if (sameTone(next, edit.from)) {
    toneRename = null;
    paintLines();
    return;
  }
  if (phraseToneOrder().some((tone) => sameTone(tone, next))) {
    showFeedback(`There is already a ${toneLabel(next)} personality`);
    return;
  }
  const saved = await editLibrary(() => {
    customPhraseSets = customPhraseSets.map((tone) => (sameTone(tone, edit.from) ? next : tone));
    customPhrases = customPhrases.map((phrase) => (sameTone(phrase.tone, edit.from) ? { ...phrase, tone: next } : phrase));
    for (const [id, phrase] of Object.entries(phraseOverrides)) {
      if (sameTone(phrase.tone, edit.from)) {
        phraseOverrides[id] = { ...phrase, tone: next };
      }
    }
  });
  if (!saved) {
    return;
  }
  for (const profile of voiceBackend?.profiles ?? []) {
    if (profile.tone && sameTone(profile.tone, edit.from)) {
      try {
        upsertProfile(await invoke<VoiceProfileSummary>("set_voice_tone", { profileId: profile.profile_id, tone: next }));
      } catch (error) {
        voiceError = errorText(error);
      }
    }
  }
  toneRename = null;
  render();
  showFeedback(`Renamed to ${toneLabel(next)}`);
}

/** Removes a custom personality and its lines. Voices that spoke like it fall back to the first. */
async function deleteTone(tone: VoiceTone): Promise<void> {
  toneDeleteArmed = null;
  if (!isCustomTone(tone) || !canEditPhrases()) {
    paintLines();
    return;
  }
  const saved = await editLibrary(() => {
    customPhraseSets = customPhraseSets.filter((item) => !sameTone(item, tone));
    customPhrases = customPhrases.filter((phrase) => !sameTone(phrase.tone, tone));
    for (const [id, phrase] of Object.entries(phraseOverrides)) {
      if (sameTone(phrase.tone, tone)) {
        delete phraseOverrides[id];
        hiddenPhrases.add(id);
      }
    }
  });
  if (!saved) {
    return;
  }
  render();
  showFeedback(`${toneLabel(tone)} deleted`);
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

function tabButton(tab: Tab, text: string): string {
  return `<button data-tab="${tab}" class="${activeTab === tab ? "active" : ""}" type="button">${text}</button>`;
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

/** The bars of the speaking orb, for a play button while its clip plays. */
const MINI_ORB = `<span class="mini-orb" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`;

async function playLine(clip: VoiceClipSummary | null): Promise<boolean> {
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
function announceNudge(speaking: boolean): void {
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
function selectedNudgeClip(nudgeCount: number, phone = false): VoiceClipSummary | null {
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

function clipForPhrase(voice: VoiceOption, phrase: PhraseDefinition): VoiceClipSummary | null {
  return clipForPhraseId(voice.profile?.clips ?? [], phrase.id);
}

function clipForPhraseId(clips: VoiceClipSummary[], phraseId: string): VoiceClipSummary | null {
  if (!phraseId) {
    return null;
  }
  return clips.find((clip) => clipBelongsToPhrase(clip, phraseId)) ?? null;
}

// Exact id: `custom_gentle_come_on_back` is a different line from `gentle_come_on_back`.
function clipBelongsToPhrase(clip: VoiceClipSummary, phraseId: string): boolean {
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
function paintPlayingClip(root: ParentNode = document): void {
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

function dismissVoiceInfo(): void {
  stopVoicePreview();
  voiceInfoId = null;
}

function stopVoicePreview(): void {
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

function bindVoicePreview(): void {
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

function bindVoiceWaveforms(root: ParentNode = document): void {
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

/** Mirrors `Strictness::focus_config` in the backend: the seconds a distraction may stay open
 * before Supervisor speaks up. */
const STRICTNESS_HELP = "How long a distraction can stay open before a reminder.";
const STRICTNESS_SECONDS: Record<Strictness, number> = { gentle: 90, normal: 60, strict: 30 };

function strictnessOptions(selected: Strictness): string {
  return (["gentle", "normal", "strict"] as Strictness[])
    .map((value) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label(value)} · ${STRICTNESS_SECONDS[value]} s</option>`)
    .join("");
}

function voiceOptions(selected: string, forClips = false): string {
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

function sameTone(a: VoiceTone, b: VoiceTone): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function tonePhrases(tone: VoiceTone): PhraseDefinition[] {
  return effectivePhrases().filter((phrase) => sameTone(phrase.tone, tone));
}

/** The clips a voice has for its personality's lines at a moment. */
function readyClips(voice: VoiceOption, moment: PhraseMoment): VoiceClipSummary[] {
  return momentPhrases(voiceTone(voice), moment)
    .map((phrase) => clipForPhrase(voice, phrase))
    .filter((clip): clip is VoiceClipSummary => Boolean(clip));
}

export function momentPhrases(tone: VoiceTone, moment: PhraseMoment): PhraseDefinition[] {
  return tonePhrases(tone).filter((phrase) => phrase.moment === moment);
}

/** Bundled personalities keep their names; only the user's own can be renamed or deleted. */
function isCustomTone(tone: VoiceTone): boolean {
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
function profileToneReady(profile: VoiceProfileSummary | null): boolean {
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
function quietVoice(): VoiceOption | null {
  if (draft.voiceId === "none" || !voiceBackend) {
    return null;
  }
  const voice = selectedVoice();
  return readyClips(voice, "nudge").length ? null : voice;
}

function quietVoiceText(voice: VoiceOption): string {
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
function renderVoiceGapNotice(voice: VoiceOption, where: "voice" | "start"): string {
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

function clipsVoice(): VoiceOption {
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
function clipGenerateLockTitle(voice: VoiceOption): string {
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

function canEditPhrases(): boolean {
  return voiceBusy === null;
}

function profileById(profileId: string): VoiceProfileSummary | null {
  return voiceBackend?.profiles.find((profile) => profile.profile_id === profileId) ?? null;
}

function upsertProfile(profile: VoiceProfileSummary): void {
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

function normalizeStoredVoiceId(value: string): string {
  if (value === "none" || value === "starter-male" || value === "starter-female" || value.startsWith("profile:")) {
    return value;
  }
  return "starter-female";
}

function ensureSelectedVoice(): void {
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

function openPhraseEditor(phraseId: string | null, tone: VoiceTone, moment: PhraseMoment): void {
  const phrase = phraseId ? effectivePhrases().find((item) => item.id === phraseId) : null;
  phraseEditor = {
    phraseId,
    tone: phrase?.tone ?? tone,
    moment: phrase?.moment ?? moment,
    text: phrase?.text ?? "",
  };
  paintVoiceLayer();
  (document.getElementById("phrase-editor-text") as HTMLInputElement | null)?.focus();
}
function phraseToneOrder(): VoiceTone[] {
  const tones: VoiceTone[] = [...toneOrder];
  for (const tone of customPhraseSets) {
    if (!tones.some((item) => item.toLowerCase() === tone.toLowerCase())) {
      tones.push(tone);
    }
  }
  for (const phrase of effectivePhrases()) {
    if (!tones.some((tone) => tone.toLowerCase() === phrase.tone.toLowerCase())) {
      tones.push(phrase.tone);
    }
  }
  return tones;
}

function effectivePhrases(): PhraseDefinition[] {
  return [
    ...phraseBank.filter((phrase) => !hiddenPhrases.has(phrase.id)).map((phrase) => phraseOverrides[phrase.id] ?? phrase),
    ...customPhrases,
  ];
}

function uniqueCustomPhraseId(text: string): string {
  const base = cleanSlug(text).slice(0, 48) || "phrase";
  const existing = new Set(effectivePhrases().map((phrase) => phrase.id));
  let candidate = `custom_${base}`;
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `custom_${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
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

function cleanSlug(value: string): string {
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

function bumpClipAsset(path: string): void {
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

function toneLabel(tone: VoiceTone): string {
  switch (tone) {
    case "gentle":
      return "Gentle";
    case "mom":
      return "Mom";
    case "stern":
      return "Stern";
    case "genz":
      return "Gen Z";
    default:
      return tone;
  }
}

function cloneRules(rules: AppRule[]): AppRule[] {
  return rules.map((rule) => ({ ...rule }));
}

async function refreshHistoryWeek(shouldRender = true): Promise<void> {
  if (!historyWeekStart) {
    historyWeekStart = thisMondayKey();
  }
  const request = ++historyWeekRequest;
  try {
    const [week, recap, names] = await Promise.all([
      invoke<HistoryWeek>("get_history_week", { weekStart: historyWeekStart }),
      invoke<WeekRecap>("get_week_recap", { start: historyWeekStart }),
      invoke<Record<string, string>>("get_app_names"),
    ]);
    if (request !== historyWeekRequest) {
      return;
    }
    historyWeek = week;
    weekRecap = recap;
    setAppNames(names);
    historyWeekStart = week.week_start;
    if (historySearch.trim()) {
      await runHistorySearch(historySearch.trim());
    }
  } catch (error) {
    if (request !== historyWeekRequest) {
      return;
    }
    setLastError(errorText(error));
  }
  if (shouldRender) {
    render();
  }
}

function scheduleHistorySearch(): void {
  clearTimeout(historySearchTimer);
  const query = historySearch.trim();
  if (!query) {
    historySearchRequest += 1;
    historySearchResults = null;
    paintHistoryBody();
    return;
  }
  historySearchTimer = window.setTimeout(() => {
    void runHistorySearch(query);
  }, 150);
}

async function runHistorySearch(query: string): Promise<void> {
  const request = ++historySearchRequest;
  try {
    const results = await invoke<SessionSummary[]>("search_sessions", { query });
    if (request !== historySearchRequest) {
      return;
    }
    historySearchResults = results;
  } catch (error) {
    if (request !== historySearchRequest) {
      return;
    }
    setLastError(errorText(error));
    render();
    return;
  }
  paintHistoryBody();
}

/** The newest session not yet seen, left unseen until its report opens (or the caller decides
 *  it never will). Anything older than it is marked seen: only the latest gets a report. */
function noteNewHistory(items: SessionSummary[]): number | null {
  let newest: number | null = null;
  for (const item of items) {
    if (!knownHistoryIds.has(item.id)) {
      if (newest === null) {
        newest = item.id;
      } else {
        knownHistoryIds.add(item.id);
      }
    }
  }
  return newest;
}

/** `review`: the session just ended, so ask about what it counted as work first. */
async function openHistoryReport(id: number, review = false): Promise<void> {
  if (sessionReport?.id !== id) {
    flippedStats.clear();
  }
  if (settingsView === "webcam") {
    setSettingsView("home");
    await stopWebcamPreview();
  }
  if (settingsView === "voice") {
    leaveVoiceScreen();
    setSettingsView("home");
  }
  try {
    sessionReport = await invoke<SessionReport>("get_session_report", { id });
    if (review) {
      const items = await invoke<RecapApp[]>("review_candidates", { id }).catch(() => []);
      sessionReview = items.length
        ? { id, saving: false, items: items.map((app) => ({ ...app, distraction: false, renaming: false, name: app.label })) }
        : null;
    }
    historyView = "report";
    setActiveTab("history");
    setLastError("");
    knownHistoryIds.add(id);
    if (review) {
      localStorage.setItem("review.lastOffered", String(id));
    }
  } catch (error) {
    setLastError(errorText(error));
    historyView = "list";
    sessionReport = null;
  }
  await refreshTrends(false);
  render();
  reconcilePolling();
}

async function confirmHistoryAction(): Promise<void> {
  const confirm = historyConfirm;
  if (!confirm) {
    return;
  }
  historyConfirm = null;
  if (confirm.kind === "delete-session" && confirm.id) {
    const id = confirm.id;
    // SQLite can hand a deleted id to the next session, which must still get its Session done card.
    await runHistoryCommand("delete_session", { id }, "Session deleted", () => {
      knownHistoryIds.delete(id);
      practiceIds.delete(id);
    });
    historyView = "list";
    sessionReport = null;
    animateOnArrival("history");
    await refreshHistoryWeek();
    return;
  }
  if (confirm.kind === "delete-all") {
    await runHistoryCommand("delete_all_history", undefined, "History cleared", () => {
      knownHistoryIds.clear();
      practiceIds.clear();
      localStorage.setItem("review.lastOffered", "0");
    });
    historyView = "list";
    sessionReport = null;
    await refreshHistoryWeek();
  }
}

async function runHistoryCommand(
  command: string,
  args: Record<string, unknown> | undefined,
  message: string,
  forget: () => void,
): Promise<void> {
  try {
    await invoke(command, args ?? {});
    forget();
    setSnapshot(await invoke<SessionSnapshot>("get_session_snapshot"));
    history.forEach((item) => knownHistoryIds.add(item.id));
    setLastError("");
    await refreshTrends(false);
    await refreshHistoryWeek(false);
    showFeedback(message);
  } catch (error) {
    setLastError(errorText(error));
    render();
  }
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

/**
 * Session and History animate in when you arrive on them (and Session at launch), once: the
 * first draw that shows the calendar or the week's charts plays it, and every later redraw
 * leaves them standing.
 */
export const pendingAnimations = new Set<"calendar" | "history" | "trends">(["calendar"]);

function animateOnArrival(tab: Tab): void {
  if (tab === "session") {
    pendingAnimations.add("calendar");
  } else if (tab === "history") {
    pendingAnimations.add("history");
    if (historyView === "trends") {
      pendingAnimations.add("trends");
    }
  }
}

export function takeAnimation(name: "calendar" | "history" | "trends"): boolean {
  return pendingAnimations.delete(name);
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

function groupSessionsByDay(items: SessionSummary[]): { label: string; items: SessionSummary[] }[] {
  const groups: { key: string; label: string; items: SessionSummary[] }[] = [];
  for (const item of items) {
    const date = new Date(item.started_at);
    const key = dayKey(date);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
      continue;
    }
    const thisYear = date.getFullYear() === new Date().getFullYear();
    groups.push({
      key,
      label: date.toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
        ...(thisYear ? {} : { year: "numeric" }),
      }),
      items: [item],
    });
  }
  return groups;
}

function dayTotalLine(items: SessionSummary[]): string {
  const sessions = items.length === 1 ? "1 session" : `${items.length} sessions`;
  const focused = items.reduce((sum, item) => sum + item.focus_seconds, 0);
  return `${formatHours(focused)} focused · ${sessions}`;
}

void init();

import type {
  SessionSettings, SessionSnapshot, SessionSummary, SettingsView, Strictness, Tab,
} from "./types";

export let theme: "light" | "dark" = localStorage.getItem("supervisor-theme") === "dark" ? "dark" : "light";
export function setTheme(value: "light" | "dark"): void {
  theme = value;
}

export const draft = {
  goal: "",
  mode: "timer" as "timer" | "pomodoro",
  rhythm: 0,
  rounds: 4,
  duration_minutes: 25,
  strictness: "normal" as Strictness,
  voiceId: "starter-female",
};

export let activeTab: Tab = "session";
export function setActiveTab(value: Tab): void {
  activeTab = value;
}
export let settingsView: SettingsView = "home";
export function setSettingsView(value: SettingsView): void {
  settingsView = value;
}
export let snapshot: SessionSnapshot | null = null;
/** A snapshot carries the settings and history; taking one in takes all three. */
export function setSnapshot(value: SessionSnapshot): void {
  snapshot = value;
  settings = value.settings;
  history = value.history;
}
export let settings: SessionSettings = {
  default_strictness: "normal",
  voice_profile: "Starter voice",
  status_window_enabled: true,
  status_window_on_top: true,
  webcam_gpu: false,
  webcam_enabled: false,
  webcam_camera: 0,
};
export function setSettings(value: SessionSettings): void {
  settings = value;
}
export let history: SessionSummary[] = [];
export function setHistory(value: SessionSummary[]): void {
  history = value;
}
export const knownHistoryIds = new Set<number>();
export let siteNames: Record<string, string> = {};
export function setSiteNames(value: Record<string, string>): void {
  siteNames = value;
}
export let appNames: Record<string, string> = {};
export function setAppNames(value: Record<string, string>): void {
  appNames = value;
}
export let lastError = "";
export function setLastError(value: string): void {
  lastError = value;
}

/** An error banner is about the step that failed; leaving the tab or closing a pop-up moves
 *  on from it. Removed in place, since a pop-up closing repaints only its own layer. */
export function clearLastError(): void {
  lastError = "";
  document.getElementById("last-error")?.remove();
}

/** The id of the session most recently seen running, so its end can find its own summary. */
export let lastSessionId = 0;
export function setLastSessionId(value: number): void {
  lastSessionId = value;
}

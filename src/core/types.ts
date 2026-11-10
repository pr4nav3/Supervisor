

type PermissionState = "granted" | "missing" | "not_required";
export type RuleTarget = "app" | "website";
/** A browser's own pages (New Tab, settings, files) are "app": the browser itself. */
type ActivityKind = "app" | "website" | "other_websites";
export type Strictness = "gentle" | "normal" | "strict";
type SessionStatus = "idle" | "active" | "paused" | "snoozed";
type FocusState = "focused" | "suspicious" | "distracted" | "idle";
export type Tab = "session" | "settings" | "history";
export type AppView = "main" | "overlay";
export type SettingsView = "home" | "voice" | "webcam";
export type VoiceTone = string;
export type VoiceSource = "none" | "starter" | "custom";
export type VoiceBusy = "download-model" | "delete-model" | "generate-clips" | "delete-voice" | null;
/** Lines being made one after another for one voice; `index` is the line in progress. */
export type ClipQueue = {
  voiceId: string;
  phraseIds: string[];
  index: number;
  phase: "working" | "error";
  error: string;
  startedAt: number;
  stopAfter: boolean;
};
type VoiceDownloadPhase = "idle" | "checking" | "downloading" | "cancelling" | "complete" | "error";
export type RecordingState = "idle" | "recording" | "recorded" | "error";

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CapturePermissions {
  screen_recording: PermissionState;
  accessibility: PermissionState;
}

interface ActivitySample {
  captured_at: string;
  platform: string;
  app_name: string;
  app_label: string;
  process_path: string;
  process_id: number;
  window_id: string;
  bounds: Bounds;
  idle_seconds: number | null;
  permissions: CapturePermissions;
}

/** What is being supervised: an app, a website, or one of the browser's own rows. */
interface Activity {
  kind: ActivityKind;
  key: string;
  label: string;
}

/** A distraction: a website key ("youtube.com") or an app. */
export interface AppRule {
  target: RuleTarget;
  value: string;
}

interface FocusSnapshot {
  sample: ActivitySample;
  activity: Activity;
  /** A website or a non-browser app: something a rule can name. */
  markable: boolean;
  state: FocusState;
  /** A distraction rule matched, and no exception for this session lifted it. */
  distracting: boolean;
  matched_rule: AppRule | null;
  seconds_on_current_window: number;
  /** The distraction card is up: past the strictness's nudge time. Its first nudge plays with it. */
  interrupt?: boolean;
  should_nudge: boolean;
  next_nudge_in_seconds: number | null;
}

export interface PomodoroStatus {
  round: number;
  rounds: number;
  work_seconds: number;
  break_seconds: number;
  /** "break_over": the break ran out and the session waits for the next round. */
  phase: "work" | "break" | "break_over";
  phase_remaining_seconds: number;
  rounds_focused_seconds: number[];
  moments: number;
}

/** What the main window, which plays every nudge, tells the distraction card. */
export interface NudgeVoice {
  speaking: boolean;
  voice: string;
  line: string;
  /** The line's audio would not play; the card says so instead of staying silent. */
  failed?: boolean;
}

export interface SessionSettings {
  default_strictness: Strictness;
  voice_profile: string;
  status_window_enabled: boolean;
  status_window_on_top: boolean;
  webcam_gpu: boolean;
  webcam_enabled: boolean;
  webcam_camera: number;
}

interface SessionMetrics {
  focused_seconds: number;
  distracted_seconds: number;
  idle_seconds: number;
  /** Part of distracted_seconds. */
  phone_seconds: number;
  nudges: number;
}

/** What the webcam says during a session. Only flags; frames never reach the session. */
interface CameraStatus {
  live: boolean;
  phone: boolean;
  /** Past the strictness grace: the popup shows and the phone is nudged when due. */
  phone_distracted: boolean;
}

export interface CurrentSession {
  id: number;
  goal: string;
  duration_seconds: number;
  elapsed_seconds: number;
  remaining_seconds: number;
  strictness: Strictness;
  status: SessionStatus;
  snoozed_until_seconds: number | null;
  metrics: SessionMetrics;
  focus: FocusSnapshot | null;
  /** Supervisor's own window is in front: `focus` is the place the user came from, its clock
   *  held, and this time counts as work. */
  supervisor_in_front: boolean;
  /** The browser in front can't have its address read, so its sites count as work. */
  unreadable_browser: string | null;
  /** Distractions allowed for this session. */
  exceptions: AppRule[];
  camera: CameraStatus;
  /** Present for Pomodoro sessions. */
  pomodoro?: PomodoroStatus | null;
}

export interface SessionSummary {
  id: number;
  goal: string;
  started_at: string;
  duration_seconds: number;
  /** Time not on a distraction. */
  focus_seconds: number;
  nudges: number;
  top_hints: string[];
  /** The session in order: runs of one state, with gaps where nothing was recorded. */
  segments: SummarySegment[];
}

interface SummarySegment {
  started_offset_seconds: number;
  seconds: number;
  state: string;
}

export interface ReportSpan {
  started_offset_seconds: number;
  seconds: number;
  kind: ActivityKind;
  activity_key: string;
  label: string;
  state: string;
  /** The session was paused, or on a break, just before this span. */
  after_pause?: boolean;
}

interface ReportEvent {
  at_offset_seconds: number;
  kind: string;
  detail: string | null;
}

export interface SessionReport {
  id: number;
  goal: string;
  strictness: string;
  started_at: string;
  ended_reason: string | null;
  duration_seconds: number;
  focus_percent: number;
  focused_seconds: number;
  distracted_seconds: number;
  idle_seconds: number;
  phone_seconds: number;
  nudge_count: number;
  longest_stretch_seconds: number;
  median_stretch_seconds: number;
  spans: ReportSpan[];
  apps: RecapApp[];
  events: ReportEvent[];
}

export interface DailyFocus {
  date: string;
  focus_seconds: number;
}

/** One week (from Monday) or month (from the 1st); `start` is its first day. */
export interface TrendPeriod {
  start: string;
  session_count: number;
  focus_seconds: number;
  median_stretch_seconds: number;
  recovery_median_seconds: number | null;
}

export type TrendUnit = "week" | "month";

/** A calendar month for the share card; `days[i].label` is the day ("2026-10-01"). */
export interface MonthRecap {
  start: string;
  end: string;
  focus_seconds: number;
  session_count: number;
  longest_stretch_seconds: number;
  days: RecapBucket[];
}

export interface HistoryWeek {
  week_start: string;
  sessions: SessionSummary[];
  oldest_day: string | null;
}

export interface TrendsData {
  daily_focus: DailyFocus[];
  /** The last eight weeks, oldest first, ending with the current week. */
  weeks: TrendPeriod[];
  /** Sessions exist before the first of those weeks. */
  has_earlier: boolean;
}

export type HistoryView = "list" | "report" | "trends";

interface RecapBucket {
  label: string;
  focus_seconds: number;
}

export interface RecapApp {
  group: string;
  kind: ActivityKind;
  key: string;
  label: string;
  seconds: number;
}

export interface WeekRecap {
  start: string;
  end: string;
  focus_seconds: number;
  session_count: number;
  buckets: RecapBucket[];
  median_stretch_seconds: number;
  longest_stretch_seconds: number;
  recovery_median_seconds: number | null;
  apps: RecapApp[];
}

export interface HistoryConfirm {
  kind: "delete-all" | "delete-session";
  id?: number;
  /** History's size on disk, for the delete-all prompt. `null` when it couldn't be read. */
  bytes?: number | null;
}

/** What the user must be told about history storage this run, until dismissed. */
export type StorageNotice =
  | { kind: "reset"; reason: string; moved_to: string }
  | { kind: "off"; reason: string }
  | { kind: "failed"; reason: string };

export interface SessionSnapshot {
  status: SessionStatus;
  settings: SessionSettings;
  current: CurrentSession | null;
  history: SessionSummary[];
  storage_notice: StorageNotice | null;
}

export interface RulesSaved {
  rules: AppRule[];
}

export interface RuleEditor {
  index: number | null;
  target: RuleTarget;
  value: string;
  name: string;
  nameTouched: boolean;
  preview: RulePreview;
  /** Delete was pressed once; the actions ask before the rule goes. */
  confirmDelete?: boolean;
}

export type RulePreview = { target: RuleTarget; value: string } | { error: string } | null;

export interface VoiceModelStatus {
  installed: boolean;
  installed_bytes: number;
  required_bytes: number;
}

interface VoiceRuntimeStatus {
  installed: boolean;
  source: "release" | "dev_override" | "missing";
  required_bytes: number | null;
}

interface VoiceSystemInfo {
  total_ram_bytes: number | null;
  available_ram_bytes: number | null;
  min_free_ram_bytes: number;
  last_peak_ram_bytes: number | null;
  has_enough_ram: boolean | null;
}

export interface VoiceClipSummary {
  clip_id: string;
  phrase_id: string;
  path: string;
}

export interface VoiceProfileSummary {
  profile_id: string;
  display_name: string;
  profile_dir: string;
  reference_path: string | null;
  /** The tone this voice speaks in sessions; null until the user picks one. */
  tone: string | null;
  clips: VoiceClipSummary[];
}

export interface VoiceBackendStatus {
  model: VoiceModelStatus;
  runtime: VoiceRuntimeStatus;
  system: VoiceSystemInfo;
  profiles: VoiceProfileSummary[];
}

export interface VoiceDownloadSnapshot {
  phase: VoiceDownloadPhase;
  downloaded_bytes: number;
  total_bytes: number;
  eta_seconds: number | null;
  /** What a running download is doing: a bar that stops still says why. */
  step: "downloading" | "checking" | "unpacking";
  message: string;
  up_to_date: boolean;
  /** Check for updates could not reach the server; `message` says so. */
  check_failed: boolean;
  model: VoiceModelStatus;
  runtime: VoiceRuntimeStatus;
}

export interface VoiceOption {
  id: string;
  name: string;
  /** Lines with audio, and lines in all, for the current personality. */
  ready: number;
  total: number;
  source: VoiceSource;
  selectable: boolean;
  profile: VoiceProfileSummary | null;
}

/** When a line plays. `nudge` is Back to work; a break ending plays nothing. */
export type PhraseMoment = "nudge" | "phone" | "roundover" | "sessionover";

/** One line. `tone` is the personality it belongs to. */
export interface PhraseDefinition {
  id: string;
  tone: VoiceTone;
  moment: PhraseMoment;
  text: string;
}

export interface PhraseEditor {
  phraseId: string | null;
  tone: VoiceTone;
  moment: PhraseMoment;
  text: string;
  /** Delete was pressed once; the action row asks before the line goes. */
  confirmDelete?: boolean;
}

export interface PhraseLibraryState {
  custom_tones: string[];
  custom_phrases: PhraseDefinition[];
  phrase_overrides: PhraseDefinition[];
  /** Bundled phrases the user deleted. */
  hidden_phrases: string[];
}

export interface RecordedVoice {
  path: string;
  url: string;
  bytes: number;
  seconds: number;
  name: string;
}

export interface WebcamFrame {
  face_in_frame: boolean;
  present?: boolean;
  phone_in_frame: boolean;
  jpeg?: string;
  error?: string | null;
  /** False on a preview picture sent between detections; its labels are the last detection's. */
  detected?: boolean;
}

export interface VoiceRecordingSnapshot {
  phase: RecordingState;
  path: string | null;
  bytes: number;
  duration_seconds: number;
  elapsed_seconds: number;
  message: string;
}

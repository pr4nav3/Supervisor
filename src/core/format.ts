

/** "4½ min", "1 min", "45 s". */
export function formatQueueTime(totalSeconds: number): string {
  if (totalSeconds < 60) {
    return `${totalSeconds} s`;
  }
  const halves = Math.round(totalSeconds / 30);
  return `${Math.floor(halves / 2)}${halves % 2 ? "½" : ""} min`;
}

/** First day of the month `key` falls in. */
export function monthKey(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

export function addMonthsKey(monthStart: string, months: number): string {
  const date = parseDayKey(monthStart);
  date.setMonth(date.getMonth() + months);
  return monthKey(dayKey(date));
}

export function formatRecovery(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds >= 3600) {
    return formatHours(seconds);
  }
  const rest = seconds % 60;
  return rest ? `${Math.floor(seconds / 60)}m ${rest}s` : `${seconds / 60}m`;
}

export function averageOf(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }
  if (bytes >= 1024 ** 2) {
    return `${Math.round(bytes / 1024 ** 2)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatMinutes(totalSeconds: number): string {
  if (totalSeconds > 0 && totalSeconds < 60) return "<1 min";
  return `${Math.max(0, Math.round(totalSeconds / 60))} min`;
}

export function formatStretchChip(totalSeconds: number): string {
  if (totalSeconds < 60) {
    return "<1m";
  }
  const minutes = Math.round(totalSeconds / 60);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

/** A day counts toward the streak at this much focused time. */
export const STREAK_DAY_SECONDS = 25 * 60;

export function monthLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** The median, or null when there is nothing to take it of. */
export function medianOf(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.floor((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

export function streakLabel(days: number): string {
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function parseDayKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function mondayOf(date: Date): Date {
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

export function thisMondayKey(): string {
  return dayKey(mondayOf(new Date()));
}

export function mondayKey(day: string): string {
  return dayKey(mondayOf(parseDayKey(day)));
}

export function addDaysKey(key: string, days: number): string {
  const date = parseDayKey(key);
  date.setDate(date.getDate() + days);
  return dayKey(date);
}

/** "Oct 5–11, 2026"; a week across New Year names both years: "Dec 28, 2026–Jan 3, 2027". */
export function formatWeekRange(startKey: string): string {
  const start = parseDayKey(startKey);
  const end = parseDayKey(addDaysKey(startKey, 6));
  const startMonth = start.toLocaleDateString(undefined, { month: "short" });
  const endMonth = end.toLocaleDateString(undefined, { month: "short" });
  if (start.getFullYear() !== end.getFullYear()) {
    return `${startMonth} ${start.getDate()}, ${start.getFullYear()}–${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
  }
  if (startMonth === endMonth) {
    return `${startMonth} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${startMonth} ${start.getDate()}–${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
}

export function formatWeekStart(startKey: string): string {
  return parseDayKey(startKey).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** A bar's height as a share of its track. The biggest value lands near the top of the track
 * whatever the week held, so a quiet week still draws a full chart; the others keep their order
 * and, eased by a mild power, stay readable next to it. The figure above the chart carries the
 * magnitude; the bars carry the shape. A zero is the caller's business; anything else is at
 * least `floor`. */
export function smartBarHeight(value: number, max: number, floor: number): number {
  if (value <= 0) {
    return 0;
  }
  const share = Math.min(1, value / Math.max(max, 1));
  return Math.round(floor + (92 - floor) * Math.pow(share, 0.7));
}

export function formatHours(totalSeconds: number): string {
  if (totalSeconds > 0 && totalSeconds < 60) {
    return "<1m";
  }
  const minutes = Math.round(Math.max(0, totalSeconds) / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) {
    return `${rest}m`;
  }
  return `${hours}h ${String(rest).padStart(2, "0")}m`;
}

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** "1h 40m", "13m 05s", "13s": a report's duration and phone time, down to the second. */
export function formatSpan(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

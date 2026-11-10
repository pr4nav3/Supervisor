import type { ReportSpan, SessionReport } from "../core/types";
import { formatDuration, formatHours, formatMinutes, formatSpan } from "../core/format";
import { allowedInReport, renderAppColumns } from "../main";
import { attr, escapeHtml, label } from "../core/dom";

export function renderSessionReport(report: SessionReport): string {
  const recorded = report.spans.reduce((sum, span) => sum + span.seconds, 0);
  const unrecorded = report.spans.length > 0 && recorded + 1 < timelineSeconds(report);
  const legend = renderTimelineLegend(report, unrecorded);
  return `
    <section class="history-page">
      <div class="report-toolbar">
        <button class="small-button" type="button" data-action="close-report">Back</button>
        <button class="small-button danger" type="button" data-action="ask-delete-session" data-session-id="${report.id}">Delete</button>
      </div>
      <section class="state-slab report-slab">
        <h2>${escapeHtml(report.goal)}</h2>
        <p class="report-meta">${escapeHtml(reportSummaryLine(report))}</p>
        <div class="report-bar-head">
          <p class="report-meta report-hint ${report.spans.length ? "" : "is-placeholder"}" ${report.spans.length ? "" : `aria-hidden="true"`}>Hover over the bar to see each app and how long it lasted.</p>
          ${legend ? `<div class="report-inset">${legend}</div>` : ""}
        </div>
        ${renderReportTimeline(report)}
      </section>
      <section class="report-stats" aria-label="Session stats">
          ${flipStat("report-stat", "Duration", formatSpan(report.duration_seconds), "How long the session ran. Paused time isn't counted.")}
        ${flipStat("report-stat", "Focused", `${report.focus_percent}%`, "Of your time at the desk, the share you were on work. Away does not count.")}
        ${flipStat("report-stat", "Longest stretch", formatMinutes(report.longest_stretch_seconds), "Your longest run of work without a distraction or stepping away.")}
        ${flipStat("report-stat", "Reminders", String(report.nudge_count), "How many times Supervisor spoke up to pull you back.")}
        ${pomodoroStat(report)}
        ${report.phone_seconds > 0 ? flipStat("report-stat", "Phone or watch", formatSpan(report.phone_seconds), "How long the webcam saw a phone or watch out.") : ""}
      </section>
      <section class="panel recap-apps">
        <h2 class="eyebrow recap-apps-title">Apps &amp; sites</h2>
        ${report.apps.length === 0 ? `<p class="empty">No app time recorded.</p>` : renderAppColumns(report.apps, report.id, "session", allowedInReport(report))}
      </section>
    </section>
  `;
}

/** Stat tiles turned over to their explanation; cleared when another report opens. */
export const flippedStats = new Set<string>();

/** A report tile, or one of the week card's two, that turns over to its explanation. The week
 *  card's keys stay apart from the report's. */
export function flipStat(cls: "week-hero-stat" | "report-stat", labelText: string, value: string, help: string): string {
  const week = cls === "week-hero-stat";
  const key = week ? `week:${labelText}` : labelText;
  const flipped = flippedStats.has(key);
  return `
    <button class="${cls} ${flipped ? "is-flipped" : ""}" type="button" data-stat-flip="${attr(key)}" aria-pressed="${flipped}">
      <span class="${cls}-face"><span${week ? ` class="eyebrow"` : ""}>${escapeHtml(labelText)}</span><strong>${escapeHtml(value)}</strong></span>
      <span class="${cls}-face ${cls}-back">${escapeHtml(help)}</span>
    </button>
  `;
}

/** "4 × 25 min" for a Pomodoro session, from the event its start wrote ("25/5x4"). */
function pomodoroStat(report: SessionReport): string {
  const plan = report.events.find((event) => event.kind === "pomodoro")?.detail?.match(/^(\d+)\/(\d+)x(\d+)$/);
  if (!plan) {
    return "";
  }
  // Rounds finished: each round end, plus the last one when the session ran its course.
  const finished = report.events.filter((event) => event.kind === "round_over").length + (report.ended_reason === "completed" ? 1 : 0);
  return flipStat("report-stat", "Rounds", `${Math.min(finished, Number(plan[3]))} of ${plan[3]}`, `${plan[1]}-minute rounds, ${plan[2]}-minute breaks. Breaks aren't in the timeline or the duration.`);
}

/** Pauses are cut out, so the bar is the time the session ran; older sessions recorded before
 *  the gap-free recorder can still run a little past it. */
export function timelineSeconds(report: SessionReport): number {
  const spanEnd = report.spans.reduce((end, span) => Math.max(end, span.started_offset_seconds + span.seconds), 0);
  return Math.max(report.duration_seconds, 1, spanEnd);
}

/** One stretch of the report's bar: back-to-back spans of the same kind joined. */
interface TimelineRun {
  state: string;
  from: number;
  to: number;
  labels: string[];
}

/** Suspicious reads as a distraction and lost time as away, so each run is one colour. */
function timelineKind(state: string): string {
  return state === "suspicious" ? "distracted" : state === "unknown" ? "idle" : state;
}

/** Spans joined into runs when back to back and the same kind. Nothing short is hidden: the
 *  bar draws every run at least a few pixels wide. A gap (an unrecorded stretch) is kept. */
function timelineRuns(spans: ReportSpan[]): TimelineRun[] {
  const runs: TimelineRun[] = [];
  for (const span of spans) {
    const from = span.started_offset_seconds;
    const to = from + span.seconds;
    const state = timelineKind(span.state);
    const last = runs[runs.length - 1];
    const touching = last && from - last.to < 2;
    if (touching && last.state === state) {
      last.to = to;
      if (!last.labels.includes(span.label)) {
        last.labels.push(span.label);
      }
    } else {
      runs.push({ state, from, to, labels: [span.label] });
    }
  }
  return runs;
}

const TIMELINE_NAMES: Record<string, string> = { phone: "Phone or watch", idle: "Away" };

/** What a run is called on hover: the apps and sites, and how long. Whether it was work or a
 *  distraction is left to the colour and the legend; Away and Phone have no names of their own. */
function timelineRunLine(run: TimelineRun): string {
  const names = run.labels.length > 3 ? `${run.labels.slice(0, 3).join(", ")} +${run.labels.length - 3}` : run.labels.join(", ");
  const head = run.state === "idle" || run.state === "phone" ? TIMELINE_NAMES[run.state] : names;
  const seconds = run.to - run.from;
  return `${head} · ${seconds < 60 ? `${Math.round(seconds)}s` : formatHours(seconds)}`;
}

function renderReportTimeline(report: SessionReport): string {
  const duration = timelineSeconds(report);
  if (report.spans.length === 0) {
    // An empty bar where the timeline would be, so the card keeps its layout.
    return `
      <div class="timeline-wrap">
        <div class="timeline-bar timeline-empty" role="img" aria-label="No timeline for this session">
          <span>No timeline for this session</span>
        </div>
      </div>
    `;
  }
  const runs = timelineRuns(report.spans);
  const pct = (seconds: number) => (seconds / duration) * 100;
  // The hover reads each run from these; the lifted run and the tip sit outside the clipped bar.
  const data = runs.map((run) => ({
    from: pct(run.from),
    to: pct(run.to),
    line: timelineRunLine(run),
    when: `${formatDuration(run.from)} to ${formatDuration(run.to)}`,
  }));
  return `
    <div class="timeline-wrap" tabindex="0" aria-label="Session timeline. Use the left and right arrow keys to step through it." data-runs="${attr(JSON.stringify(data))}">
      <div class="timeline-bar" role="img" aria-label="Session timeline">
        ${runs
          .map((run) => `<span class="timeline-span state-${escapeHtml(run.state)}" style="left: ${pct(run.from).toFixed(3)}%; width: max(3px, ${(pct(run.to) - pct(run.from)).toFixed(3)}%)${pct(run.to) - pct(run.from) < 1 ? "; z-index: 1" : ""}"></span>`)
          .join("")}
      </div>
      <b class="timeline-lift" aria-hidden="true"></b>
      <div class="timeline-tip" hidden></div>
    </div>
  `;
}

type TimelineHoverRun = { from: number; to: number; line: string; when: string };

/** Parts of the bar too thin to point at (under 10px) that sit side by side hover as one group. */
const TIMELINE_THIN = 10;

function timelineGroups(runs: TimelineHoverRun[], width: number): number[][] {
  const thin = (index: number) => ((runs[index].to - runs[index].from) / 100) * width < TIMELINE_THIN;
  const groups: number[][] = [];
  runs.forEach((_, index) => {
    const last = groups[groups.length - 1];
    if (last && thin(index) && thin(last[last.length - 1])) {
      last.push(index);
    } else {
      groups.push([index]);
    }
  });
  return groups;
}

function clearTimeline(wrap: HTMLElement): void {
  wrap.querySelector<HTMLElement>(".timeline-lift")!.classList.remove("is-up");
  wrap.querySelector<HTMLElement>(".timeline-tip")!.hidden = true;
  delete wrap.dataset.pick;
}

/** Pops a part, or a group of thin parts, out of the bar and points the tip at it. A group pops
 *  out as a little zoomed-in bar, each part 16px wide, and the tip lists them in order. */
function showTimelineGroup(wrap: HTMLElement, group: number[]): void {
  const bar = wrap.querySelector<HTMLElement>(".timeline-bar")!;
  const lift = wrap.querySelector<HTMLElement>(".timeline-lift")!;
  const tip = wrap.querySelector<HTMLElement>(".timeline-tip")!;
  const runs = JSON.parse(wrap.dataset.runs ?? "[]") as TimelineHoverRun[];
  const spans = bar.querySelectorAll<HTMLElement>(".timeline-span");
  const parts = group.map((index) => runs[index]);
  wrap.dataset.pick = String(group[0]);
  const inner = bar.clientWidth;
  const left = (parts[0].from / 100) * inner;
  const width = Math.max(((parts[parts.length - 1].to - parts[0].from) / 100) * inner, 3);
  const liftWidth = Math.max(width, group.length > 1 ? group.length * 16 : 12);
  const center = bar.offsetLeft + bar.clientLeft + left + width / 2;
  const top = bar.offsetTop + bar.clientTop;
  const colour = (index: number) => getComputedStyle(spans[index]).backgroundColor;
  // A group shows each part as an equal slice, with an ink line between.
  const slice = 100 / group.length;
  lift.style.background =
    group.length === 1
      ? getComputedStyle(spans[group[0]]).background
      : `linear-gradient(90deg, ${group.map((index, n) => `${colour(index)} ${n * slice}% ${(n + 1) * slice}%`).join(", ")})`;
  if (group.length > 1) {
    lift.style.backgroundImage = `repeating-linear-gradient(90deg, transparent 0 calc(${slice}% - 2px), #101010 calc(${slice}% - 2px) ${slice}%), ${lift.style.backgroundImage}`;
  }
  // Coming up from nothing: start flush with the bar, then grow; a popped part slides along.
  if (!lift.classList.contains("is-up")) {
    lift.style.transition = "none";
    lift.style.top = `${top}px`;
    lift.style.height = `${bar.clientHeight}px`;
    lift.style.left = `${center - width / 2}px`;
    lift.style.width = `${width}px`;
    void lift.offsetWidth;
    lift.style.transition = "";
  }
  lift.style.top = `${top - 9}px`;
  lift.style.height = `${bar.clientHeight + 18}px`;
  lift.style.left = `${center - liftWidth / 2 - 6}px`;
  lift.style.width = `${liftWidth + 12}px`;
  lift.classList.add("is-up");
  const from = parts[0].when.split(" to ")[0];
  const to = parts[parts.length - 1].when.split(" to ")[1];
  tip.innerHTML =
    group.length === 1
      ? `<b>${escapeHtml(parts[0].line)}</b><small>${escapeHtml(parts[0].when)}</small>`
      : `${parts.map((part, n) => `<b class="timeline-tip-row"><i style="background: ${colour(group[n])}"></i>${escapeHtml(part.line)}</b>`).join("")}<small>${escapeHtml(from)} to ${escapeHtml(to)}</small>`;
  tip.hidden = false;
  const half = tip.offsetWidth / 2;
  const tipLeft = Math.min(Math.max(center, bar.offsetLeft + half), bar.offsetLeft + bar.offsetWidth - half);
  tip.style.left = `${tipLeft}px`;
  tip.style.setProperty("--caret", `${center - tipLeft + half}px`);
}

/** One hover for the whole bar: the part under the cursor, or a thin one (or a group of thin
 *  ones) within 8px, so even a sliver can be found without aiming at it. */
function hoverTimeline(event: MouseEvent): void {
  const wrap = (event.target as HTMLElement).closest<HTMLElement>(".timeline-wrap[data-runs]");
  document.querySelectorAll<HTMLElement>(".timeline-wrap[data-pick]").forEach((other) => {
    if (other !== wrap) {
      clearTimeline(other);
    }
  });
  const bar = wrap?.querySelector<HTMLElement>(".timeline-bar");
  if (!wrap || !bar) {
    return;
  }
  const box = bar.getBoundingClientRect();
  const x = event.clientX - box.left;
  if (x < -8 || x > box.width + 8) {
    clearTimeline(wrap);
    return;
  }
  const runs = JSON.parse(wrap.dataset.runs ?? "[]") as TimelineHoverRun[];
  const px = (percent: number) => (percent / 100) * box.width;
  const groups = timelineGroups(runs, box.width);
  const reach = (group: number[]) => {
    const from = px(runs[group[0]].from);
    return [from, Math.max(px(runs[group[group.length - 1]].to), from + 3)];
  };
  let pick = groups.find((group) => x >= reach(group)[0] && x < reach(group)[1]) ?? groups[groups.length - 1];
  let nearest = Infinity;
  groups.forEach((group) => {
    const [from, to] = reach(group);
    const distance = x < from ? from - x : x > to ? x - to : 0;
    if ((group.length > 1 || to - from < TIMELINE_THIN) && distance <= 8 && distance < nearest) {
      nearest = distance;
      pick = group;
    }
  });
  showTimelineGroup(wrap, pick);
}

document.addEventListener("mousemove", hoverTimeline);

// Left and Right step through the parts one by one, however thin. Escape lets go of a part,
// and only with none picked does it go on to close the report.
document.addEventListener("keydown", (event) => {
  const wrap = (event.target as HTMLElement).closest?.<HTMLElement>(".timeline-wrap[data-runs]");
  if (!wrap || !["ArrowLeft", "ArrowRight", "Escape"].includes(event.key)) {
    return;
  }
  if (event.key === "Escape") {
    if (wrap.dataset.pick !== undefined) {
      event.stopPropagation();
      clearTimeline(wrap);
    }
    return;
  }
  event.preventDefault();
  const runs = JSON.parse(wrap.dataset.runs ?? "[]") as TimelineHoverRun[];
  const current = wrap.dataset.pick === undefined ? (event.key === "ArrowRight" ? -1 : runs.length) : Number(wrap.dataset.pick);
  const pick = Math.min(Math.max(current + (event.key === "ArrowRight" ? 1 : -1), 0), runs.length - 1);
  showTimelineGroup(wrap, [pick]);
});
document.addEventListener("focusout", (event) => {
  const wrap = (event.target as HTMLElement).closest?.<HTMLElement>(".timeline-wrap[data-pick]");
  if (wrap) {
    clearTimeline(wrap);
  }
});

/** Only the states this session's bar actually shows. */
function renderTimelineLegend(report: SessionReport, unrecorded: boolean): string {
  const present = new Set(report.spans.map((span) => span.state));
  const items = [
    [["focused"], "state-focused", "Work"],
    [["suspicious", "distracted"], "state-distracted", "Distraction"],
    [["phone"], "state-phone", "Phone or watch"],
    // Idle (no input) and device asleep / unknown are one "Away"; hovering a segment says which.
    [["idle", "unknown"], "state-idle", "Away"],
  ]
    .filter(([states]) => (states as string[]).some((state) => present.has(state)))
    .map(([, cls, name]) => [cls as string, name as string]);
  // Only sessions recorded before the gap-free recorder can have these.
  if (unrecorded) {
    items.push(["state-unrecorded", "Not recorded"]);
  }
  if (items.length === 0) {
    return "";
  }
  return `
    <ul class="legend-swatches">
      ${items
        .map(
          ([cls, name]) => `
            <li class="legend-swatch">
              <i class="legend-key ${cls}" aria-hidden="true"></i>
              <span>${escapeHtml(name)}</span>
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

/** "18 October 2026, 11:13 AM · Normal" */
function reportSummaryLine(report: SessionReport): string {
  const started = new Date(report.started_at);
  const date = started.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const time = started.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date}, ${time} · ${label(report.strictness)}`;
}

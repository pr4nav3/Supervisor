// The UI's pure logic and its import rules: `npm run check` runs this with Node's own test runner.
// Node runs the TypeScript directly (type stripping), so only modules with no runtime imports
// load here: src/core/format.ts is the dates and numbers every screen uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import * as f from "../src/core/format.ts";

test("day keys survive month and year ends and daylight-saving days", () => {
  for (const key of ["2026-03-08", "2026-03-29", "2026-11-01", "2026-10-25", "2024-02-29"]) {
    assert.equal(f.dayKey(f.parseDayKey(key)), key);
  }
  assert.equal(f.addDaysKey("2026-12-28", 6), "2027-01-03");
  assert.equal(f.addDaysKey("2026-03-07", 2), "2026-03-09");
  assert.equal(f.addDaysKey("2026-10-31", 2), "2026-11-02");
  assert.equal(f.addDaysKey("2026-01-01", -1), "2025-12-31");
});

test("a week starts on Monday", () => {
  assert.equal(f.mondayKey("2026-11-12"), "2026-11-09"); // Thursday
  assert.equal(f.mondayKey("2026-11-09"), "2026-11-09"); // Monday
  assert.equal(f.mondayKey("2026-11-15"), "2026-11-09"); // Sunday
  assert.equal(f.mondayKey("2027-01-01"), "2026-12-28");
});

test("months step across years", () => {
  assert.equal(f.monthKey("2026-11-12"), "2026-11-01");
  assert.equal(f.addMonthsKey("2026-12-01", 1), "2027-01-01");
  assert.equal(f.addMonthsKey("2026-01-01", -1), "2025-12-01");
  assert.equal(f.addMonthsKey("2026-01-01", 13), "2027-02-01");
});

test("a week across New Year names both years", () => {
  const range = f.formatWeekRange("2026-12-28");
  assert.match(range, /2026/);
  assert.match(range, /2027/);
  assert.doesNotMatch(f.formatWeekRange("2026-11-09"), /2026.*2026/);
});

test("durations read the way the screens print them", () => {
  assert.equal(f.formatDuration(65.9), "1:05");
  assert.equal(f.formatDuration(-4), "0:00");
  assert.equal(f.formatHours(30), "<1m");
  assert.equal(f.formatHours(0), "0m");
  assert.equal(f.formatHours(5400), "1h 30m");
  assert.equal(f.formatSpan(13), "13s");
  assert.equal(f.formatSpan(785), "13m 05s");
  assert.equal(f.formatSpan(6000), "1h 40m");
  assert.equal(f.formatStretchChip(59), "<1m");
  assert.equal(f.formatStretchChip(3600), "1h");
  assert.equal(f.formatStretchChip(3900), "1h 5m");
  assert.equal(f.formatRecovery(40), "40s");
  assert.equal(f.formatRecovery(90), "1m 30s");
  assert.equal(f.formatRecovery(120), "2m");
  assert.equal(f.formatMinutes(30), "<1 min");
  assert.equal(f.formatQueueTime(45), "45 s");
  assert.equal(f.formatQueueTime(60), "1 min");
  assert.equal(f.formatQueueTime(75), "1½ min");
  assert.equal(f.formatQueueTime(270), "4½ min");
  assert.equal(f.formatBytes(500), "1 KB");
  assert.equal(f.formatBytes(5 * 1024 ** 2), "5 MB");
  assert.equal(f.formatBytes(2.1 * 1024 ** 3), "2.1 GB");
  assert.equal(f.streakLabel(1), "1 day");
  assert.equal(f.streakLabel(2), "2 days");
});

test("medians and bar heights", () => {
  assert.equal(f.medianOf([]), null);
  assert.equal(f.medianOf([3, 1, 2]), 2);
  assert.equal(f.medianOf([1, 2, 3, 4]), 2);
  assert.equal(f.averageOf([]), null);
  assert.equal(f.smartBarHeight(0, 100, 8), 0);
  assert.equal(f.smartBarHeight(100, 100, 8), 92);
  assert.ok(f.smartBarHeight(1, 1000, 8) >= 8);
  assert.ok(f.smartBarHeight(30, 100, 8) < f.smartBarHeight(60, 100, 8));
});

test("the core never imports a screen, and nothing but main.ts imports main at run time", () => {
  const runtimeImports = (dir) =>
    readdirSync(new URL(dir, import.meta.url))
      .filter((name) => name.endsWith(".ts"))
      .flatMap((name) =>
        [...readFileSync(new URL(dir + name, import.meta.url), "utf8").matchAll(/^import (?!type )[^;]*? from "([^"]+)"/gms)].map(
          (m) => [dir + name, m[1]],
        ),
      );
  const core = runtimeImports("../src/core/");
  assert.deepEqual(core.filter(([, from]) => from.includes("screens/") || from.endsWith("/main")), []);
  const screens = runtimeImports("../src/screens/");
  assert.deepEqual(screens.filter(([, from]) => from.endsWith("/main")), []);
});

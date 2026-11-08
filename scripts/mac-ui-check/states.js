// Loads every app state in an iframe (same origin) and measures it. Same code runs in
// WebKit (webkit-eval) and Chromium (browser pane); the outputs are diffed.
const W = typeof STATE_WIDTH !== "undefined" ? STATE_WIDTH : 920;
const H = typeof STATE_HEIGHT !== "undefined" ? STATE_HEIGHT : 760;
const M = "http://127.0.0.1:1420/scripts/mac-ui-check/mock.html";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (d, sel) => { const el = d.querySelector(sel); if (!el) throw new Error("missing " + sel); el.click(); };
const tab = (d, name) => click(d, `[data-tab="${name}"]`);
const STATES = [
  ["home", M, null],
  ["home-mac", M + "?mac=1", null],
  ["onboarding-mac", M + "?mac=1", (d) => click(d, '[data-action="onboard-show"]')],
  ["home-empty", M + "?empty=1", null],
  ["home-first", M + "?first=1", null],
  ["onboarding", M + "?empty=1", (d) => click(d, '[data-action="onboard-show"]')],
  ["first-run-list", M + "?empty=1", async (d) => { click(d, '[data-action="onboard-show"]'); await sleep(300); click(d, '[data-action="first-run-next"]'); await sleep(300); }],
  ["first-run-list-mac", M + "?empty=1&mac=1", async (d) => { click(d, '[data-action="onboard-show"]'); await sleep(300); click(d, '[data-action="first-run-next"]'); await sleep(300); click(d, '[data-action="first-run-next"]'); await sleep(300); }],
  ["preflight", M, (d) => click(d, '[data-action="open-preflight"]')],
  ["preflight-open-blocks", M, async (d) => { click(d, '[data-action="open-preflight"]'); await sleep(300); d.querySelectorAll(".preflight-panel details, .preflight-panel summary").forEach((e) => { if (e.tagName === "DETAILS") e.open = true; }); }],
  ["live", M + "?live=1", null],
  ["live-drift", M + "?live=1&drift=1", null],
  ["live-allowed", M + "?live=1&allowed=1", null],
  // Eleven rules: the allowed one (youtube.com) is past the first six and still gets its chip.
  ["live-many-allowed", M + "?live=1&many=1&allowed=1", (d) => { if (!d.querySelector('.session-rule-chips .is-allowed')) throw new Error("allowed chip hidden"); }],
  ["live-many-allowed-dark", M + "?live=1&many=1&allowed=1&dark=1", (d) => { if (!d.querySelector('.session-rule-chips .is-allowed')) throw new Error("allowed chip hidden"); }],
  ["live-rules", M + "?live=1", (d) => click(d, '[data-action="open-session-rules"]')],
  ["settings", M + "?done=1", (d) => tab(d, "settings")],
  ["settings-rule-editor", M + "?done=1", async (d) => { tab(d, "settings"); await sleep(300); [...d.querySelectorAll(".settings-rules-panel button")].find((b) => /add/i.test(b.textContent))?.click(); }],
  ["settings-delete-all", M + "?done=1", async (d) => { tab(d, "settings"); await sleep(300); [...d.querySelectorAll("button")].find((b) => /delete all history/i.test(b.textContent))?.click(); }],
  ["voice", M + "?done=1", async (d) => { tab(d, "settings"); await sleep(300); click(d, '[data-action="open-voice-settings"]'); }],
  ["voice-model-popup", M + "?done=1", async (d) => { tab(d, "settings"); await sleep(300); click(d, '[data-action="open-voice-settings"]'); await sleep(800); click(d, '[data-action="open-model-info"]'); }],
  ["voice-memory-popup", M + "?done=1", async (d) => { tab(d, "settings"); await sleep(300); click(d, '[data-action="open-voice-settings"]'); await sleep(800); click(d, '[data-action="open-memory-info"]'); }],
  ["voice-line-popup", M + "?done=1", async (d) => { tab(d, "settings"); await sleep(300); click(d, '[data-action="open-voice-settings"]'); await sleep(800); [...d.querySelectorAll("button")].find((b) => /edit/i.test(b.textContent))?.click(); }],
  ["voice-tones-popup", M + "?done=1", async (d) => { tab(d, "settings"); await sleep(300); click(d, '[data-action="open-voice-settings"]'); await sleep(800); click(d, '[data-action="new-tone"]'); }],
  ["voice-new-voice", M + "?done=1", async (d) => { tab(d, "settings"); await sleep(300); click(d, '[data-action="open-voice-settings"]'); await sleep(800); [...d.querySelectorAll("button")].find((b) => /new voice/i.test(b.textContent))?.click(); }],
  ["voice-info", M + "?done=1&dad=1", async (d) => { tab(d, "settings"); await sleep(300); click(d, '[data-action="open-voice-settings"]'); await sleep(800); click(d, '[data-action="voice-info"]'); }],
  ["voice-lowram", M + "?done=1&lowram=1", async (d) => { tab(d, "settings"); await sleep(300); click(d, '[data-action="open-voice-settings"]'); }],
  ["voice-nomodel", M + "?done=1&nomodel=1", async (d) => { tab(d, "settings"); await sleep(300); click(d, '[data-action="open-voice-settings"]'); }],
  ["voice-offline", M, async (d) => { tab(d, "settings"); await sleep(300); click(d, '[data-action="open-voice-settings"]'); }],
  ["webcam", M + "?done=1", async (d) => { tab(d, "settings"); await sleep(300); click(d, '[data-action="open-webcam-settings"]'); }],
  ["history", M + "?big=1", (d) => tab(d, "history")],
  ["history-picker", M + "?big=1", async (d) => { tab(d, "history"); await sleep(600); click(d, '[data-action="toggle-week-picker"]'); }],
  ["history-apps", M + "?big=1", async (d) => { tab(d, "history"); await sleep(600); [...d.querySelectorAll('[data-action="history-pane"]')].pop()?.click(); }],
  ["history-many", M + "?many=1", (d) => tab(d, "history")],
  ["history-empty", M + "?empty=1", (d) => tab(d, "history")],
  ["report", M + "?big=1", async (d) => { tab(d, "history"); await sleep(600); click(d, ".history-item"); }],
  ["report-edit", M + "?big=1", async (d) => { tab(d, "history"); await sleep(600); click(d, ".history-item"); await sleep(500); click(d, '[data-action="edit-app"][data-kind="website"]'); await sleep(400); }],
  ["week-app-edit", M + "?big=1", async (d) => { tab(d, "history"); await sleep(600); [...d.querySelectorAll('[data-action="history-pane"]')].pop()?.click(); await sleep(400); click(d, '[data-action="edit-app"]'); await sleep(400); }],
  ["overlay-corner-more", M + "?view=overlay&live=1", (d) => click(d, '[data-action="toggle-overlay-more"]'), 228, 400],
  ["report-delete", M + "?big=1", async (d) => { tab(d, "history"); await sleep(600); click(d, ".history-item"); await sleep(500); click(d, '[data-action="ask-delete-session"]'); }],
  ["trends", M + "?big=1", async (d) => { tab(d, "history"); await sleep(600); click(d, '[data-action="open-trends"]'); }],
  ["share", M + "?big=1", async (d) => { tab(d, "history"); await sleep(600); click(d, '[data-action="open-share"]'); await sleep(900); }],
  ["overlay-corner", M + "?view=overlay&live=1", null, 228, 400],
  ["overlay-interrupt", M + "?view=overlay&live=1&drift=1", null, 420, 600],
  ["preflight-pomodoro", M, async (d) => { click(d, '[data-action="open-preflight"]'); await sleep(300); click(d, '[data-mode="pomodoro"]'); }],
  ["live-pomodoro-round", M + "?live=1&pomo=work", null],
  ["live-pomodoro-break", M + "?live=1&pomo=break", null],
  ["overlay-round-over", M + "?view=overlay&live=1&pomo=break&voice=1&speak_ms=60000", () => sleep(1500), 420, 600],
  ["overlay-break-over", M + "?view=overlay&live=1&pomo=break_over&voice=1&speak_ms=60000", () => sleep(1500), 420, 600],
  ["overlay-corner-break", M + "?view=overlay&live=1&pomo=break", (d) => click(d, '[data-action="dismiss-moment"]'), 228, 400],
  ["overlay-interrupt-voice", M + "?view=overlay&live=1&drift=1&voice=1&speak_ms=60000", () => sleep(1500), 420, 600],
  ["overlay-phone-voice", M + "?view=overlay&live=1&phone=1&voice=1&speak_ms=60000", () => sleep(1500), 420, 600],
  // Screens since the 2026-10-31 Mac pass. "dark=1" turns the app's dark theme on first.
  ["preflight-slider", M, async (d) => { click(d, '[data-action="open-preflight"]'); await sleep(300); const r = d.querySelector('.preflight-panel input[type="range"]'); r.value = r.max; r.dispatchEvent(new Event("input", { bubbles: true })); }],
  ["live-mac", M + "?live=1&mac=1", null],
  ["live-unreadable", M + "?live=1&unreadable=1", null],
  ["live-dark", M + "?live=1&drift=1&dark=1", null],
  ["overlay-interrupt-voice-dark", M + "?view=overlay&live=1&drift=1&voice=1&speak_ms=60000&dark=1", () => sleep(1500), 420, 600],
  ["overlay-corner-dark", M + "?view=overlay&live=1&dark=1", null, 228, 400],
  ["settings-dark", M + "?done=1&dark=1", (d) => tab(d, "settings")],
  ["voice-hello", M + "?done=1", async (d) => { tab(d, "settings"); await sleep(300); click(d, '[data-action="open-voice-settings"]'); await sleep(800); d.querySelector(".voice-card:has(.voice-card-line)").classList.add("is-speaking"); }],
  ["first-run-voice-hello", M + "?empty=1&done=1", async (d) => { click(d, '[data-action="onboard-show"]'); await sleep(800); d.querySelector(".first-run-voices .voice-card:has(.voice-card-line)").classList.add("is-speaking"); }],
  // A recorded voice with its back to work lines only: the notice that it stays silent elsewhere.
  ["voice-gaps", M + "?done=1&tone=mom&clips=mom_see_from_here,mom_why_is_it_open,mom_come_over_there,mom_five_minutes_hour,mom_grounded,mom_counting_to_three", async (d) => { tab(d, "settings"); await sleep(300); click(d, '[data-action="open-voice-settings"]'); await sleep(800); click(d, '[data-action="select-voice"][aria-label="Select Mum"]'); await sleep(800); if (!d.querySelector(".notice-voice-gap")) throw new Error("no voice gap notice"); }],
  ["preflight-gaps", M + "?done=1&tone=mom&clips=mom_see_from_here,mom_why_is_it_open,mom_come_over_there,mom_five_minutes_hour,mom_grounded,mom_counting_to_three", async (d) => { tab(d, "settings"); await sleep(300); click(d, '[data-action="open-voice-settings"]'); await sleep(800); click(d, '[data-action="select-voice"][aria-label="Select Mum"]'); await sleep(600); tab(d, "session"); await sleep(400); click(d, '[data-action="open-preflight"]'); await sleep(600); if (!d.querySelector(".notice-voice-gap")) throw new Error("no voice gap notice on the start screen"); }],
  // Before the practice states: a practice left in storage ends the next session on load.
  ["session-over", M + "?live=1&done=1", async (d) => { click(d, '[data-action="stop"]'); await sleep(1500); }],
  // Getting started, every step through the practice.
  ["first-run-catch", M + "?empty=1", async (d) => { click(d, '[data-action="onboard-show"]'); for (let i = 0; i < 6 && !d.querySelector('[data-action="first-run-practice"]'); i++) { await sleep(300); click(d, '[data-action="first-run-next"]'); } }],
  ["first-run-practising", M + "?empty=1", async (d) => { click(d, '[data-action="onboard-show"]'); for (let i = 0; i < 6 && !d.querySelector('[data-action="first-run-practice"]'); i++) { await sleep(300); click(d, '[data-action="first-run-next"]'); } await sleep(300); click(d, '[data-action="first-run-practice"]'); await sleep(1000); }],
  ["first-run-caught", M + "?empty=1", async (d) => { click(d, '[data-action="onboard-show"]'); for (let i = 0; i < 6 && !d.querySelector('[data-action="first-run-practice"]'); i++) { await sleep(300); click(d, '[data-action="first-run-next"]'); } await sleep(300); click(d, '[data-action="first-run-practice"]'); await sleep(8000); }],
];
// mock.html?dark=1 as the outer page runs every state in the dark theme.
const ALL_DARK = location.search.includes("dark=1");
const snap = window.webkit?.messageHandlers?.snap;
const results = [];
// mock.html#only=a,b lays out just those states.
const ONLY = new URLSearchParams(location.hash.slice(1)).get("only")?.split(",");
for (const [name, url, setup, w, h] of STATES.filter(([n]) => !ONLY || ONLY.includes(n))) {
  if (ALL_DARK || url.includes("dark=1")) localStorage.setItem("supervisor-theme", "dark"); else localStorage.removeItem("supervisor-theme");
  const frame = document.createElement("iframe");
  frame.style.cssText = `position:fixed;left:0;top:0;width:${w || W}px;height:${h || H}px;border:0;z-index:9999;background:#fff`;
  document.body.appendChild(frame);
  const loaded = new Promise((r) => (frame.onload = r));
  frame.src = url;
  await loaded; await sleep(900);
  const d = frame.contentDocument;
  const s = d.createElement("style"); s.textContent = "*,*::before,*::after{animation:none!important;transition:none!important}"; d.head.appendChild(s);
  try {
    if (setup) await setup(d);
    await sleep(900);
    const sizes = {};
    for (const sel of [".app-shell", ".home-grid", ".modal-panel", ".preflight-panel", ".state-slab", ".interrupt-alert", ".settings-page", ".voice-page", ".webcam-page", ".history-page", ".report-slab", ".overlay-shell", ".cal-grid", ".quote-card", ".first-run-panel", ".history-item", ".voice-card", ".phrase-panel", ".trend-card"]) {
      const el = d.querySelector(sel); if (el) { const r = el.getBoundingClientRect(); sizes[sel] = [Math.round(r.width), Math.round(r.height)]; }
    }
    const w2 = frame.contentWindow;
    // Text cut off by its own box: wider than it can show, and not an intended ellipsis.
    const clipped = [];
    for (const el of d.querySelectorAll("button, .sofar-tiles *, .voice-card *, .interrupt-alert *, .share-card *, .report-slab *, .settings-page *, .preflight-panel *, .active-session-controls *")) {
      const cs = w2.getComputedStyle(el);
      if (!el.offsetParent || cs.textOverflow === "ellipsis" || !/hidden|clip/.test(cs.overflowX + cs.overflowY)) continue;
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) clipped.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} ${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}`);
    }
    // Items of a centred row whose vertical centres differ: one sits higher than its neighbour.
    const misaligned = [];
    const tag = (el) => `${el.tagName.toLowerCase()}${el.classList.length ? "." + [...el.classList].join(".") : ""}`;
    for (const row of d.querySelectorAll("body *")) {
      const cs = w2.getComputedStyle(row);
      if (!row.offsetParent || !/flex|grid/.test(cs.display) || cs.alignItems !== "center" || (/flex/.test(cs.display) && !cs.flexDirection.startsWith("row"))) continue;
      const items = [...row.children].filter((c) => { const k = w2.getComputedStyle(c); return c.offsetParent && !/absolute|fixed/.test(k.position) && k.alignSelf === "auto" && c.getBoundingClientRect().height > 0; })
        .map((c) => ({ c, r: c.getBoundingClientRect() }));
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i].r, b = items[j].r;
        if (a.bottom <= b.top || b.bottom <= a.top) continue; // different lines of a wrapped row
        const mid = (r) => (r.top + r.bottom) / 2;
        if (Math.abs(mid(a) - mid(b)) > 1) misaligned.push(`${tag(row)}: ${tag(items[i].c)} and ${tag(items[j].c)} centres ${Math.abs(mid(a) - mid(b)).toFixed(1)}px apart`);
      }
    }
    // A sticky Start button still in the window.
    const start = d.querySelector(".preflight-start");
    const startBottom = start ? Math.round(start.getBoundingClientRect().bottom) : null;
    if (snap) {
      // Every screenful of a page taller than the window, top to bottom.
      const theme = ALL_DARK || url.includes("dark=1") ? "dark" : "light";
      const vh = w2.innerHeight, pages = Math.min(6, Math.ceil(d.documentElement.scrollHeight / vh));
      for (let p = 0; p < pages; p++) {
        w2.scrollTo(0, p * vh); await sleep(150);
        await snap.postMessage({ name: `${name}${p ? `-p${p + 1}` : ""}-${W}x${H}-${theme}`, w: w || W, h: h || H });
      }
      w2.scrollTo(0, 0);
    }
    results.push({ name, viewport: [w2.innerWidth, w2.innerHeight], docH: d.documentElement.scrollHeight, hOverflow: d.documentElement.scrollWidth > w2.innerWidth, modals: d.querySelectorAll(".modal-panel").length, sizes, clipped, misaligned: [...new Set(misaligned)], startBottom });
  } catch (e) { results.push({ name, error: String(e) }); }
  frame.remove();
}
return JSON.stringify(results);

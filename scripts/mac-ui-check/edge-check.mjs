// The same layout check as check.sh, in headless Edge on Windows (Chromium, like WebView2):
//   node scripts/mac-ui-check/edge-check.mjs 920 760 light out.json
//   python scripts/mac-ui-check/assert.py out.json
// Needs the mock's Vite server on 1420 (npm run dev:ui) and Microsoft Edge. Run one at a time:
// Vite reloads the mock on any change under src/, which ends the run.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [width, height, theme, out] = process.argv.slice(2);
if (!out) {
  console.error("usage: node edge-check.mjs <width> <height> <light|dark> <out.json>");
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const states = readFileSync(join(here, "states.js"), "utf8");
const edge = process.env.EDGE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const port = 9570 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), "edge-check-"));
const browser = spawn(edge, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let target;
for (let i = 0; i < 100 && !target; i++) {
  await sleep(200);
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
  } catch {}
}
if (!target) {
  browser.kill();
  console.error("Edge did not start");
  process.exit(1);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => (ws.onopen = resolve));
let id = 0;
const pending = new Map();
ws.onmessage = (message) => {
  const msg = JSON.parse(message.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const i = ++id;
  pending.set(i, resolve);
  ws.send(JSON.stringify({ id: i, method, params }));
});
const evaluate = async (expression) => {
  const reply = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (reply.error) throw new Error(JSON.stringify(reply.error));
  if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 600));
  return reply.result?.result?.value;
};

let code = 0;
try {
  await send("Emulation.setDeviceMetricsOverride", { width: Math.max(Number(width), 940), height: Math.max(Number(height), 780), deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:1420/scripts/mac-ui-check/mock.html${theme === "dark" ? "?dark=1" : ""}` });
  for (let i = 0; i < 60 && !(await evaluate("!!document.querySelector('[data-tab=\"settings\"]')")); i++) await sleep(250);
  await sleep(800);
  await evaluate(`window.STATE_WIDTH = ${Number(width)}; window.STATE_HEIGHT = ${Number(height)}; 1`);
  const json = await evaluate(`(async () => { ${states} })()`);
  writeFileSync(out, json);
  console.log(`${JSON.parse(json).length} states at ${width}x${height} ${theme} -> ${out}`);
} catch (error) {
  console.error(`run ended early: ${error.message}`);
  code = 1;
} finally {
  ws.close();
  browser.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
process.exit(code);

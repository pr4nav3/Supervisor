import { invoke } from "@tauri-apps/api/core";
import type { AppRule, RuleEditor, RulesSaved } from "../core/types";
import { attr, errorText, escapeHtml } from "../core/dom";
import { appNames, setLastError, siteNames } from "../core/state";
import { render } from "../core/shell";
import { firstRunOpen, paintFirstRun } from "./firstRun";
import { paintPreflightLayer, preflightOpen } from "./preflight";
import { paintSessionRulesLayer, sessionRulesOpen } from "./session";

export let permanentRules: AppRule[] = [];
export function setPermanentRules(value: AppRule[]): void {
  permanentRules = value;
}
/** What each rule's chip says, by `ruleKey`. A website and an app with the same name are one chip. */
export let ruleNames: Record<string, string> = {};
export function setRuleNames(value: Record<string, string>): void {
  ruleNames = value;
}
export let ruleEditor: RuleEditor | null = null;
export function setRuleEditor(value: RuleEditor | null): void {
  ruleEditor = value;
}

/** The same rule, however it was typed: matching ignores case, so the chips must too. */
export function sameRule(a: AppRule, b: AppRule): boolean {
  return a.target === b.target && a.value.toLowerCase() === b.value.toLowerCase();
}

const ruleKey = (rule: AppRule) => `${rule.target}:${rule.value.toLowerCase()}`;

export function ruleName(rule: AppRule): string {
  return (
    ruleNames[ruleKey(rule)] ??
    (rule.target === "website" ? siteNames[rule.value] ?? rule.value : appNames[rule.value.toLowerCase()] ?? rule.value)
  );
}

/** One chip: the rules that share a name, newest first. Behind it, each rule still works alone. */
export interface Distraction {
  name: string;
  rules: AppRule[];
}

export function distractions(): Distraction[] {
  const groups = new Map<string, Distraction>();
  for (const rule of permanentRules.slice().reverse()) {
    const name = ruleName(rule);
    const group = groups.get(name.toLowerCase());
    if (group) {
      group.rules.push(rule);
    } else {
      groups.set(name.toLowerCase(), { name, rules: [rule] });
    }
  }
  return [...groups.values()];
}

const GLOBE_ICON = `<svg class="rule-icon" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" stroke-width="1.3"/><ellipse cx="6" cy="6" rx="2.2" ry="5" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M1 6h10" stroke="currentColor" stroke-width="1.1"/></svg>`;
const APP_ICON = `<svg class="rule-icon" viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="1.5" width="10" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M1 4.2h10" stroke="currentColor" stroke-width="1.3"/></svg>`;

/** A chip's name and what it covers: a globe for a website, a window for an app. */
export function chipContent(group: Distraction): string {
  const site = group.rules.some((rule) => rule.target === "website");
  const app = group.rules.some((rule) => rule.target === "app");
  const covers = site && app ? "Website and app" : site ? "Website" : "App";
  return `${escapeHtml(group.name)}<span class="rule-chip-kinds" role="img" aria-label="${covers}">${site ? GLOBE_ICON : ""}${app ? APP_ICON : ""}</span>`;
}

/** The one list. Chips open the editor; the same component serves Settings and the live dialog. */
export function renderRuleManager(title: string): string {
  const groups = distractions();
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
            groups.length === 0
              ? `<span class="no-session-rules">None yet. Add the sites and apps that pull you off task.</span>`
              : groups
                  .map(
                    (group, index) => `
                      <button class="rule-chip rule-chip-distracting" type="button" data-rule-action="edit" data-rule-index="${index}">${chipContent(group)}</button>
                    `,
                  )
                  .join("")
          }
        </div>
      </div>
    </div>
  `;
}

/** An address rather than a name: no spaces and a dot before a two-letter ending. */
function looksLikeAddress(text: string): boolean {
  return /^(https?:\/\/)?[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(text.trim());
}

/** Typing the name fills what Supervisor can guess. Each box follows the name until the user types
 *  in it; each part is turned on or off until the user clicks its button. A known site's name or an
 *  address turns Website on; App is on for a name that isn't a known site, or for an app already
 *  seen on this computer. */
function fillFromName(editor: RuleEditor): void {
  const name = editor.name.trim();
  const lower = name.toLowerCase();
  const address = looksLikeAddress(name);
  const knownSite = Object.keys(siteNames).find((key) => siteNames[key].toLowerCase() === lower);
  const seenApp = Object.hasOwn(appNames, lower) || Object.values(appNames).some((app) => app.toLowerCase() === lower);
  const site = address ? name : knownSite ?? "";
  if (!editor.siteTouched) {
    editor.site = site;
  }
  if (!editor.siteOnTouched) {
    editor.siteOn = Boolean(site);
  }
  if (!editor.appTouched) {
    editor.app = address ? "" : name;
  }
  if (!editor.appOnTouched) {
    editor.appOn = Boolean(name) && !address && (!knownSite || seenApp);
  }
}

function appHint(editor: RuleEditor): string {
  const text = editor.app.trim();
  const lower = text.toLowerCase();
  const seen = Object.hasOwn(appNames, lower) || Object.values(appNames).some((app) => app.toLowerCase() === lower);
  // An app Supervisor hasn't seen is caught only by its exact name, and "Teams" isn't "Microsoft Teams".
  const like = !seen && text.length >= 3 ? Object.values(appNames).find((app) => app.toLowerCase().includes(lower)) : undefined;
  return like ? `Did you mean ${like}? Type its full name.` : "Type it as the app spells it on this computer.";
}

function renderRuleParts(editor: RuleEditor): string {
  const part = (kind: "site" | "app", on: boolean, icon: string, label: string, body: string) => `
    <div class="rule-part">
      <button class="rule-part-pick ${on ? "is-on" : ""}" type="button" data-rule-action="part" data-rule-part="${kind}" aria-pressed="${on}">${icon}${label}</button>
      <div class="rule-part-body">${body}</div>
    </div>`;
  return `
    ${part("site", editor.siteOn, GLOBE_ICON, "Website", `
      <input id="rule-site" maxlength="300" spellcheck="false" aria-label="Website address" value="${attr(editor.siteOn ? editor.site : "")}" placeholder="${editor.siteOn ? "Its address, like netflix.com" : "Click Website to block its site too"}" ${editor.siteOn ? "" : "disabled"} />
      ${editor.siteOn ? `<small class="rule-part-hint">Type the address exactly. One wrong letter and nothing gets blocked.</small>` : ""}`)}
    ${part("app", editor.appOn, APP_ICON, "App", `
      <input id="rule-app" maxlength="60" spellcheck="false" aria-label="App name" value="${attr(editor.appOn ? editor.app : "")}" placeholder="${editor.appOn ? "The app's name, like Spotify" : "Click App to block an app too"}" ${editor.appOn ? "" : "disabled"} />
      ${editor.appOn ? `<small class="rule-part-hint" id="rule-app-hint">${escapeHtml(appHint(editor))}</small>` : ""}`)}
    ${editor.error ? `<p class="rule-editor-error" role="alert">${escapeHtml(editor.error)}</p>` : ""}
  `;
}

export function renderRuleEditor(editor: RuleEditor): string {
  const editing = editor.group !== null;
  return `
    <form class="rule-editor" data-rule-form="rules" autocomplete="off">
      <label class="rule-name-field">
        <span>Name</span>
        <input id="rule-name" name="name" maxlength="60" spellcheck="false" value="${attr(editor.name)}" placeholder="Netflix, Steam or reddit.com" />
      </label>
      <div class="rule-parts" id="rule-parts">${renderRuleParts(editor)}</div>
      ${
        editing && editor.confirmDelete
          ? `<div class="rule-editor-actions">
              <span class="rule-editor-ask">Stop counting ${escapeHtml(editor.group!.name)} as a distraction?</span>
              <button class="danger" type="button" data-rule-action="delete">Delete</button>
              <button type="button" data-rule-action="keep">Keep it</button>
            </div>`
          : `<div class="rule-editor-actions">
              <button class="primary" type="submit">Save</button>
              ${editing ? `<button class="danger" type="button" data-rule-action="delete">Delete</button>` : ""}
              <button type="button" data-rule-action="cancel">Cancel</button>
            </div>`
      }
    </form>
  `;
}

/** Repaints the Website and App rows only, so the Name box keeps its cursor. */
export function paintRuleEditorLive(): void {
  const parts = document.getElementById("rule-parts");
  if (ruleEditor && parts) {
    parts.innerHTML = renderRuleParts(ruleEditor);
  }
}

/** Typing in the editor: the name fills the parts; a part typed in is the user's from then on. */
export function ruleEditorInput(input: HTMLInputElement): void {
  const editor = ruleEditor;
  if (!editor) {
    return;
  }
  editor.error = "";
  if (input.id === "rule-name") {
    editor.name = input.value;
    fillFromName(editor);
    paintRuleEditorLive();
  } else if (input.id === "rule-site") {
    editor.site = input.value;
    editor.siteTouched = true;
  } else if (input.id === "rule-app") {
    editor.app = input.value;
    editor.appTouched = true;
    const hint = document.getElementById("rule-app-hint");
    if (hint) {
      hint.textContent = appHint(editor);
    }
  }
}

/** The rule editor shows on the start screen, in the session's distractions box, or in Settings. */
export function paintRuleEditorHost(): void {
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

/** The website and app rows a chip stands for: its first website and its first app. */
function groupParts(group: Distraction): { site?: AppRule; app?: AppRule } {
  return {
    site: group.rules.find((rule) => rule.target === "website"),
    app: group.rules.find((rule) => rule.target === "app"),
  };
}

export async function handleRuleAction(button: HTMLButtonElement): Promise<void> {
  const action = button.dataset.ruleAction;
  if (!action) {
    return;
  }

  if (action === "add") {
    ruleEditor = {
      group: null, name: "", site: "", siteOn: false, siteTouched: false, siteOnTouched: false,
      app: "", appOn: false, appTouched: false, appOnTouched: false, error: "",
    };
    paintRuleEditorHost();
    document.getElementById("rule-name")?.focus();
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

  if (action === "part") {
    const editor = ruleEditor;
    if (!editor) {
      return;
    }
    editor.error = "";
    if (button.dataset.rulePart === "site") {
      editor.siteOn = !editor.siteOn;
      editor.siteOnTouched = true;
    } else {
      editor.appOn = !editor.appOn;
      editor.appOnTouched = true;
    }
    paintRuleEditorLive();
    const turnedOn = button.dataset.rulePart === "site" ? editor.siteOn : editor.appOn;
    if (turnedOn) {
      document.getElementById(button.dataset.rulePart === "site" ? "rule-site" : "rule-app")?.focus();
    }
    return;
  }

  if (action === "edit") {
    const group = distractions()[Number(button.dataset.ruleIndex)];
    if (!group) {
      return;
    }
    const { site, app } = groupParts(group);
    ruleEditor = {
      group,
      name: group.name,
      site: site?.value ?? "",
      siteOn: Boolean(site),
      siteTouched: true,
      siteOnTouched: true,
      app: app ? appNames[app.value.toLowerCase()] ?? app.value : "",
      appOn: Boolean(app),
      appTouched: true,
      appOnTouched: true,
      error: "",
    };
    paintRuleEditorHost();
    return;
  }

  if (action === "delete") {
    const editor = ruleEditor;
    if (!editor?.group) {
      return;
    }
    // The first press asks; the second, on the question, deletes.
    if (!editor.confirmDelete) {
      editor.confirmDelete = true;
      paintRuleEditorHost();
      return;
    }
    const gone = new Set(editor.group.rules.map(ruleKey));
    ruleEditor = null;
    await saveRules(permanentRules.filter((rule) => !gone.has(ruleKey(rule))), {});
  }
}

function showEditorError(editor: RuleEditor, message: string): void {
  if (ruleEditor === editor) {
    editor.error = message;
    paintRuleEditorLive();
  }
}

export async function saveRuleForm(): Promise<void> {
  const editor = ruleEditor;
  if (!editor) {
    return;
  }
  if (!editor.siteOn && !editor.appOn) {
    showEditorError(editor, "Turn on Website, App or both.");
    return;
  }
  let site: AppRule | null = null;
  let app: AppRule | null = null;
  try {
    if (editor.siteOn) {
      const text = editor.site.trim();
      if (!text) {
        showEditorError(editor, "Type the website's address, like netflix.com.");
        return;
      }
      site = await invoke<AppRule>("resolve_rule_input", { text });
      if (site.target !== "website") {
        showEditorError(editor, "That isn't a website address. Type one like netflix.com.");
        return;
      }
    }
    if (editor.appOn) {
      const text = editor.app.trim();
      if (!text) {
        showEditorError(editor, "Type the app's name, like Spotify.");
        return;
      }
      app = await invoke<AppRule>("resolve_app_input", { text });
    }
  } catch (error) {
    showEditorError(editor, errorText(error));
    return;
  }
  if (ruleEditor !== editor) {
    return;
  }

  // The chip's name: what was typed, unless that was the address itself; then the site's own name.
  const typed = editor.name.trim();
  const name =
    typed && !looksLikeAddress(typed)
      ? typed
      : site
        ? siteNames[site.value] ?? site.value
        : appNames[app!.value.toLowerCase()] ?? app!.value;
  const added = [site, app].filter((rule): rule is AppRule => rule !== null);
  const addedKeys = new Set(added.map(ruleKey));
  // Editing replaces the website and app the chip showed, in their place, so the chip stays where
  // it was; anything else under its name stays too. A new chip goes at the front (the list's end).
  const replaced = new Set(
    editor.group ? Object.values(groupParts(editor.group)).filter((rule): rule is AppRule => Boolean(rule)).map(ruleKey) : [],
  );
  const kept = permanentRules.filter((rule) => !replaced.has(ruleKey(rule)) && !addedKeys.has(ruleKey(rule)));
  const firstReplaced = permanentRules.findIndex((rule) => replaced.has(ruleKey(rule)));
  const at = firstReplaced < 0 ? 0 : permanentRules.slice(0, firstReplaced).filter((rule) => !replaced.has(ruleKey(rule)) && !addedKeys.has(ruleKey(rule))).length;
  const rules = [...kept.slice(0, at), ...added, ...kept.slice(at)];
  ruleEditor = null;
  await saveRules(rules, Object.fromEntries(added.map((rule) => [ruleKey(rule), name])));
}

/** Saves the list, then the chip names: `named` sets names for those rules, and a name whose rule
 *  is gone is dropped. */
async function saveRules(next: AppRule[], named: Record<string, string>): Promise<void> {
  const previous = cloneRules(permanentRules);
  permanentRules = next;
  if (!(await persistPermanentRuleChanges(previous))) {
    return;
  }
  const kept = new Set(permanentRules.map(ruleKey));
  const names = Object.fromEntries(
    Object.entries({ ...ruleNames, ...named }).filter(([key]) => kept.has(key)),
  );
  try {
    ruleNames = await invoke<Record<string, string>>("set_rule_names", { names });
  } catch (error) {
    setLastError(errorText(error));
  }
  render();
}

/** Whether the list saved. On a failure the old list is back and the error is showing. */
async function persistPermanentRuleChanges(previous: AppRule[]): Promise<boolean> {
  try {
    // The timer window can add rules behind this window's back: anything in the backend's fresh
    // list that this window never had joins the list (at the front, as the newest), and this
    // window's own order, with its edit applied, is kept.
    const before = new Set(previous.map(ruleKey));
    const after = new Set(permanentRules.map(ruleKey));
    const fresh = await invoke<AppRule[]>("get_rules");
    const concurrent = fresh.filter((rule) => !before.has(ruleKey(rule)) && !after.has(ruleKey(rule)));
    const rules = [...concurrent, ...permanentRules];
    const saved = await invoke<RulesSaved>("update_rules", { rules });
    permanentRules = saved.rules;
    setLastError("");
    render();
    return true;
  } catch (error) {
    permanentRules = previous;
    setLastError(errorText(error));
    render();
    return false;
  }
}

export function cloneRules(rules: AppRule[]): AppRule[] {
  return rules.map((rule) => ({ ...rule }));
}

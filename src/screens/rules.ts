import { invoke } from "@tauri-apps/api/core";
import type { AppRule, RuleEditor, RulePreview, RulesSaved } from "../core/types";
import { paintSessionRulesLayer, sessionRulesOpen } from "../main";
import { attr, errorText, escapeHtml, formValue, showFeedback } from "../core/dom";
import { appNames, setLastError, setSiteNames, siteNames } from "../core/state";
import { render } from "../core/shell";
import { firstRunOpen, paintFirstRun } from "./firstRun";
import { paintPreflightLayer, preflightOpen } from "./preflight";

export let permanentRules: AppRule[] = [];
export function setPermanentRules(value: AppRule[]): void {
  permanentRules = value;
}
export let ruleEditor: RuleEditor | null = null;
export function setRuleEditor(value: RuleEditor | null): void {
  ruleEditor = value;
}
let rulePreviewTimer: number | undefined;

/** The same rule, however it was typed: matching ignores case, so the chips must too. */
export function sameRule(a: AppRule, b: AppRule): boolean {
  return a.target === b.target && a.value.toLowerCase() === b.value.toLowerCase();
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

export function renderRulePreview(editor: RuleEditor): string {
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

export function renderRuleEditor(editor: RuleEditor): string {
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

export async function handleRuleAction(button: HTMLButtonElement): Promise<void> {
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

export async function saveRuleForm(form: HTMLFormElement): Promise<void> {
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

export function scheduleRulePreview(delay = 140): void {
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

export function paintRuleEditorLive(): void {
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

export function cloneRules(rules: AppRule[]): AppRule[] {
  return rules.map((rule) => ({ ...rule }));
}

import starterLines from "../../scripts/starter_lines.json";
import { invoke } from "@tauri-apps/api/core";
import type {
  ClipQueue, PhraseDefinition, PhraseEditor, PhraseLibraryState, PhraseMoment, VoiceOption,
  VoiceProfileSummary, VoiceTone,
} from "../core/types";
import {
  bumpClipAsset, canEditPhrases, cleanSlug, clipBelongsToPhrase, clipForPhrase, clipForPhraseId,
  clipGenerateLockTitle, clipsVoice, dismissVoiceInfo, isCustomTone, MINI_ORB, momentPhrases,
  paintVoiceLayer, pickVoice, pickWhenReady, profileToneReady, refreshVoiceStatus,
  releaseVoiceWorker, renameVoice, renderVoiceGapNotice, runVoiceBusy, sameTone, setPickWhenReady,
  setVoiceError, stopClip, stopVoicePreview, tonePhrases, upsertProfile, voiceBackend, voiceBusy,
  voiceError, voiceTone,
} from "../main";
import { formatQueueTime } from "../core/format";
import { appView, attr, composing, errorText, escapeHtml, modal, showFeedback } from "../core/dom";
import { activeTab, settingsView } from "../core/state";
import { editorIsOpen, paintSlot, render } from "../core/shell";

/** Every personality has lines for each moment. The two that repeat all session want a few. */
export const MOMENTS: { id: PhraseMoment; label: string; when: string; often: boolean }[] = [
  { id: "nudge", label: "Back to work", when: "When you get distracted", often: true },
  { id: "phone", label: "Phone down", when: "When the camera sees your phone or watch", often: true },
  { id: "roundover", label: "Take a break", when: "When a Pomodoro round ends", often: false },
  { id: "sessionover", label: "Session done", when: "When a session ends", often: false },
];
export const toneOrder: VoiceTone[] = ["gentle", "mom", "genz", "stern"];

export const phraseBank = starterLines.phrases as PhraseDefinition[];
let customPhrases: PhraseDefinition[] = [];
export function setCustomPhrases(value: PhraseDefinition[]): void {
  customPhrases = value;
}
let customPhraseSets: string[] = [];
export function setCustomPhraseSets(value: string[]): void {
  customPhraseSets = value;
}
let phraseOverrides: Record<string, PhraseDefinition> = {};
export function setPhraseOverrides(value: Record<string, PhraseDefinition>): void {
  phraseOverrides = value;
}
export let phraseEditor: PhraseEditor | null = null;
export function setPhraseEditor(value: PhraseEditor | null): void {
  phraseEditor = value;
}
let hiddenPhrases = new Set<string>();
export function setHiddenPhrases(value: Set<string>): void {
  hiddenPhrases = value;
}
/** The personality forms under the cards: a rename, a delete awaiting its confirm, a new name. */
export let toneRename: { from: VoiceTone; value: string } | null = null;
export let toneDeleteArmed: VoiceTone | null = null;
export let newToneDraft: string | null = null;
export function setNewToneDraft(value: string | null): void {
  newToneDraft = value;
}
/** The ⋯ menu on your own personality's card: Rename and Delete. */
export let toneMenuOpen = false;
export let clipQueue: ClipQueue | null = null;
let clipQueueTicker: number | undefined;
/** A one-line job started from the line popup reopens that line when its clip lands. */
let reopenLineAfterQueue: string | null = null;

/** The first clip waits for the worker to load the model and the voice (about 90 s on a typical
 *  laptop); the worker stays loaded, so each later clip takes seconds (3-6 s measured on a Mac
 *  and a Windows laptop). Both rounded up, so the estimate is never the slow surprise. */
export const FIRST_CLIP_SECONDS = 90;
export const NEXT_CLIP_SECONDS = 15;

/** How long `count` clips take when `started` of the queue are already done. */
function clipQueueSeconds(count: number, started = 0): number {
  if (count <= 0) {
    return 0;
  }
  return started === 0 ? FIRST_CLIP_SECONDS + (count - 1) * NEXT_CLIP_SECONDS : count * NEXT_CLIP_SECONDS;
}

/** Redraws the personality and lines panels alone, so the voices, the tiles and the page scroll
 *  stay put. */
export function paintClipsPanel(): void {
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
export function bindClipsControls(root: ParentNode): void {
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
export function bindPhraseEditor(root: ParentNode): void {
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

/** "Derek speaks like Mom": the personality cards, then that personality's lines by moment. */
export function renderVoiceLinesArea(): string {
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
export function renderNewPersonalityModal(): string {
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
export function renderLinePopup(): string {
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

export function closeToneForms(): void {
  toneRename = null;
  toneDeleteArmed = null;
  newToneDraft = null;
  toneMenuOpen = false;
}

// A click anywhere but the ⋯ menu closes it.
window.addEventListener("pointerdown", (event) => {
  if (toneMenuOpen && !(event.target as Element | null)?.closest(".personality-own")) {
    toneMenuOpen = false;
    paintClipsPanel();
  }
});

export function leaveVoiceScreen(): void {
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
    setVoiceError("");
    return true;
  } catch (error) {
    setVoiceError(errorText(error));
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
        setVoiceError(`Could not remove the old audio of this line: ${errorText(error)}`);
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

/** Cancel was pressed: the line in flight was abandoned, so its error is not one to show. */
let clipQueueCancelled = false;

/** A failed line stays on screen until the user moves on; the next action clears it. */
export function clearFailedQueue(): void {
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
      setPickWhenReady(null);
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

async function setVoiceTone(voice: VoiceOption, tone: VoiceTone): Promise<void> {
  const profile = voice.profile;
  if (!profile) {
    return;
  }
  try {
    const saved = await invoke<VoiceProfileSummary>("set_voice_tone", { profileId: profile.profile_id, tone });
    upsertProfile(saved);
    setVoiceError("");
    showFeedback(
      profileToneReady(saved)
        ? `${voice.name} speaks like ${toneLabel(tone)}`
        : `${voice.name} speaks like ${toneLabel(tone)}. Generate the lines below to hear ${voice.name}.`,
    );
  } catch (error) {
    setVoiceError(errorText(error));
  }
  // The voice cards say who speaks like what, so the page redraws.
  render();
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
        setVoiceError(errorText(error));
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
export function phraseToneOrder(): VoiceTone[] {
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

export function effectivePhrases(): PhraseDefinition[] {
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

export function toneLabel(tone: VoiceTone): string {
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

export async function linesAction(action: string, source?: HTMLElement): Promise<void> {
  if (action === "use-tone") {
    const tone = source?.dataset.tone;
    if (tone) {
      clearFailedQueue();
      closeToneForms();
      await setVoiceTone(clipsVoice(), tone);
    }
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

  if (action === "cancel-phrase-editor") {
    phraseEditor = null;
    paintVoiceLayer();
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
}

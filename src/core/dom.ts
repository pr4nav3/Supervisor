import type { AppView } from "./types";

export const app = document.querySelector<HTMLDivElement>("#app")!;
export const appView: AppView = new URLSearchParams(window.location.search).get("view") === "overlay" ? "overlay" : "main";
document.body.classList.toggle("overlay-view", appView === "overlay");
// Made once and kept: a live region must already be in the page when its text changes, or
// screen readers skip the announcement. Empty, it draws nothing (styles.css).
const feedbackToast = document.createElement("div");
feedbackToast.className = "feedback-toast";
feedbackToast.setAttribute("role", "status");
document.body.appendChild(feedbackToast);
let feedbackTimer: number | undefined;

/** A popup: the backdrop, and the dialog named by its title. */
export function modal(cls: string, titleId: string, inner: string): string {
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="modal-panel ${cls}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">${inner}</section>
    </div>
  `;
}

/** A yes-or-no popup whose red button goes ahead. `body` is markup. */
export function confirmModal(titleId: string, eyebrow: string, title: string, body: string, cancel: [string, string], confirm: [string, string]): string {
  return modal("confirm-panel", titleId, `
        <div class="modal-head">
          <div>
            <p class="eyebrow">${eyebrow}</p>
            <h2 id="${titleId}">${escapeHtml(title)}</h2>
          </div>
        </div>
        ${body}
        <div class="modal-actions">
          <button type="button" data-action="${cancel[0]}">${escapeHtml(cancel[1])}</button>
          <button class="danger" type="button" data-action="${confirm[0]}">${escapeHtml(confirm[1])}</button>
        </div>
      `);
}

/** Whether a mouse or pen is held down, so a rebuild can wait for its click. */
let pointerHeld = false;
window.addEventListener("pointerdown", () => (pointerHeld = true), true);
window.addEventListener("pointerup", () => (pointerHeld = false), true);
window.addEventListener("pointercancel", () => (pointerHeld = false), true);

/**
 * Runs `paint` now, or once the held pointer is released and its click has landed. A field's blur
 * fires on the press, so a rebuild it starts would replace the button before the release and
 * swallow the click.
 */
export function afterPointer(paint: () => void): void {
  if (!pointerHeld) {
    paint();
    return;
  }
  const release = () => {
    window.removeEventListener("pointerup", release);
    window.removeEventListener("pointercancel", release);
    window.setTimeout(paint);
  };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
}

export function showFeedback(message: string, durationMs = 1400): void {
  feedbackToast.textContent = message;

  clearTimeout(feedbackTimer);
  feedbackTimer = window.setTimeout(() => {
    feedbackToast.textContent = "";
  }, durationMs);
}

export function formValue(form: HTMLFormElement, name: string): string {
  const field = form.elements.namedItem(name);
  if (
    field instanceof HTMLInputElement ||
    field instanceof HTMLSelectElement ||
    field instanceof HTMLTextAreaElement
  ) {
    return field.value;
  }
  return "";
}

/** The Enter that confirms Japanese or Chinese input is not a submit. WebKit reports it
 *  with isComposing false, so keyCode 229 (an IME key) is checked too. */
export function composing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

export function label(value: string): string {
  return value.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

export const attr = escapeHtml;

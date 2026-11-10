import { invoke } from "@tauri-apps/api/core";
import type { SessionSnapshot } from "./types";
import { appView, errorText } from "./dom";
import { setLastError, snapshot } from "./state";
import type * as Main from "../main";

/** What lives in main.ts but other modules call: main hands these over once, at load. */
export let applySnapshot: typeof Main.applySnapshot;
export let bindEvents: typeof Main.bindEvents;
export let refreshSnapshotNow: typeof Main.refreshSnapshotNow;
export let render: typeof Main.render;
export let runAction: typeof Main.runAction;

export function wire(parts: Pick<typeof Main, "applySnapshot" | "bindEvents" | "refreshSnapshotNow" | "render" | "runAction">): void {
  ({ applySnapshot, bindEvents, refreshSnapshotNow, render, runAction } = parts);
}

let pollId: number | null = null;
let snapshotInFlight = false;

export async function refreshSnapshot(): Promise<void> {
  // A slow tick must not be overtaken by the next one and then land its older snapshot.
  if (snapshotInFlight) {
    return;
  }
  snapshotInFlight = true;
  try {
    await refreshSnapshotNow();
  } finally {
    snapshotInFlight = false;
  }
}

const PRESERVE_SCROLL = [".voice-list", ".modal-panel"] as const;

export function captureUiState(): {
  winX: number;
  winY: number;
  scrolls: Array<[number, number]>;
  focusId: string;
  start: number | null;
  end: number | null;
} {
  const active = document.activeElement as HTMLInputElement | null;
  return {
    winX: window.scrollX,
    winY: window.scrollY,
    scrolls: PRESERVE_SCROLL.map((sel) => {
      const el = document.querySelector<HTMLElement>(sel);
      return el ? [el.scrollLeft, el.scrollTop] : [0, 0];
    }),
    focusId: active?.id ?? "",
    start: active?.selectionStart ?? null,
    end: active?.selectionEnd ?? null,
  };
}

export function restoreUiState(state: ReturnType<typeof captureUiState>): void {
  PRESERVE_SCROLL.forEach((sel, i) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) {
      el.scrollLeft = state.scrolls[i][0];
      el.scrollTop = state.scrolls[i][1];
    }
  });
  window.scrollTo(state.winX, state.winY);
  if (!state.focusId) {
    return;
  }
  const el = document.getElementById(state.focusId) as HTMLInputElement | null;
  if (!el) {
    return;
  }
  el.focus();
  if (state.start === null) {
    return;
  }
  try {
    el.setSelectionRange(state.start, state.end ?? state.start);
  } catch {
    // not a text field
  }
}

/**
 * Redraws one slot and wires it with the same bindEvents a full render uses; the rest of the page
 * stays as it is (its animations, hover and focus). A slot that isn't on the page has nothing to
 * redraw: the next full render draws it from the same state.
 */
export function paintSlot(id: string, html: string): HTMLElement | null {
  const slot = document.getElementById(id);
  if (!slot) {
    return null;
  }
  const ui = captureUiState();
  slot.innerHTML = html;
  bindEvents(slot);
  restoreUiState(ui);
  return slot;
}

export async function invokeSnapshot(command: string, args?: Record<string, unknown>, paint = true): Promise<boolean> {
  try {
    const next = await invoke<SessionSnapshot>(command, args);
    setLastError("");
    if (applySnapshot(next)) {
      return true;
    }
  } catch (error) {
    setLastError(errorText(error));
    render();
    reconcilePolling();
    return false;
  }

  if (paint) {
    render();
  }
  reconcilePolling();
  return true;
}

export function reconcilePolling(): void {
  const shouldPoll = appView === "overlay" || snapshot?.current !== null;
  if (shouldPoll && pollId === null) {
    pollId = window.setInterval(refreshSnapshot, 1000);
  } else if (!shouldPoll && pollId !== null) {
    window.clearInterval(pollId);
    pollId = null;
  }
}

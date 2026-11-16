"use client";

import { readState, writeState } from "./state-transport";
import { isPreferenceKey } from "../shared/preferences";

// Opaque WebViews use a backend mirror for font and shortcut preferences only.
const values = new Map<string, string>();
let pending = new Map<string, string | null>();
let execution = "";
let initialized = false;
let version = 0;
let savedVersion = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let flushing = false;
let failed = false;
const listeners = new Set<() => void>();
const publish = () => {
  for (const listener of listeners) listener();
};
const schedule = () => {
  timer ??= setTimeout(() => {
    timer = undefined;
    void flushState();
  }, 250);
};
function changed() {
  if (!initialized || failed) throw new Error("Terminal state is unavailable");
  version++;
  schedule();
}
export const backendStorage: Storage = {
  get length() {
    return values.size;
  },
  key(index) {
    return [...values.keys()][index] ?? null;
  },
  getItem(key) {
    return values.get(key) ?? null;
  },
  setItem(key, value) {
    if (!isPreferenceKey(key)) throw new Error("Unsupported preference");
    changed();
    values.set(key, value);
    pending.set(key, value);
  },
  removeItem(key) {
    if (!isPreferenceKey(key)) throw new Error("Unsupported preference");
    changed();
    values.delete(key);
    pending.set(key, null);
  },
  clear() {
    changed();
    for (const key of values.keys()) pending.set(key, null);
    values.clear();
  },
};
export const subscribeState = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const stateFailed = () => failed;
export async function loadState() {
  if (initialized) return;
  const state = await readState();
  execution = state.execution;
  values.clear();
  for (const [key, value] of Object.entries(state.values)) {
    if (isPreferenceKey(key)) values.set(key, value);
  }
  // Earlier browser versions could store recovery data locally. Remove only
  // those obsolete records; opaque views may reject browser storage entirely.
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try {
      const storage = window[name];
      for (let index = storage.length - 1; index >= 0; index--) {
        const key = storage.key(index);
        if (key?.startsWith("wterm.local.recovery.")) storage.removeItem(key);
      }
    } catch { /* Browser storage is optional. */ }
  }
  initialized = true;
}
export async function flushState() {
  if (flushing || failed || !initialized || savedVersion === version) return;
  flushing = true;
  const revision = version;
  const changes = pending;
  pending = new Map();
  try {
    await writeState(execution, changes);
    savedVersion = revision;
  } catch {
    failed = true;
    publish();
  } finally {
    flushing = false;
    if (!failed && savedVersion !== version) schedule();
  }
}

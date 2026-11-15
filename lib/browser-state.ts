"use client";

import { getAppClient } from "./app-client";

// Opaque WebViews cannot use browser storage. Keep a mirror of one backend snapshot.
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
const publish = () => { for (const listener of listeners) listener(); };
const schedule = () => { timer ??= setTimeout(() => { timer = undefined; void flushState(); }, 250); };
function changed() {
  if (!initialized || failed) throw new Error("Terminal state is unavailable");
  version++;
  schedule();
}
export const backendStorage: Storage = {
  get length() { return values.size; },
  key(index) { return [...values.keys()][index] ?? null; },
  getItem(key) { return values.get(key) ?? null; },
  setItem(key, value) {
    changed();
    values.set(key, value);
    pending.set(key, value);
  },
  removeItem(key) { changed(); values.delete(key); pending.set(key, null); },
  clear() { changed(); for (const key of values.keys()) pending.set(key, null); values.clear(); },
};
export function executionId() { return execution; }
export const subscribeState = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const stateFailed = () => failed;
export async function loadState() {
  if (initialized) return;
  const app = await getAppClient();
  const response = await fetch(app.url("state"), { credentials: "omit", cache: "no-store" });
  if (!response.ok) throw new Error("Cannot load Terminal state");
  const state = await response.json();
  if (typeof state.execution !== "string" || !state.values || typeof state.values !== "object" || Array.isArray(state.values) || Object.values(state.values).some((value) => typeof value !== "string")) throw new Error("Invalid Terminal state");
  execution = state.execution;
  values.clear();
  for (const [key, value] of Object.entries(state.values)) values.set(key, value as string);
  initialized = true;
}
export async function flushState() {
  if (flushing || failed || !initialized || savedVersion === version) return;
  flushing = true;
  const revision = version;
  const changes = pending;
  pending = new Map();
  try {
    const app = await getAppClient();
    const response = await fetch(app.url("state"), {
      method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ execution, changes: Object.fromEntries(changes) }),
    });
    if (!response.ok) throw new Error();
    savedVersion = revision;
  } catch { failed = true; publish(); }
  finally { flushing = false; if (!failed && savedVersion !== version) schedule(); }
}

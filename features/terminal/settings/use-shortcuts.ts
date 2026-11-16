"use client";

import { useState, useSyncExternalStore } from "react";
import { backendStorage } from "@/client/state";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUTS_KEY,
  readShortcuts,
  type Shortcuts,
} from "./shortcuts";

function createShortcutStore() {
  type Snapshot = { shortcuts: Shortcuts; saved: boolean };
  let snapshot: Snapshot | null = null;
  const listeners = new Set<() => void>();
  const getSnapshot = (): Snapshot => {
    if (snapshot) return snapshot;
    let shortcuts = DEFAULT_SHORTCUTS,
      saved = true;
    try {
      shortcuts = readShortcuts(backendStorage.getItem(SHORTCUTS_KEY));
    } catch {
      saved = false;
    }
    return (snapshot = { shortcuts, saved });
  };
  const publish = (shortcuts: Shortcuts, saved: boolean) => {
    snapshot = { shortcuts, saved };
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      getSnapshot();
      return () => {
        listeners.delete(listener);
      };
    },
    update(shortcuts: Shortcuts) {
      let saved = true;
      try {
        backendStorage.setItem(SHORTCUTS_KEY, JSON.stringify(shortcuts));
      } catch {
        saved = false;
      }
      publish(shortcuts, saved);
    },
  };
}
const serverSnapshot = () => null;
export function useShortcuts() {
  const [store] = useState(createShortcutStore);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    serverSnapshot,
  );
  return {
    shortcuts: snapshot?.shortcuts ?? DEFAULT_SHORTCUTS,
    saved: snapshot?.saved ?? true,
    update: store.update,
  };
}

"use client";

import { useState, useSyncExternalStore } from "react";
import { backendStorage } from "@/client/state";
import {
  APPEARANCE_KEY,
  DEFAULT_APPEARANCE,
  readAppearance,
  type Appearance,
} from "./appearance";

function createAppearanceStore() {
  type Snapshot = {
    appearance: Appearance;
    saved: boolean;
  };
  let snapshot: Snapshot | null = null;
  const listeners = new Set<() => void>();
  const getSnapshot = (): Snapshot => {
    if (snapshot) return snapshot;
    let appearance = { ...DEFAULT_APPEARANCE };
    let saved = true;
    try {
      appearance = readAppearance(backendStorage.getItem(APPEARANCE_KEY));
    } catch {
      saved = false;
    }
    return (snapshot = { appearance, saved });
  };
  const publish = (appearance: Appearance, saved: boolean) => {
    snapshot = { appearance, saved };
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    update(appearance: Appearance) {
      let saved = true;
      try {
        backendStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
      } catch {
        saved = false;
      }
      publish(appearance, saved);
    },
  };
}
const serverSnapshot = () => null;
export function useAppearance() {
  const [store] = useState(createAppearanceStore);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    serverSnapshot,
  );
  return {
    appearance: snapshot?.appearance ?? DEFAULT_APPEARANCE,
    saved: snapshot?.saved ?? true,
    ready: snapshot !== null,
    update: store.update,
  };
}

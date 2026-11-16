"use client";

import type { Theme } from "@pioneercompany/app-sdk/client";
import { getAppClient } from "./pioneer";

let snapshot: Readonly<Theme> | null = null;
const listeners = new Set<() => void>();
export const hostTheme = () => snapshot;
export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// SDK owns source checks and palette validation. The application owns rendering.
if (typeof window !== "undefined") {
  void getAppClient().then(app => app.theme.subscribe(value => {
    snapshot = value;
    for (const listener of listeners) listener();
  })).catch(() => {}); // loadState reports client initialization failure.
}

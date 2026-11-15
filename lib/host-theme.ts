"use client";

import type { CSSProperties } from "react";
import type { Theme } from "@pioneercompany/app-sdk/client";
import { getAppClient } from "./app-client";
let palette: Readonly<Theme> | null = null;
const listeners = new Set<() => void>();
export const hostPalette = () => palette;
export const subscribeTheme = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function workspaceColors(): CSSProperties | undefined {
  if (!palette) return;
  return {
    "--workspace-bg": palette.background, "--workspace-sidebar": palette.background,
    "--workspace-panel": palette.background, "--workspace-fg": palette.foreground,
    "--workspace-muted": palette.muted, "--workspace-border": palette.border,
    "--workspace-focus": palette.accent,
  } as CSSProperties;
}

// Retain only the application store; source checks and palette validation are
// SDK responsibilities. React applies colors after the workspace mounts.
if (typeof window !== "undefined") {
  void getAppClient().then(app => app.theme.subscribe(value => {
    palette = value;
    for (const listener of listeners) listener();
  })).catch(() => {}); // loadState reports client initialization failure.
}

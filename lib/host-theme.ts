"use client";

import type { CSSProperties } from "react";
type Palette = Record<"background" | "foreground" | "muted" | "border" | "accent" | "accent-foreground", string> & { appearance: "dark" | "light" };
let palette: Palette | null = null;
const listeners = new Set<() => void>();
export const hostPalette = () => palette;
export const subscribeTheme = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function listenHostTheme() {
  const receive = (event: MessageEvent) => {
    if (event.data?.type !== "pioneer.theme") return;
    if (window.parent === window) {
      // Direct dev views receive the shell's message in their own window.
      if (process.env.NODE_ENV !== "development" || event.source !== window || event.origin !== window.location.origin) return;
    } else if (event.source !== window.parent) return;
    const value = event.data.palette;
    if (!value || !["dark", "light"].includes(value.appearance)) return;
    for (const key of ["background", "foreground", "muted", "border", "accent", "accent-foreground"]) {
      if (typeof value[key] !== "string" || value[key].length > 128 || !CSS.supports("color", value[key])) return;
    }
    palette = value;
    for (const listener of listeners) listener();
  };
  window.addEventListener("message", receive);
  return () => window.removeEventListener("message", receive);
}
export function workspaceColors(): CSSProperties | undefined {
  if (!palette) return;
  return {
    "--workspace-bg": palette.background, "--workspace-sidebar": palette.background,
    "--workspace-panel": palette.background, "--workspace-fg": palette.foreground,
    "--workspace-muted": palette.muted, "--workspace-border": palette.border,
    "--workspace-focus": palette.accent,
  } as CSSProperties;
}

// This module is evaluated before hydration and the iframe load notification.
if (typeof window !== "undefined") listenHostTheme();

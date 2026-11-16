"use client";

import { useMemo, useSyncExternalStore, type CSSProperties } from "react";
import type { ThemeMode, ThemeColors } from "@pioneercompany/app-sdk/client";
import type { TerminalThemeColors } from "@wterm/core";
import { hostTheme, subscribeTheme } from "@/client/host-theme";

type AppColors = Pick<ThemeColors,
  "background" | "foreground" | "muted_foreground" | "border" | "ring" |
  "tab_bar" | "popover" | "list_hover" | "list_active" | "selection" |
  "overlay" | "caret" | "success" | "warning" | "danger" | "info" |
  "scrollbar" | "scrollbar_thumb" | "red" | "red_light" | "green" |
  "green_light" | "blue" | "blue_light" | "yellow" | "yellow_light" |
  "magenta" | "magenta_light" | "cyan" | "cyan_light"
>;

// Standalone browser defaults only. Managed views wait for the host snapshot,
// keeping the native boot surface until then. Host snapshots are never
// merged with this subset: all roles below read the complete native colors.
const FALLBACK: Record<ThemeMode, AppColors> = {
  dark: {
    background: "#0a0a0a", foreground: "#ededed", muted_foreground: "#aaaaaa",
    border: "#333333", ring: "#aaaaaa", tab_bar: "#0a0a0a", popover: "#111111",
    list_hover: "#242424", list_active: "#363636", selection: "#4488ff55",
    overlay: "#000000b3", caret: "#ededed", success: "#34d399", warning: "#f5a623",
    danger: "#f87171", info: "#60a5fa", scrollbar: "#00000000", scrollbar_thumb: "#aaaaaa66",
    red: "#f44747", red_light: "#f87171", green: "#6a9955", green_light: "#86efac",
    blue: "#569cd6", blue_light: "#93c5fd", yellow: "#d7ba7d", yellow_light: "#fde68a",
    magenta: "#c586c0", magenta_light: "#e9d5ff", cyan: "#4ec9b0", cyan_light: "#a5f3fc",
  },
  light: {
    background: "#ffffff", foreground: "#171717", muted_foreground: "#595959",
    border: "#c8c8c8", ring: "#525252", tab_bar: "#f3f3f3", popover: "#ffffff",
    list_hover: "#e8e8e8", list_active: "#dcdcdc", selection: "#3366ff44",
    overlay: "#00000080", caret: "#171717", success: "#087f5b", warning: "#946000",
    danger: "#b91c1c", info: "#2563eb", scrollbar: "#00000000", scrollbar_thumb: "#59595966",
    red: "#e45649", red_light: "#dc2626", green: "#50a14f", green_light: "#15803d",
    blue: "#4078f2", blue_light: "#2563eb", yellow: "#c18401", yellow_light: "#a16207",
    magenta: "#a626a4", magenta_light: "#9333ea", cyan: "#0184bc", cyan_light: "#0891b2",
  },
};

export interface AppTheme {
  ready: boolean;
  appearance: ThemeMode;
  style: CSSProperties;
  terminal: TerminalThemeColors;
}

/** Native snapshots use #RRGGBBAA; Canvas handles other accepted CSS colors. */
function terminalColors(colors: AppColors, appearance: ThemeMode): TerminalThemeColors {
  const canvas = typeof document === "undefined" ? null : document.createElement("canvas");
  if (canvas) canvas.width = canvas.height = 1;
  const context = canvas?.getContext("2d", { willReadFrequently: true });
  const rgb = (color: string, background: number): number => {
    const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
    if (hex) {
      const value = Number.parseInt(hex[1], 16);
      const alpha = hex[2] ? Number.parseInt(hex[2], 16) / 255 : 1;
      const blend = (shift: number) => Math.round(((value >> shift) & 255) * alpha + ((background >> shift) & 255) * (1 - alpha));
      return (blend(16) << 16) | (blend(8) << 8) | blend(0);
    }
    if (!context) return background;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = `#${background.toString(16).padStart(6, "0")}`;
    context.fillRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return (r << 16) | (g << 8) | b;
  };
  const background = rgb(colors.background, appearance === "dark" ? 0 : 0xffffff);
  const foreground = rgb(colors.foreground, background);
  return {
    background, foreground, cursor: rgb(colors.caret, background),
    // ANSI colors are now the theme's complete base color family too.
    palette: [
      appearance === "dark" ? background : foreground,
      ...[colors.red, colors.green, colors.yellow, colors.blue, colors.magenta, colors.cyan].map(color => rgb(color, background)),
      foreground, rgb(colors.muted_foreground, background),
      ...[colors.red_light, colors.green_light, colors.yellow_light, colors.blue_light, colors.magenta_light, colors.cyan_light].map(color => rgb(color, background)),
      foreground,
    ],
  };
}

const serverTheme = () => null;
// SSR and hydration keep the CSS boot surface supplied by Desktop. Only a
// standalone browser uses OS defaults; managed views wait for the full theme.
const serverDark = () => null;
const prefersDark = () => {
  const managed = getComputedStyle(document.documentElement)
    .getPropertyValue("--pioneer-host-theme").trim() === "1";
  return managed ? null : matchMedia("(prefers-color-scheme: dark)").matches;
};
function subscribeSystemTheme(listener: () => void) {
  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

export function useAppTheme(): AppTheme {
  const host = useSyncExternalStore(subscribeTheme, hostTheme, serverTheme);
  const dark = useSyncExternalStore<boolean | null>(subscribeSystemTheme, prefersDark, serverDark);
  const ready = host !== null || dark !== null;
  const appearance = host?.mode ?? (dark ? "dark" : "light");
  const colors = host?.colors ?? FALLBACK[appearance];
  return useMemo(() => ({
    ready,
    appearance,
    terminal: terminalColors(colors, appearance),
    style: {
      colorScheme: appearance,
      ...(host ? { fontFamily: `${JSON.stringify(host.font_family)}, system-ui, sans-serif` } : {}),
      "--workspace-mono-font": host ? `${JSON.stringify(host.mono_font_family)}, ui-monospace, monospace` : 'ui-monospace, "SFMono-Regular", Consolas, monospace',
      "--workspace-bg": colors.background,
      "--workspace-sidebar": colors.tab_bar,
      "--workspace-panel": colors.popover,
      "--workspace-fg": colors.foreground,
      "--workspace-caret": colors.caret,
      "--workspace-muted": colors.muted_foreground,
      "--workspace-border": colors.border,
      "--workspace-focus": colors.ring,
      "--workspace-hover": colors.list_hover,
      "--workspace-selected": colors.list_active,
      "--workspace-selection": colors.selection,
      "--workspace-backdrop": colors.overlay,
      "--workspace-scrollbar": colors.scrollbar,
      "--workspace-scrollbar-thumb": colors.scrollbar_thumb,
      "--workspace-connected": colors.success,
      "--workspace-pending": colors.warning,
      "--workspace-danger": colors.danger,
      "--workspace-info": colors.info,
    } as CSSProperties,
  }), [host, colors, appearance, ready]);
}

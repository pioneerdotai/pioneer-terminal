import { THEME_COLOR_KEYS, type Theme, type ThemeColors, type ThemeMode } from "@pioneercompany/app-sdk/client";

/** A complete host frame; scenarios choose the roles whose rendering they assert. */
export function makeHostTheme(mode: ThemeMode, values: Partial<ThemeColors> = {}): Theme {
  const colors = {
    ...Object.fromEntries(THEME_COLOR_KEYS.map(key => [key, "#555555"])),
    background: mode === "dark" ? "#111111" : "#ffffff",
    foreground: mode === "dark" ? "#eeeeee" : "#111111",
    ...values,
  } as ThemeColors;
  return {
    mode, colors,
    light_theme: { name: "Fixture Light", mode: "light", colors: {}, highlight: null },
    dark_theme: { name: "Fixture Dark", mode: "dark", colors: {}, highlight: null },
    tokens: {}, semantic_tokens: {}, highlight_theme: {},
    font_family: "Fixture UI", font_size: 16,
    mono_font_family: "Fixture Mono", mono_font_size: 13,
    radius: 6, radius_lg: 8, window_radius: 0, shadow: true, focus_ring: true,
    transparent: "#00000000", scrollbar_mode: "Scrolling",
    list: { active_highlight: true }, sheet: { margin_top: 34 },
  };
}

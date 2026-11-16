export const APPEARANCE_KEY = "wterm.local.appearance.v1";
export const SHORTCUTS_KEY = "wterm.local.shortcuts.v1";

export function isPreferenceKey(key: string): boolean {
  return key === APPEARANCE_KEY || key === SHORTCUTS_KEY;
}

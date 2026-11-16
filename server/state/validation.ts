import { isPreferenceKey } from "../../shared/preferences";

export const STATE_LIMIT = 16 * 1024 * 1024;
export const REQUEST_LIMIT = 6 * 1024 * 1024;
export const STATE_FILE = "terminal-state.json";

export function validOwner(owner: string): boolean {
  return owner === "local-development" || /^[A-Za-z0-9]{21}$/.test(owner);
}

export function validateValues(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid state");
  const entries = Object.entries(value);
  if (
    entries.length > 34000 ||
    entries.some(([key, data]) =>
      key.length > 256 || !key.startsWith("wterm.") ||
      typeof data !== "string" || data.length > 35000
    )
  ) throw new Error("Invalid state");
  return Object.fromEntries(entries);
}

export function validateChanges(value: unknown): [string, string | null][] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid state changes");
  const entries = Object.entries(value);
  if (
    entries.length > 34000 ||
    entries.some(([key, data]) =>
      key.length > 256 || !isPreferenceKey(key) ||
      (data !== null && (typeof data !== "string" || data.length > 35000))
    )
  ) throw new Error("Invalid state changes");
  return entries as [string, string | null][];
}

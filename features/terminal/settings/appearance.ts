export { APPEARANCE_KEY } from "../../../shared/preferences";
export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 32;
export interface Appearance {
  fontSize: number;
}
export const DEFAULT_APPEARANCE: Appearance = { fontSize: 14 };

export function readAppearance(value: string | null): Appearance {
  try {
    const parsed: unknown = JSON.parse(value ?? "null");
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_APPEARANCE };
    const settings = parsed as Record<string, unknown>;
    return {
      fontSize:
        typeof settings.fontSize === "number" &&
        Number.isInteger(settings.fontSize) &&
        settings.fontSize >= MIN_FONT_SIZE &&
        settings.fontSize <= MAX_FONT_SIZE
          ? settings.fontSize
          : DEFAULT_APPEARANCE.fontSize,
    };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

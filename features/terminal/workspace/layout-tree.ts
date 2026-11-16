import type { Layout } from "./model";

export const pane = (session: string): Layout => ({ kind: "pane", session });

export function visibleSessions(layout: Layout | null): string[] {
  if (!layout) return [];
  return layout.kind === "pane"
    ? [layout.session]
    : [...visibleSessions(layout.first), ...visibleSessions(layout.second)];
}

export function replace(layout: Layout, id: string, replacement: Layout): Layout {
  if (layout.kind === "pane")
    return layout.session === id ? replacement : layout;
  return {
    ...layout,
    first: replace(layout.first, id, replacement),
    second: replace(layout.second, id, replacement),
  };
}
export function remove(layout: Layout | null, id: string): Layout | null {
  if (!layout) return null;
  if (layout.kind === "pane") return layout.session === id ? null : layout;
  const first = remove(layout.first, id);
  const second = remove(layout.second, id);
  return first && second ? { ...layout, first, second } : (first ?? second);
}
export function sibling(layout: Layout | null, id: string): string | null {
  if (!layout || layout.kind === "pane") return null;
  if (layout.first.kind === "pane" && layout.first.session === id)
    return visibleSessions(layout.second)[0];
  if (layout.second.kind === "pane" && layout.second.session === id)
    return visibleSessions(layout.first).at(-1) ?? null;
  return sibling(layout.first, id) ?? sibling(layout.second, id);
}
export function resize(layout: Layout, id: string, ratio: number): Layout {
  if (layout.kind === "pane") return layout;
  if (layout.id === id) return { ...layout, ratio };
  return {
    ...layout,
    first: resize(layout.first, id, ratio),
    second: resize(layout.second, id, ratio),
  };
}

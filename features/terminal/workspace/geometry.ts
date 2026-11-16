import {
  DIVIDER_SIZE,
  MIN_WIDTH,
  MIN_HEIGHT,
  type Layout,
  type SplitDirection,
} from "./model";
import { visibleSessions } from "./layout-tree";

export function minimumSize(layout: Layout | null): {
  width: number;
  height: number;
} {
  if (!layout || layout.kind === "pane")
    return { width: MIN_WIDTH, height: MIN_HEIGHT };
  const first = minimumSize(layout.first);
  const second = minimumSize(layout.second);
  return layout.direction === "right"
    ? {
        width: first.width + second.width + DIVIDER_SIZE,
        height: Math.max(first.height, second.height),
      }
    : {
        width: Math.max(first.width, second.width),
        height: first.height + second.height + DIVIDER_SIZE,
      };
}
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface Divider extends Rect {
  id: string;
  direction: SplitDirection;
  container: Rect;
  ratio: number;
  min: number;
  max: number;
  primary: string[];
}

/** Flatten geometry so React never reparents terminal instances when splits change. */
export function measureLayout(
  layout: Layout | null,
  width: number,
  height: number,
) {
  const panes: Record<string, Rect> = {};
  const dividers: Divider[] = [];
  const visit = (node: Layout, rect: Rect) => {
    if (node.kind === "pane") {
      panes[node.session] = rect;
      return;
    }
    const horizontal = node.direction === "right";
    const axis = horizontal ? "width" : "height";
    const available = rect[axis] - DIVIDER_SIZE;
    const min = minimumSize(node.first)[axis] / available;
    const max = 1 - minimumSize(node.second)[axis] / available;
    const ratio = Math.max(min, Math.min(max, node.ratio));
    const firstSize = Math.round(available * ratio);
    const secondStart = firstSize + DIVIDER_SIZE;
    const first = { ...rect, [axis]: firstSize };
    const second = horizontal
      ? {
          ...rect,
          left: rect.left + secondStart,
          width: rect.width - secondStart,
        }
      : {
          ...rect,
          top: rect.top + secondStart,
          height: rect.height - secondStart,
        };
    dividers.push({
      id: node.id,
      direction: node.direction,
      container: rect,
      ratio,
      min,
      max,
      primary: visibleSessions(node.first),
      ...(horizontal
        ? {
            left: rect.left + firstSize,
            top: rect.top,
            width: DIVIDER_SIZE,
            height: rect.height,
          }
        : {
            left: rect.left,
            top: rect.top + firstSize,
            width: rect.width,
            height: DIVIDER_SIZE,
          }),
    });
    visit(node.first, first);
    visit(node.second, second);
  };
  if (layout) {
    const minimum = minimumSize(layout);
    visit(layout, {
      left: 0,
      top: 0,
      width: Math.max(width, minimum.width),
      height: Math.max(height, minimum.height),
    });
  }
  return { panes, dividers };
}

export function adjacentPane(
  panes: Record<string, Rect>,
  active: string,
  direction: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
): string | null {
  const current = panes[active];
  if (!current) return null;
  const horizontal = direction === "ArrowLeft" || direction === "ArrowRight";
  const reverse = direction === "ArrowLeft" || direction === "ArrowUp";
  const axisStart = (rect: Rect) => (horizontal ? rect.left : rect.top);
  const axisSize = (rect: Rect) => (horizontal ? rect.width : rect.height);
  const crossStart = (rect: Rect) => (horizontal ? rect.top : rect.left);
  const crossSize = (rect: Rect) => (horizontal ? rect.height : rect.width);
  const cross = crossStart(current) + crossSize(current) / 2;
  return (
    Object.entries(panes)
      .filter(
        ([id, rect]) =>
          id !== active &&
          (reverse
            ? axisStart(rect) + axisSize(rect) <= axisStart(current)
            : axisStart(rect) >= axisStart(current) + axisSize(current)),
      )
      .sort(([, a], [, b]) => {
        const score = (rect: Rect) => {
          const crossGap = Math.max(
            crossStart(rect) - cross,
            cross - crossStart(rect) - crossSize(rect),
            0,
          );
          const axisGap = reverse
            ? axisStart(current) - axisStart(rect) - axisSize(rect)
            : axisStart(rect) - axisStart(current) - axisSize(current);
          return (
            crossGap * 10000 +
            axisGap +
            Math.abs(crossStart(rect) + crossSize(rect) / 2 - cross)
          );
        };
        return score(a) - score(b);
      })[0]?.[0] ?? null
  );
}

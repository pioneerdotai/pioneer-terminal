"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { measureLayout, minimumSize } from "./geometry";
import { visibleSessions } from "./layout-tree";
import type { WorkspaceState } from "./model";

export function useWorkspaceGeometry(workspace: WorkspaceState) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const viewport = viewportRef.current!;
    const measure = () => {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    measure();
    // Apply measured pane geometry before this resize is painted.
    const observer = new ResizeObserver(() => flushSync(measure));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  const displayLayout =
    workspace.zoomed && workspace.activeId
      ? { kind: "pane" as const, session: workspace.activeId }
      : workspace.layout;
  const minimum = minimumSize(displayLayout);
  const width = Math.max(size.width, minimum.width);
  const height = Math.max(size.height, minimum.height);
  const { panes, dividers } = measureLayout(displayLayout, width, height);
  const paneCount = Object.keys(panes).length;
  const layoutPaneCount = visibleSessions(workspace.layout).length;

  return {
    viewportRef,
    width,
    height,
    panes,
    dividers,
    paneCount,
    layoutPaneCount,
  };
}

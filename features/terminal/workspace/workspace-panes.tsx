"use client";

import type { Dispatch } from "react";
import type { WorkspaceState, WorkspaceAction } from "./model";
import { SessionTerminal } from "../session/session-terminal";
import type { SessionTerminalProps } from "../session/types";
import { PaneDivider } from "./pane-divider";
import type { useWorkspaceGeometry } from "./use-workspace-geometry";

type WorkspacePanesProps = {
  workspace: WorkspaceState;
  dispatch: Dispatch<WorkspaceAction>;
  geometry: ReturnType<typeof useWorkspaceGeometry>;
  appearanceReady: boolean;
  terminalOptions: Omit<SessionTerminalProps, "session" | "active" | "visible">;
};

export function WorkspacePanes({
  workspace,
  dispatch,
  geometry,
  appearanceReady,
  terminalOptions,
}: WorkspacePanesProps) {
  const { viewportRef, width, height, panes, dividers, paneCount } = geometry;
  return (
    <main className="min-h-0 min-w-0 flex-1 bg-(--workspace-bg)">
      <div ref={viewportRef} className="size-full overflow-auto">
        <div className="relative" style={{ width, height }}>
          {/* Keep every session mounted here; tabs and splits only change geometry. */}
          {workspace.sessions.map((session) => {
            const active = session.id === workspace.activeId;
            const rect = panes[session.id];
            const visible = !!rect;
            return (
              <div
                key={session.id}
                id={`pane-${session.id}`}
                className="absolute isolate flex min-h-0 min-w-0 flex-col overflow-hidden"
                style={{
                  ...(rect ?? {
                    left: 0,
                    top: 0,
                    width,
                    height,
                  }),
                  visibility: visible ? "visible" : "hidden",
                }}
                aria-hidden={!visible}
                inert={!visible}
                role="tabpanel"
                aria-label={session.name}
                onFocusCapture={() =>
                  dispatch({
                    type: "focus",
                    id: session.id,
                  })
                }
                onPointerDownCapture={() =>
                  dispatch({
                    type: "focus",
                    id: session.id,
                  })
                }
              >
                <div className="relative z-0 min-h-0 flex-1">
                  {appearanceReady && (
                    <SessionTerminal
                      {...terminalOptions}
                      session={session}
                      active={active}
                      visible={visible}
                    />
                  )}
                </div>
                {visible && paneCount > 1 && !active && (
                  // Blend toward the theme background in both light and dark mode.
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 z-10 bg-(--workspace-bg) opacity-40"
                  />
                )}
              </div>
            );
          })}
          {dividers.map((divider) => (
            <PaneDivider
              key={divider.id}
              divider={divider}
              onResize={(id, ratio) =>
                dispatch({ type: "resize", id, ratio })
              }
            />
          ))}

          {workspace.sessions.length === 0 && (
            <div className="flex h-full items-center justify-center text-sm text-(--workspace-muted)">
              <button
                type="button"
                onClick={() => dispatch({ type: "add" })}
                className="rounded-md border border-(--workspace-border) px-3 py-2 text-xs text-(--workspace-muted) hover:bg-(--workspace-hover) hover:text-(--workspace-fg)"
              >
                New terminal session
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

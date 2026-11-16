"use client";

import { useLayoutEffect, useRef, type Dispatch } from "react";
import { SquareTerminal, X } from "lucide-react";
import { directoryLabel, shellLabel } from "./session-label";
import type { WorkspaceState, WorkspaceAction } from "./model";
import {
  ariaShortcuts,
  shortcutTitle,
  type Shortcuts,
} from "../settings/shortcuts";

type SessionTabsProps = {
  workspace: WorkspaceState;
  dispatch: Dispatch<WorkspaceAction>;
  shortcuts: Shortcuts;
};

export function SessionTabs({
  workspace,
  dispatch,
  shortcuts,
}: SessionTabsProps) {
  const sessionStrip = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const strip = sessionStrip.current;
    if (!strip) return;
    const revealActive = () => {
      strip
        .querySelector('[aria-pressed="true"]')
        ?.parentElement?.scrollIntoView({
          block: "nearest",
          inline: "nearest",
        });
    };
    revealActive();
    const observer = new ResizeObserver(revealActive);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [workspace.activeId]);
  return (
    <nav
      ref={sessionStrip}
      aria-label="Terminal sessions"
      className="flex min-w-0 flex-1 items-stretch overflow-x-auto overscroll-x-contain"
    >
      {workspace.sessions.map((session) => {
        const selected = session.id === workspace.activeId;
        const label = directoryLabel(session);

        return (
          <div
            key={session.id}
            className={`group flex w-56 max-w-full shrink-0 items-center border-r border-(--workspace-border) sm:w-64 ${
              selected
                ? "bg-(--workspace-bg) text-(--workspace-fg) shadow-[inset_0_2px_0_var(--workspace-fg)]"
                : "text-(--workspace-muted) hover:bg-(--workspace-hover)"
            }`}
          >
            <button
              type="button"
              aria-pressed={selected}
              aria-controls={`pane-${session.id}`}
              onClick={() =>
                dispatch({
                  type: "select",
                  id: session.id,
                })
              }
              className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left text-xs focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--workspace-focus)"
              title={label}
            >
              <span
                className={`size-1.5 shrink-0 rounded-full ${
                  session.status === "connected"
                    ? "bg-(--workspace-connected)"
                    : session.status === "closed"
                      ? "bg-(--workspace-muted)"
                      : "bg-(--workspace-pending)"
                }`}
                aria-hidden="true"
              />
              <span className="truncate" dir="ltr">
                {label}
              </span>
            </button>
            {shellLabel(session) && (
              <span
                className="shrink-0 text-[10px] text-(--workspace-muted)"
                title={`${session.name}: ${shellLabel(session)}`}
              >
                {shellLabel(session)}
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                dispatch({
                  type: "close",
                  id: session.id,
                });
              }}
              className={`mx-1 flex size-6 shrink-0 items-center justify-center rounded text-(--workspace-muted) group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-(--workspace-hover) hover:text-(--workspace-fg) focus-visible:opacity-100 [@media(hover:none)]:opacity-100 ${selected ? "opacity-100" : "opacity-0"}`}
              aria-label={`Close ${session.name}`}
              title={
                selected
                  ? shortcutTitle(
                      shortcuts,
                      "close",
                      `Close ${session.name}`,
                    )
                  : `Close ${session.name}`
              }
              aria-keyshortcuts={
                selected ? ariaShortcuts(shortcuts, "close") : undefined
              }
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        );
      })}
      {workspace.sessions.length === 0 && (
        <span className="flex items-center px-3 text-xs text-(--workspace-muted)">
          No sessions open
        </span>
      )}
    </nav>
  );
}

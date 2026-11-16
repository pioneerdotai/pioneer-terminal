"use client";

import type { Dispatch } from "react";
import { Columns2, Rows2, Maximize2, Minimize2 } from "lucide-react";
import { MAX_PANES, type WorkspaceState, type WorkspaceAction } from "./model";
import { shortcutTitle, type Shortcuts } from "../settings/shortcuts";

const buttonClass = "flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-(--workspace-hover) focus-visible:outline-2 focus-visible:outline-(--workspace-focus) disabled:opacity-30";

export function WorkspaceSplitActions({
  workspace,
  dispatch,
  layoutPaneCount,
  shortcuts,
  onSelect,
}: {
  workspace: WorkspaceState;
  dispatch: Dispatch<WorkspaceAction>;
  layoutPaneCount: number;
  shortcuts: Shortcuts;
  onSelect: () => void;
}) {
  return (
    <div role="group" aria-label="Split panes">
      {([
        { direction: "right", command: "splitRight", label: "Split right", icon: Columns2 },
        { direction: "down", command: "splitDown", label: "Split down", icon: Rows2 },
      ] as const).map(({ direction, command, label, icon: Icon }) => (
        <button
          key={direction}
          type="button"
          title={shortcutTitle(shortcuts, command, label)}
          disabled={!workspace.activeId || layoutPaneCount >= MAX_PANES}
          onClick={() => {
            if (!workspace.activeId) return;
            onSelect();
            dispatch({ type: "split", id: workspace.activeId, direction });
          }}
          className={buttonClass}
        >
          <Icon size={14} aria-hidden="true" />
          {label}
        </button>
      ))}
      {layoutPaneCount > 1 && (
        <button
          type="button"
          aria-label={workspace.zoomed ? "Restore panes" : "Zoom pane"}
          title={shortcutTitle(shortcuts, "zoom", workspace.zoomed ? "Restore panes" : "Zoom active pane")}
          onClick={() => {
            if (!workspace.activeId) return;
            onSelect();
            dispatch({ type: "zoom", id: workspace.activeId });
          }}
          className={buttonClass}
        >
          {workspace.zoomed ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
          {workspace.zoomed ? "Restore panes" : "Zoom active pane"}
        </button>
      )}
    </div>
  );
}

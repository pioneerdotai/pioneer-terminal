"use client";

import type { Dispatch, RefObject } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import type { WorkspaceState, WorkspaceAction } from "./model";
import { ariaShortcuts, shortcutTitle } from "../settings/shortcuts";
import { AppearanceSettings } from "../settings/appearance-settings";
import { ShortcutSettings } from "../settings/shortcut-settings";
import type { useAppearance } from "../settings/use-appearance";
import type { useShortcuts } from "../settings/use-shortcuts";
import { AppCloseButton, AppPlacementControls, useAppViewControls } from "./app-view-controls";
import { WorkspaceSplitActions } from "./workspace-split-actions";

type WorkspaceToolbarProps = {
  workspace: WorkspaceState;
  dispatch: Dispatch<WorkspaceAction>;
  layoutPaneCount: number;
  appearanceState: ReturnType<typeof useAppearance>;
  shortcutState: ReturnType<typeof useShortcuts>;
  setToolsHost: (element: HTMLDivElement | null) => void;
  actionsMenu: HTMLDivElement | null;
  setActionsMenu: (element: HTMLDivElement | null) => void;
  actionsOpener: RefObject<HTMLButtonElement | null>;
  actionsMenuId: string;
  newSessionButton: RefObject<HTMLButtonElement | null>;
  onViewError: (error: string | null) => void;
};

export function WorkspaceToolbar({
  workspace,
  dispatch,
  layoutPaneCount,
  appearanceState,
  shortcutState,
  setToolsHost,
  actionsMenu,
  setActionsMenu,
  actionsOpener,
  actionsMenuId,
  newSessionButton,
  onViewError,
}: WorkspaceToolbarProps) {
  const viewControls = useAppViewControls(onViewError);
  const closeMenu = () => actionsMenu?.hidePopover();
  const { appearance, saved, update } = appearanceState;
  const { shortcuts, saved: shortcutsSaved, update: updateShortcuts } = shortcutState;
  return (
    <div className="flex shrink-0 items-center border-l border-(--workspace-border) px-1 sm:gap-0.5">
      <button
        type="button"
        onClick={() => dispatch({ type: "add" })}
        className="flex h-6 w-6 items-center justify-center rounded text-(--workspace-muted) hover:bg-(--workspace-hover) hover:text-(--workspace-fg) sm:w-6"
        aria-label="New terminal session"
        ref={newSessionButton}
        title={shortcutTitle(shortcuts, "new", "New terminal session")}
        aria-keyshortcuts={ariaShortcuts(shortcuts, "new")}
      >
        <Plus size={14} aria-hidden="true" />
      </button>
      <div
        ref={setToolsHost}
        className="flex shrink-0 items-center sm:gap-0.5"
      />
      <button
        ref={actionsOpener}
        type="button"
        popoverTarget={actionsMenuId}
        aria-label="Terminal actions"
        title="Terminal actions"
        className="flex h-6 w-6 items-center justify-center rounded text-(--workspace-muted) hover:bg-(--workspace-hover) hover:text-(--workspace-fg) sm:w-6"
      >
        <MoreHorizontal size={14} aria-hidden="true" />
      </button>
      <AppCloseButton controls={viewControls} />
      <div
        ref={setActionsMenu}
        id={actionsMenuId}
        popover="auto"
        className="fixed inset-auto top-11 right-2 m-0 max-h-[calc(100dvh-3rem)] w-56 flex-col overflow-y-auto rounded-md border border-(--workspace-border) bg-(--workspace-panel) p-1 text-xs text-(--workspace-fg) shadow-lg [&:popover-open]:flex"
      >
        <AppPlacementControls controls={viewControls} onSelect={closeMenu} />
        <hr className="my-3 border-(--workspace-border)" />
        <WorkspaceSplitActions
          workspace={workspace}
          dispatch={dispatch}
          layoutPaneCount={layoutPaneCount}
          shortcuts={shortcuts}
          onSelect={closeMenu}
        />
        <hr className="my-3 border-(--workspace-border)" />
      </div>
      <AppearanceSettings
        appearance={appearance}
        saved={saved}
        update={update}
        menu={actionsMenu}
        menuOpener={actionsOpener}
      />
      <ShortcutSettings
        shortcuts={shortcuts}
        saved={shortcutsSaved}
        update={updateShortcuts}
        menu={actionsMenu}
        menuOpener={actionsOpener}
      />
    </div>
  );
}

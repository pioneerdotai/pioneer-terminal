"use client";

import {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
} from "react";
import type { ShellIntegrationState } from "@wterm/dom";
import type { AppTheme } from "../theme";
import { INITIAL_STATE, workspaceReducer } from "./reducer";
import type { SessionStatus } from "./model";
import { useAppearance } from "../settings/use-appearance";
import { useShortcuts } from "../settings/use-shortcuts";
import { useWorkspaceGeometry } from "./use-workspace-geometry";
import { useWorkspaceShortcuts } from "./use-workspace-shortcuts";
import { SessionTabs } from "./session-tabs";
import { WorkspaceToolbar } from "./workspace-toolbar";
import { WorkspacePanes } from "./workspace-panes";

export function WorkspaceView({ theme }: { theme: AppTheme }) {
  const [workspace, dispatch] = useReducer(workspaceReducer, INITIAL_STATE);
  const appearanceState = useAppearance();
  const { appearance, ready: appearanceReady } = appearanceState;
  const shortcutState = useShortcuts();
  const { shortcuts } = shortcutState;
  const geometry = useWorkspaceGeometry(workspace);
  const { handlers, registerFind, registerPrompt } = useWorkspaceShortcuts({
    workspace,
    dispatch,
    shortcuts,
    panes: geometry.panes,
    layoutPaneCount: geometry.layoutPaneCount,
  });
  const [toolsHost, setToolsHost] = useState<HTMLDivElement | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [actionsMenu, setActionsMenu] = useState<HTMLDivElement | null>(null);
  const actionsOpener = useRef<HTMLButtonElement>(null);
  const actionsMenuId = useId();
  const newSessionButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!workspace.sessions.length) newSessionButton.current?.focus();
  }, [workspace.sessions.length]);
  const [debugEnabled] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("debug"),
  );
  const handleStatus = useCallback((id: string, status: SessionStatus) => {
    dispatch({ type: "status", id, status });
  }, []);

  const handleCwd = useCallback((id: string, cwd: string) => {
    dispatch({ type: "cwd", id, cwd });
  }, []);

  const handleDirectory = useCallback((id: string, uri: string) => {
    dispatch({ type: "directory", id, uri });
  }, []);

  const handleShell = useCallback(
    (id: string, shell: ShellIntegrationState) => {
      dispatch({ type: "shell", id, shell });
    },
    [],
  );

  return (
    <div
      data-theme={theme.appearance}
      className="workspace flex h-full w-full flex-col overflow-hidden bg-(--workspace-bg) text-(--workspace-fg)"
      {...handlers}
    >
      <header className="flex h-8.5 shrink-0 items-stretch border-b border-(--workspace-border) bg-(--workspace-sidebar)">
        <SessionTabs
          workspace={workspace}
          dispatch={dispatch}
          shortcuts={shortcuts}
        />
        <WorkspaceToolbar
          workspace={workspace}
          dispatch={dispatch}
          layoutPaneCount={geometry.layoutPaneCount}
          appearanceState={appearanceState}
          shortcutState={shortcutState}
          setToolsHost={setToolsHost}
          actionsMenu={actionsMenu}
          setActionsMenu={setActionsMenu}
          actionsOpener={actionsOpener}
          actionsMenuId={actionsMenuId}
          newSessionButton={newSessionButton}
          onViewError={setViewError}
        />
      </header>
      {viewError && (
        <p role="alert" className="shrink-0 border-b border-(--workspace-border) px-3 py-1 text-xs text-(--workspace-fg)">
          {viewError}
        </p>
      )}
      <WorkspacePanes
        workspace={workspace}
        dispatch={dispatch}
        geometry={geometry}
        appearanceReady={appearanceReady}
        terminalOptions={{
          shortcuts,
          registerFind,
          registerPrompt,
          theme,
          fontSize: appearance.fontSize,
          toolsHost,
          actionsMenu,
          actionsOpener,
          debugEnabled,
          onStatus: handleStatus,
          onCwd: handleCwd,
          onDirectory: handleDirectory,
          onShell: handleShell,
        }}
      />
    </div>
  );
}

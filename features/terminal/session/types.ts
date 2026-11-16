import type { AppTheme } from "../theme";
import type { RefObject } from "react";
import type { ShellIntegrationState } from "@wterm/dom";
import type { Shortcuts } from "../settings/shortcuts";
import type { Session, SessionStatus } from "../workspace/model";

export interface SessionTerminalProps {
  shortcuts: Shortcuts;
  registerFind: (id: string, open: () => void) => () => void;
  registerPrompt: (
    id: string,
    navigate: (direction: -1 | 1) => void,
  ) => () => void;
  theme: AppTheme;
  fontSize: number;
  session: Session;
  active: boolean;
  visible: boolean;
  toolsHost: HTMLDivElement | null;
  actionsMenu: HTMLDivElement | null;
  actionsOpener: RefObject<HTMLButtonElement | null>;
  debugEnabled: boolean;
  onStatus: (id: string, status: SessionStatus) => void;
  onCwd: (id: string, cwd: string) => void;
  onDirectory: (id: string, uri: string) => void;
  onShell: (id: string, state: ShellIntegrationState) => void;
}

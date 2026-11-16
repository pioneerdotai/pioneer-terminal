import type { ShellIntegrationState } from "@wterm/core";

export type SessionStatus =
  "loading" | "connecting" | "reconnecting" | "connected" | "closed";
export type SplitDirection = "right" | "down";
export type Layout =
  | { kind: "pane"; session: string }
  | {
      kind: "split";
      id: string;
      direction: SplitDirection;
      ratio: number;
      first: Layout;
      second: Layout;
    };
export interface Session {
  id: string;
  name: string;
  status: SessionStatus;
  cwd: string | null;
  reportedCwd: string | null;
  focusRequest: number;
  shell: ShellIntegrationState | null;
}
export interface WorkspaceState {
  sessions: Session[];
  activeId: string | null;
  nextNumber: number;
  layout: Layout | null;
  zoomed: boolean;
}
export type WorkspaceAction =
  | { type: "add" }
  | { type: "split"; id: string; direction: SplitDirection }
  | { type: "select" | "focus" | "close" | "zoom"; id: string }
  | { type: "resize"; id: string; ratio: number }
  | { type: "status"; id: string; status: SessionStatus }
  | { type: "cwd"; id: string; cwd: string }
  | { type: "directory"; id: string; uri: string }
  | { type: "shell"; id: string; shell: ShellIntegrationState };

export const MAX_PANES = 4;
export const DIVIDER_SIZE = 1;
export const MIN_WIDTH = 320;
export const MIN_HEIGHT = 220;

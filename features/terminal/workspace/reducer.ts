import {
  MAX_PANES,
  type Layout,
  type Session,
  type WorkspaceAction,
  type WorkspaceState,
} from "./model";
import {
  pane,
  visibleSessions,
  replace,
  remove,
  sibling,
  resize,
} from "./layout-tree";
import { reportedDirectory } from "./working-directory";

const session = (number: number): Session => ({
  id: `session-${number}`,
  name: `Terminal ${number}`,
  status: "connecting",
  cwd: null,
  reportedCwd: null,
  focusRequest: 1,
  shell: null,
});
export const INITIAL_STATE: WorkspaceState = {
  sessions: [session(1)],
  activeId: "session-1",
  nextNumber: 2,
  layout: pane("session-1"),
  zoomed: false,
};

function requestFocus(sessions: Session[], id: string | null): Session[] {
  return sessions.map((item) =>
    item.id === id ? { ...item, focusRequest: item.focusRequest + 1 } : item,
  );
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  const visible = visibleSessions(state.layout);
  switch (action.type) {
    case "add":
    case "split": {
      if (
        action.type === "split" &&
        (!visible.includes(action.id) || visible.length >= MAX_PANES)
      )
        return state;
      const next = session(state.nextNumber);
      const target = action.type === "split" ? action.id : state.activeId;
      const replacement: Layout =
        action.type === "split"
          ? {
              kind: "split",
              id: `split-${state.nextNumber}`,
              direction: action.direction,
              ratio: 0.5,
              first: pane(action.id),
              second: pane(next.id),
            }
          : pane(next.id);
      return {
        ...state,
        sessions: [...state.sessions, next],
        activeId: next.id,
        zoomed: action.type === "split" ? false : state.zoomed,
        nextNumber: state.nextNumber + 1,
        layout:
          state.layout && target
            ? replace(state.layout, target, replacement)
            : replacement,
      };
    }
    case "focus":
      return visible.includes(action.id) && state.activeId !== action.id
        ? { ...state, activeId: action.id }
        : state;
    case "select":
    case "zoom": {
      if (!state.sessions.some((item) => item.id === action.id)) return state;
      return {
        ...state,
        sessions: requestFocus(state.sessions, action.id),
        activeId: action.id,
        zoomed:
          action.type === "zoom"
            ? !(state.zoomed && state.activeId === action.id)
            : state.zoomed,
        layout:
          !state.layout || !state.activeId
            ? pane(action.id)
            : visible.includes(action.id)
              ? state.layout
              : replace(state.layout, state.activeId, pane(action.id)),
      };
    }
    case "close": {
      const index = state.sessions.findIndex((item) => item.id === action.id);
      if (index === -1) return state;
      const sessions = state.sessions.filter((item) => item.id !== action.id);
      const layout = remove(state.layout, action.id);
      const remaining = visibleSessions(layout);
      const activeId =
        state.activeId === action.id
          ? (sibling(state.layout, action.id) ??
            remaining[0] ??
            sessions[index]?.id ??
            sessions[index - 1]?.id ??
            null)
          : state.activeId;
      return {
        ...state,
        sessions: requestFocus(sessions, activeId),
        activeId,
        zoomed: state.activeId === action.id ? false : state.zoomed,
        layout: layout ?? (activeId ? pane(activeId) : null),
      };
    }
    case "resize":
      return state.layout && Number.isFinite(action.ratio)
        ? {
            ...state,
            layout: resize(
              state.layout,
              action.id,
              Math.max(0, Math.min(1, action.ratio)),
            ),
          }
        : state;
    case "status":
      return {
        ...state,
        sessions: state.sessions.map((item) =>
          item.id === action.id ? { ...item, status: action.status } : item,
        ),
      };
    case "cwd":
      return {
        ...state,
        sessions: state.sessions.map((item) =>
          item.id === action.id ? { ...item, cwd: action.cwd } : item,
        ),
      };
    case "shell": {
      const current = state.sessions.find((item) => item.id === action.id);
      if (
        !current ||
        (current.shell?.phase === action.shell.phase &&
          current.shell?.exitCode === action.shell.exitCode)
      )
        return state;
      return {
        ...state,
        sessions: state.sessions.map((item) =>
          item.id === action.id
            ? { ...item, shell: { ...action.shell } }
            : item,
        ),
      };
    }
    case "directory": {
      const reportedCwd = reportedDirectory(action.uri);
      const current = state.sessions.find((item) => item.id === action.id);
      if (
        !current ||
        reportedCwd === undefined ||
        current.reportedCwd === reportedCwd
      )
        return state;
      return {
        ...state,
        sessions: state.sessions.map((item) =>
          item.id === action.id ? { ...item, reportedCwd } : item,
        ),
      };
    }
  }
}


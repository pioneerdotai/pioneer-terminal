"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type HTMLAttributes,
} from "react";
import { adjacentPane, type Rect } from "./geometry";
import type { WorkspaceAction, WorkspaceState } from "./model";
import { matchCommand, type Shortcuts } from "../settings/shortcuts";

type Options = {
  workspace: WorkspaceState;
  dispatch: Dispatch<WorkspaceAction>;
  shortcuts: Shortcuts;
  panes: Record<string, Rect>;
  layoutPaneCount: number;
};

type WorkspaceKeyHandlers = Pick<
  HTMLAttributes<HTMLDivElement>,
  | "onCompositionStartCapture"
  | "onCompositionEndCapture"
  | "onKeyDownCapture"
  | "onKeyUpCapture"
>;

export function useWorkspaceShortcuts({
  workspace,
  dispatch,
  shortcuts,
  panes,
  layoutPaneCount,
}: Options) {
  const findHandlers = useRef(new Map<string, () => void>());
  const registerFind = useCallback((id: string, open: () => void) => {
    findHandlers.current.set(id, open);
    return () => {
      findHandlers.current.delete(id);
    };
  }, []);
  const promptHandlers = useRef(new Map<string, (direction: -1 | 1) => void>());
  const registerPrompt = useCallback(
    (id: string, navigate: (direction: -1 | 1) => void) => {
      promptHandlers.current.set(id, navigate);
      return () => {
        promptHandlers.current.delete(id);
      };
    },
    [],
  );
  const composing = useRef(false);
  const consumedKeys = useRef(new Set<string>());
  useEffect(() => {
    const blur = () => {
      composing.current = false;
      consumedKeys.current.clear();
    };
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, []);

  const handlers: WorkspaceKeyHandlers = {
    onCompositionStartCapture: () => {
      composing.current = true;
    },
    onCompositionEndCapture: () => {
      composing.current = false;
    },
    onKeyUpCapture: (event) => {
      if (consumedKeys.current.delete(event.code)) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    onKeyDownCapture: (event) => {
      if (event.repeat && consumedKeys.current.has(event.code)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!event.repeat) consumedKeys.current.delete(event.code);
      if (
        event.repeat ||
        composing.current ||
        event.defaultPrevented ||
        !(event.target instanceof Element) ||
        document.querySelector("dialog[open]")
      )
        return;
      const command = matchCommand(shortcuts, event.nativeEvent);
      if (!command) return;
      const terminalInput = !!event.target.closest(".local-terminal");
      const editing = !!event.target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
      );
      if (
        !terminalInput &&
        (editing || (command !== "find" && command !== "new"))
      )
        return;
      const id = workspace.activeId;
      if (command !== "new" && !id) return;
      event.preventDefault();
      event.stopPropagation();
      consumedKeys.current.add(event.code);
      switch (command) {
        case "new":
          dispatch({ type: "add" });
          break;
        case "close":
          dispatch({ type: "close", id: id! });
          break;
        case "splitRight":
        case "splitDown":
          dispatch({
            type: "split",
            id: id!,
            direction: command === "splitRight" ? "right" : "down",
          });
          break;
        case "zoom":
          if (layoutPaneCount > 1) dispatch({ type: "zoom", id: id! });
          break;
        case "find":
          findHandlers.current.get(id!)?.();
          break;
        case "previousPrompt":
        case "nextPrompt":
          promptHandlers.current.get(id!)?.(
            command === "previousPrompt" ? -1 : 1,
          );
          break;
        default: {
          const direction = {
            left: "ArrowLeft",
            right: "ArrowRight",
            up: "ArrowUp",
            down: "ArrowDown",
          } as const;
          const next = adjacentPane(panes, id!, direction[command]);
          if (next) dispatch({ type: "select", id: next });
        }
      }
    },
  };
  return { handlers, registerFind, registerPrompt };
}

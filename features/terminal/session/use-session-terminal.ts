"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTerminal } from "@wterm/react";
import type { WTerm } from "@wterm/dom";
import { getAppClient } from "@/client/pioneer";
import { TerminalConnection } from "./transport/connection";
import { trackConnection } from "./live-connections";
import type { SessionTerminalProps } from "./types";
import { useTerminalNavigation } from "./use-terminal-navigation";
import { useTerminalClipboard } from "./use-terminal-clipboard";
import { useTerminalCore } from "./use-terminal-core";

function terminalPixelSize(terminal: WTerm): { width: number; height: number } {
  const rect = terminal.element.getBoundingClientRect();
  return {
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

export function useSessionTerminal({
  registerFind,
  registerPrompt,
  theme,
  session,
  active,
  onStatus,
  onCwd,
}: SessionTerminalProps) {
  const [ready, setReady] = useState(false);
  const themeRef = useRef(theme);
  useLayoutEffect(() => {
    themeRef.current = theme;
  }, [theme]);
  const focusedRequest = useRef(0);
  const { ref, write } = useTerminal();
  const wsRef = useRef<TerminalConnection | null>(null);
  const untrackRef = useRef<() => void>(() => {});
  const terminalRef = useRef<WTerm | null>(null);
  const connectFrameRef = useRef<number | null>(null);
  const disposedRef = useRef(false);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(
    null,
  );
  const [reconnected, setReconnected] = useState(false);
  const [lostInput, setLostInput] = useState(false);
  const navigation = useTerminalNavigation({
    terminal: terminalRef,
    sessionId: session.id,
    registerFind,
    registerPrompt,
  });
  const { findOpen, findInputRef, setSearchState } = navigation;

  useLayoutEffect(() => {
    terminalRef.current?.setThemeColors(theme.terminal);
    // A host theme can change the font family as well as its colors.
    terminalRef.current?.fit();
  }, [theme, ready]);

  useEffect(() => {
    disposedRef.current = false;
    const pagehide = () => {
      wsRef.current?.close();
    };
    window.addEventListener("pagehide", pagehide);
    return () => {
      window.removeEventListener("pagehide", pagehide);
      disposedRef.current = true;
      if (connectFrameRef.current !== null) {
        cancelAnimationFrame(connectFrameRef.current);
        connectFrameRef.current = null;
      }
      wsRef.current?.close();
      untrackRef.current();
      wsRef.current = null;
      terminalRef.current = null;
    };
  }, [session.id]);

  const core = useTerminalCore(session.id, onStatus, setConnectionMessage);

  useEffect(() => {
    if (!ready || focusedRequest.current === session.focusRequest) return;
    focusedRequest.current = session.focusRequest;
    if (!active || document.querySelector("dialog[open]")) return;
    terminalRef.current?.element.closest('[role="tabpanel"]')?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
    if (findOpen) findInputRef.current?.focus();
    else ref.current?.focus();
  }, [active, findOpen, ready, ref, session.focusRequest, findInputRef]);

  useEffect(() => {
    if (findOpen) findInputRef.current?.focus();
  }, [findOpen, findInputRef]);

  const handleReady = useCallback(
    async (wt: WTerm) => {
      if (disposedRef.current) return;
      const app = await getAppClient();
      if (disposedRef.current) return;
      setReady(false);
      // A replacement parser starts a new shell; there is no output replay.
      if (terminalRef.current && terminalRef.current !== wt) {
        if (connectFrameRef.current !== null) {
          cancelAnimationFrame(connectFrameRef.current);
          connectFrameRef.current = null;
        }
        // Strict Mode can replace the core even after its first attachment.
        wsRef.current?.close();
        untrackRef.current();
        wsRef.current = null;
      }
      terminalRef.current = wt;
      wt.setThemeColors(themeRef.current.terminal);
      setReady(true);
      wt.onSearchChange = setSearchState;
      if (wsRef.current) return;

      // Let the first ResizeObserver pass settle before spawning the shell.
      // Otherwise zsh starts at 80x24, then redraws its prompt when the
      // terminal immediately resizes to the viewport dimensions.
      connectFrameRef.current = requestAnimationFrame(() => {
        connectFrameRef.current = null;
        if (disposedRef.current || wsRef.current) return;

        const wsUrl = app.webSocketUrl("terminal");
        onStatus(session.id, "connecting");
        let untrack = () => {};
        const connection = new TerminalConnection(
          () => new WebSocket(wsUrl),
          {
            open: (resumed, inputLost) => {
              const terminal = terminalRef.current;
              if (!terminal) return;
              const { width, height } = terminalPixelSize(terminal);
              setConnectionMessage(null);
              setReconnected(resumed);
              setLostInput((previous) => inputLost || (resumed && previous));
              onStatus(session.id, "connected");
              connection.resize(terminal.cols, terminal.rows, width, height);
            },
            reconnecting: () => {
              setReconnected(false);
              setConnectionMessage(
                "Reconnecting… Input is paused until the session returns.",
              );
              onStatus(session.id, "reconnecting");
            },
            write,
            cwd: (path) => onCwd(session.id, path),
            end: (message) => {
              if (disposedRef.current || wsRef.current !== connection) return;
              untrack();
              setConnectionMessage(message);
              setReconnected(false);
              wsRef.current = null;
              onStatus(session.id, "closed");
            },
            inputError: setConnectionMessage,
          },
        );
        untrack = trackConnection(connection);
        untrackRef.current = untrack;
        wsRef.current = connection;
      });
    },
    [onCwd, onStatus, session.id, write, setSearchState],
  );

  const handleData = useCallback((data: string) => {
    wsRef.current?.input(data);
  }, []);

  const clipboard = useTerminalClipboard(terminalRef);

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      const terminal = terminalRef.current;
      if (!terminal) return;
      const { width, height } = terminalPixelSize(terminal);
      wsRef.current?.resize(cols, rows, width, height);
    },
    [],
  );

  const dismissReconnect = () => {
    setReconnected(false);
    setLostInput(false);
    terminalRef.current?.focus();
  };
  return {
    core,
    ready,
    ref,
    terminalRef,
    handleReady,
    handleData,
    handleResize,
    navigation,
    clipboard,
    connectionMessage,
    reconnected,
    lostInput,
    dismissReconnect,
  };
}

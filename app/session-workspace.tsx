"use client";

import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Columns2,
  Rows2,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Plus,
  Search,
  SquareTerminal,
  X,
} from "lucide-react";
import { Terminal as WTermTerminal, useTerminal } from "@wterm/react";
import { GhosttyCore } from "@wterm/ghostty";
import type {
  SearchState,
  TerminalCore,
  WTerm,
  ShellIntegrationState,
} from "@wterm/dom";
import { OutputReader } from "./output-reader";
import {
  ClipboardRequest,
  type ClipboardWriteRequest,
} from "./clipboard-request";
import { TerminalConnection } from "../lib/terminal-connection";
import {
  SessionRecovery,
  RECOVERY_KEY,
  decodeOutput,
} from "../lib/session-recovery";
import "@wterm/react/css";

import {
  MAX_PANES,
  adjacentPane,
  measureLayout,
  minimumSize,
  workspaceReducer,
  visibleSessions,
  shellLabel,
  type Session,
  type SessionStatus,
} from "../lib/workspace-layout";
import { PaneDivider } from "./pane-divider";
import { AppearanceSettings, useAppearance } from "./appearance-settings";
import { TERMINAL_COLORS } from "../lib/appearance";
import { ShortcutSettings, useShortcuts } from "./shortcut-settings";
import {
  ariaShortcuts,
  matchCommand,
  shortcutTitle,
  type Shortcuts,
} from "../lib/shortcuts";

function cwdLabel(cwd: string | null): string {
  if (!cwd) return "Starting…";
  return cwd.replace(/[/\\]+$/, "") || "/";
}

function disposeCore(core: TerminalCore): void {
  const disposable = core as TerminalCore & { dispose?: () => void };
  disposable.dispose?.();
}

function terminalPixelSize(terminal: WTerm): { width: number; height: number } {
  const rect = terminal.element.getBoundingClientRect();
  return {
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

interface SessionTerminalProps {
  recovery: SessionRecovery;
  shortcuts: Shortcuts;
  registerFind: (id: string, open: () => void) => () => void;
  registerPrompt: (
    id: string,
    navigate: (direction: -1 | 1) => void,
  ) => () => void;
  theme: "dark" | "light";
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

function SessionTerminal({
  recovery,
  shortcuts,
  registerFind,
  registerPrompt,
  theme,
  fontSize,
  session,
  active,
  visible,
  toolsHost,
  actionsMenu,
  actionsOpener,
  debugEnabled,
  onStatus,
  onCwd,
  onDirectory,
  onShell,
}: SessionTerminalProps) {
  const [ready, setReady] = useState(false);
  const replaying = useRef(false);
  const attached = useRef(false);
  const leaving = useRef(false);
  const [log] = useState(() => recovery.get(session.id));
  const [recoveryFailed, setRecoveryFailed] = useState(log.failed);
  const themeRef = useRef(theme);
  useLayoutEffect(() => {
    themeRef.current = theme;
  }, [theme]);
  const focusedRequest = useRef(0);
  const [core, setCore] = useState<TerminalCore | null>(null);
  const { ref, write } = useTerminal();
  const wsRef = useRef<TerminalConnection | null>(null);
  const terminalRef = useRef<WTerm | null>(null);
  const connectFrameRef = useRef<number | null>(null);
  const disposedRef = useRef(false);
  const [findOpen, setFindOpen] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(
    null,
  );
  const [reconnected, setReconnected] = useState(false);
  const [lostInput, setLostInput] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [searchState, setSearchState] = useState<SearchState | null>(null);
  const findInputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (replaying.current) return;
    terminalRef.current?.setThemeColors(TERMINAL_COLORS[theme]);
    log.append({ type: "theme", theme });
    log.checkpoint();
    setRecoveryFailed(log.failed);
  }, [theme, ready, log]);

  const openFind = useCallback(() => {
    setFindOpen(true);
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, []);

  const closeFind = () => {
    setFindOpen(false);
    terminalRef.current?.clearSearch();
    terminalRef.current?.focus();
  };

  useLayoutEffect(
    () => registerFind(session.id, openFind),
    [registerFind, session.id, openFind],
  );

  const navigatePrompt = useCallback((direction: -1 | 1) => {
    terminalRef.current?.scrollToPrompt(direction);
  }, []);
  useLayoutEffect(
    () => registerPrompt(session.id, navigatePrompt),
    [registerPrompt, session.id, navigatePrompt],
  );

  useEffect(() => {
    if (findOpen) terminalRef.current?.search(query, { caseSensitive });
  }, [query, caseSensitive, findOpen]);

  useEffect(() => {
    disposedRef.current = false;
    const pagehide = () => {
      leaving.current = true;
      wsRef.current?.detach();
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
      wsRef.current = null;
      terminalRef.current = null;
    };
  }, [recovery, session.id]);

  useEffect(() => {
    let cancelled = false;
    onStatus(session.id, "loading");
    GhosttyCore.load({ wasmPath: "/ghostty-vt.wasm" })
      .then((loadedCore) => {
        if (cancelled) {
          disposeCore(loadedCore);
        } else {
          setCore(loadedCore);
        }
      })
      .catch(() => {
        if (!cancelled) onStatus(session.id, "closed");
      });

    return () => {
      cancelled = true;
    };
  }, [onStatus, session.id]);

  useEffect(() => {
    return () => {
      if (core) disposeCore(core);
    };
  }, [core]);

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
  }, [active, findOpen, ready, ref, session.focusRequest]);

  useEffect(() => {
    if (findOpen) findInputRef.current?.focus();
  }, [findOpen]);

  const handleReady = useCallback(
    async (wt: WTerm) => {
      if (disposedRef.current) return;
      setReady(false);
      // A new parser cannot resume from the previous parser's byte position.
      if (terminalRef.current && terminalRef.current !== wt) {
        if (connectFrameRef.current !== null) {
          cancelAnimationFrame(connectFrameRef.current);
          connectFrameRef.current = null;
        }
        // Strict Mode can replace the core even after its first attachment.
        wsRef.current?.detach();
        wsRef.current = null;
      }
      terminalRef.current = wt;
      const replay = log;
      const head = replay.saved;
      const saved = head?.session ? head : null;
      if ((log.restore || attached.current) && !saved) {
        setConnectionMessage(
          "This session could not be restored. Open a new terminal to start another shell.",
        );
        onStatus(session.id, "closed");
        return;
      }
      if (saved) {
        replaying.current = true;
        wt.autoResize = false;
        wt.setRenderingPaused(true);
        wt.resize(saved.cols, saved.rows);
        wt.setThemeColors(TERMINAL_COLORS[saved.theme]);
        let bytes = 0;
        try {
          for (const event of replay.replay) {
            if (
              disposedRef.current ||
              leaving.current ||
              terminalRef.current !== wt
            )
              return;
            if (event.type === "output") {
              const data = decodeOutput(event.data);
              wt.write(data);
              bytes += data.length;
            } else if (event.type === "resize")
              wt.resize(event.cols, event.rows);
            else wt.setThemeColors(TERMINAL_COLORS[event.theme]);
            if (bytes >= 32 * 1024) {
              bytes = 0;
              await new Promise((resolve) => setTimeout(resolve, 0));
            }
          }
        } catch {
          replay.invalidate();
          setRecoveryFailed(true);
          setConnectionMessage(
            "This session could not be restored. Open a new terminal to start another shell.",
          );
          onStatus(session.id, "closed");
          return;
        } finally {
          if (terminalRef.current === wt) replaying.current = false;
          wt.autoResize = true;
        }
        if (
          disposedRef.current ||
          leaving.current ||
          terminalRef.current !== wt
        )
          return;
        wt.fit();
      } else replay.start(wt.cols, wt.rows, themeRef.current);
      wt.setThemeColors(TERMINAL_COLORS[themeRef.current]);
      replay.append({ type: "theme", theme: themeRef.current });
      replay.checkpoint();
      setReady(true);
      wt.onSearchChange = setSearchState;
      if (wsRef.current) return;

      // Let the first ResizeObserver pass settle before spawning the shell.
      // Otherwise zsh starts at 80x24, then redraws its prompt when the
      // terminal immediately resizes to the viewport dimensions.
      connectFrameRef.current = requestAnimationFrame(() => {
        connectFrameRef.current = null;
        if (disposedRef.current || wsRef.current) return;

        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${proto}//${window.location.host}/api/terminal`;
        onStatus(session.id, "connecting");
        let restoredConnection = !!saved;
        const connection = new TerminalConnection(
          () => new WebSocket(wsUrl),
          {
            open: (resumed, inputLost) => {
              attached.current = true;
              const terminal = terminalRef.current;
              if (!terminal) return;
              const { width, height } = terminalPixelSize(terminal);
              setConnectionMessage(null);
              setReconnected(resumed && !restoredConnection);
              restoredConnection = false;
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
            write: (data) => {
              write(data);
              replay.write(data);
            },
            cwd: (path) => onCwd(session.id, path),
            end: (message) => {
              if (disposedRef.current || wsRef.current !== connection) return;
              replay.invalidate();
              setConnectionMessage(message);
              setReconnected(false);
              wsRef.current = null;
              onStatus(session.id, "closed");
            },
            inputError: setConnectionMessage,
            checkpoint: (state) => {
              replay.checkpoint(state);
              setRecoveryFailed(replay.failed);
            },
          },
          saved ?? undefined,
        );
        wsRef.current = connection;
      });
    },
    [log, onCwd, onStatus, session.id, write],
  );

  const handleData = useCallback((data: string) => {
    wsRef.current?.input(data);
  }, []);

  const [clipboardRequest, setClipboardRequest] =
    useState<ClipboardWriteRequest | null>(null);
  const handleClipboardWrite = useCallback((text: string) => {
    if (replaying.current) return;
    setClipboardRequest({ text });
  }, []);

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      if (replaying.current) return;
      const terminal = terminalRef.current;
      if (!terminal) return;
      log.append({ type: "resize", cols, rows });
      log.checkpoint();
      const { width, height } = terminalPixelSize(terminal);
      wsRef.current?.resize(cols, rows, width, height);
    },
    [log],
  );

  if (!core) {
    return (
      <div className="flex h-full items-center justify-center bg-(--workspace-bg) text-xs text-(--workspace-muted)">
        Loading terminal…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {recoveryFailed && session.status !== "closed" && (
        <p role="status" className="pb-2 text-xs text-(--workspace-muted)">
          Refresh recovery is unavailable for this session. Keep this page open
          to continue using it.
        </p>
      )}
      {active &&
        toolsHost &&
        createPortal(
          <>
            <button
              type="button"
              onClick={openFind}
              aria-label="Find"
              title={shortcutTitle(shortcuts, "find", "Find in terminal")}
              aria-keyshortcuts={ariaShortcuts(shortcuts, "find")}
              className="flex h-8 w-7 items-center justify-center rounded text-(--workspace-muted) hover:bg-(--workspace-hover) hover:text-(--workspace-fg) sm:w-8"
            >
              <Search size={16} aria-hidden="true" />
            </button>
            <OutputReader
              terminal={terminalRef}
              name={session.name}
              active={active && visible}
              menu={actionsMenu}
              menuOpener={actionsOpener}
            >
              {session.shell && session.shell.phase !== "unknown" && (
                <div
                  className="flex items-center gap-1"
                  role="group"
                  aria-label="Prompt navigation"
                >
                  {([-1, 1] as const).map((direction) => {
                    const command =
                      direction < 0 ? "previousPrompt" : "nextPrompt";
                    const label =
                      direction < 0 ? "Previous prompt" : "Next prompt";
                    const Icon = direction < 0 ? ArrowUp : ArrowDown;
                    return (
                      <button
                        key={direction}
                        type="button"
                        aria-label={label}
                        title={shortcutTitle(shortcuts, command, label)}
                        aria-keyshortcuts={
                          active ? ariaShortcuts(shortcuts, command) : undefined
                        }
                        disabled={!ready}
                        className="rounded p-1 hover:bg-(--workspace-hover) hover:text-(--workspace-fg) disabled:opacity-30"
                        onClick={() => navigatePrompt(direction)}
                      >
                        <Icon size={14} aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              )}
            </OutputReader>
          </>,
          toolsHost,
        )}
      {findOpen && (
        <div
          className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-(--workspace-border) py-2 text-xs"
          role="search"
          aria-label="Terminal output"
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") {
              event.preventDefault();
              closeFind();
            }
            if (event.key === "Enter") {
              event.preventDefault();
              if (event.shiftKey) terminalRef.current?.findPrevious();
              else terminalRef.current?.findNext();
            }
          }}
        >
          <input
            ref={findInputRef}
            type="text"
            aria-label="Find in terminal"
            placeholder="Find in terminal…"
            maxLength={1024}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 rounded border border-(--workspace-border) bg-(--workspace-bg) px-2 py-1 outline-none focus:border-(--workspace-focus)"
          />
          <span
            className="whitespace-nowrap text-(--workspace-muted)"
            role="status"
            aria-live="polite"
          >
            {!query
              ? ""
              : searchState?.searching
                ? "Searching…"
                : searchState?.count
                  ? `${searchState.activeIndex + 1} of ${searchState.count}${searchState.limited ? "+" : ""}`
                  : "No matches"}
          </span>
          <button
            type="button"
            aria-label="Match case"
            aria-pressed={caseSensitive}
            title="Match case"
            onClick={() => setCaseSensitive((value) => !value)}
            className={`rounded px-2 py-1 ${caseSensitive ? "bg-(--workspace-selected) text-(--workspace-fg)" : "text-(--workspace-muted) hover:bg-(--workspace-hover)"}`}
          >
            Aa
          </button>
          <button
            type="button"
            aria-label="Previous match"
            title="Previous match (Shift+Enter)"
            disabled={!searchState?.count}
            className="rounded p-1 hover:bg-(--workspace-hover) disabled:opacity-30"
            onClick={() => terminalRef.current?.findPrevious()}
          >
            <ArrowUp size={16} />
          </button>
          <button
            type="button"
            aria-label="Next match"
            title="Next match (Enter)"
            disabled={!searchState?.count}
            className="rounded p-1 hover:bg-(--workspace-hover) disabled:opacity-30"
            onClick={() => terminalRef.current?.findNext()}
          >
            <ArrowDown size={16} />
          </button>
          <button
            type="button"
            aria-label="Close find"
            title="Close find (Escape)"
            className="rounded p-1 hover:bg-(--workspace-hover)"
            onClick={closeFind}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {(reconnected || lostInput) && (
        <div
          role="status"
          className="flex items-center gap-3 py-2 text-xs text-(--workspace-muted)"
        >
          <span>
            {reconnected && "Reconnected."}
            {lostInput &&
              " Some input did not reach the shell and was not resent. Check the command line before continuing."}
          </span>
          <button
            type="button"
            className="shrink-0 underline hover:text-(--workspace-fg)"
            onClick={() => {
              setReconnected(false);
              setLostInput(false);
              terminalRef.current?.focus();
            }}
            aria-label="Dismiss reconnection notice"
          >
            Dismiss
          </button>
        </div>
      )}
      {connectionMessage && (
        <p
          role="status"
          className="shrink-0 px-2 py-1 text-xs text-(--workspace-muted)"
        >
          {connectionMessage}
        </p>
      )}
      <ClipboardRequest
        request={clipboardRequest}
        dismiss={(request) =>
          setClipboardRequest((current) =>
            current === request ? null : current,
          )
        }
        terminal={terminalRef}
        name={session.name}
        active={visible}
      />
      <div className="min-h-0 flex-1" inert={!ready}>
        <WTermTerminal
          ref={ref}
          renderingPaused={!visible || !ready}
          cols={80}
          rows={24}
          autoResize
          debug={debugEnabled}
          maxImageWidth={640}
          maxImageHeight={480}
          core={core}
          webmcp={{
            name: session.name,
            description: "Local shell on this machine",
          }}
          onReady={handleReady}
          onData={handleData}
          onShellIntegration={(state) => onShell(session.id, state)}
          onWorkingDirectory={(uri) => onDirectory(session.id, uri)}
          onClipboardWrite={handleClipboardWrite}
          onResize={handleResize}
          aria-label={session.name}
          tabIndex={visible ? 0 : -1}
          className="local-terminal size-full"
          style={
            {
              borderRadius: 0,
              boxShadow: "none",
              padding: 0,
              "--term-font-size": `${fontSize}px`,
              "--term-row-height": `${Math.ceil(fontSize * 1.2)}px`,
            } as CSSProperties
          }
        />
      </div>
    </div>
  );
}

const subscribeRecovery = () => () => {};
const serverRecovery = () => null;
export function SessionWorkspace() {
  const [getRecovery] = useState(() => {
    let recovery: SessionRecovery | null = null;
    return () => {
      if (!recovery) {
        let storage: Storage | null = null;
        try {
          storage = window.sessionStorage;
        } catch {}
        const navigation = performance.getEntriesByType("navigation")[0] as
          PerformanceNavigationTiming | undefined;
        recovery = new SessionRecovery(
          storage,
          `${RECOVERY_KEY}:${location.pathname}`,
          navigation?.type === "reload" || navigation?.type === "back_forward",
        );
      }
      return recovery;
    };
  });
  const recovery = useSyncExternalStore(
    subscribeRecovery,
    getRecovery,
    serverRecovery,
  );
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) location.reload();
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);
  return recovery ? <ReadyWorkspace recovery={recovery} /> : null;
}

function ReadyWorkspace({ recovery }: { recovery: SessionRecovery }) {
  const [workspace, dispatch] = useReducer(workspaceReducer, recovery.initial);
  const layoutSaved = useSyncExternalStore(
    recovery.subscribeLayoutSaved,
    recovery.getLayoutSaved,
    recovery.getLayoutSaved,
  );
  useLayoutEffect(() => {
    recovery.saveLayout(workspace);
  }, [recovery, workspace]);
  const {
    shortcuts,
    saved: shortcutsSaved,
    update: updateShortcuts,
  } = useShortcuts();
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
  const [toolsHost, setToolsHost] = useState<HTMLDivElement | null>(null);
  const [actionsMenu, setActionsMenu] = useState<HTMLDivElement | null>(null);
  const actionsOpener = useRef<HTMLButtonElement>(null);
  const actionsMenuId = useId();
  const newSessionButton = useRef<HTMLButtonElement>(null);
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
  useEffect(() => {
    const blur = () => {
      composing.current = false;
      consumedKeys.current.clear();
    };
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, []);
  useEffect(() => {
    if (!workspace.sessions.length) newSessionButton.current?.focus();
  }, [workspace.sessions.length]);
  const {
    appearance,
    theme,
    ready: appearanceReady,
    saved,
    update,
  } = useAppearance();
  const [debugEnabled] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("debug"),
  );

  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const viewport = viewportRef.current!;
    const measure = () => {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  const displayLayout =
    workspace.zoomed && workspace.activeId
      ? { kind: "pane" as const, session: workspace.activeId }
      : workspace.layout;
  const minimum = minimumSize(displayLayout);
  const width = Math.max(size.width, minimum.width);
  const height = Math.max(size.height, minimum.height);
  const { panes, dividers } = measureLayout(displayLayout, width, height);
  const paneCount = Object.keys(panes).length;
  const layoutPaneCount = visibleSessions(workspace.layout).length;

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
      data-theme={appearanceReady ? theme : "system"}
      className="workspace flex h-dvh w-screen flex-col overflow-hidden bg-(--workspace-bg) text-(--workspace-fg)"
      onCompositionStartCapture={() => {
        composing.current = true;
      }}
      onCompositionEndCapture={() => {
        composing.current = false;
      }}
      onKeyUpCapture={(event) => {
        if (consumedKeys.current.delete(event.code)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onKeyDownCapture={(event) => {
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
            recovery.remove(id!);
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
      }}
    >
      <header className="flex h-10 shrink-0 items-stretch border-b border-(--workspace-border) bg-(--workspace-sidebar)">
        <nav
          ref={sessionStrip}
          aria-label="Terminal sessions"
          className="flex min-w-0 flex-1 items-stretch overflow-x-auto overscroll-x-contain"
        >
          {workspace.sessions.map((session) => {
            const selected = session.id === workspace.activeId;
            const label = session.reportedCwd ?? cwdLabel(session.cwd);
            return (
              <div
                key={session.id}
                className={`group flex w-56 max-w-full shrink-0 items-center border-r border-(--workspace-border) sm:w-64 ${
                  selected
                    ? "bg-(--workspace-bg) text-(--workspace-fg) shadow-[inset_0_2px_0_var(--workspace-focus)]"
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
                  title={`${session.name} — ${session.reportedCwd ?? session.cwd ?? "Starting…"}`}
                >
                  <SquareTerminal
                    size={14}
                    className="hidden shrink-0 sm:block"
                    aria-hidden="true"
                  />
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${
                      session.status === "connected"
                        ? "bg-(--workspace-connected)"
                        : session.status === "closed"
                          ? "bg-[#666]"
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
                    recovery.remove(session.id);
                    dispatch({
                      type: "close",
                      id: session.id,
                    });
                  }}
                  className={`mx-1 flex size-7 shrink-0 items-center justify-center rounded text-(--workspace-muted) group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-(--workspace-hover) hover:text-(--workspace-fg) focus-visible:opacity-100 [@media(hover:none)]:opacity-100 ${selected ? "opacity-100" : "opacity-0"}`}
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
        <div className="flex shrink-0 items-center border-l border-(--workspace-border) px-1 sm:gap-0.5">
          <button
            type="button"
            onClick={() => dispatch({ type: "add" })}
            className="flex h-8 w-7 items-center justify-center rounded text-(--workspace-muted) hover:bg-(--workspace-hover) hover:text-(--workspace-fg) sm:w-8"
            aria-label="New terminal session"
            ref={newSessionButton}
            title={shortcutTitle(shortcuts, "new", "New terminal session")}
            aria-keyshortcuts={ariaShortcuts(shortcuts, "new")}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Split right"
            title={shortcutTitle(shortcuts, "splitRight", "Split right")}
            disabled={!workspace.activeId || layoutPaneCount >= MAX_PANES}
            onClick={() => {
              if (workspace.activeId)
                dispatch({
                  type: "split",
                  id: workspace.activeId,
                  direction: "right",
                });
            }}
            className="flex h-8 w-7 items-center justify-center rounded text-(--workspace-muted) hover:bg-(--workspace-hover) hover:text-(--workspace-fg) disabled:opacity-30 sm:w-8"
          >
            <Columns2 size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Split down"
            title={shortcutTitle(shortcuts, "splitDown", "Split down")}
            disabled={!workspace.activeId || layoutPaneCount >= MAX_PANES}
            onClick={() => {
              if (workspace.activeId)
                dispatch({
                  type: "split",
                  id: workspace.activeId,
                  direction: "down",
                });
            }}
            className="flex h-8 w-7 items-center justify-center rounded text-(--workspace-muted) hover:bg-(--workspace-hover) hover:text-(--workspace-fg) disabled:opacity-30 sm:w-8"
          >
            <Rows2 size={16} aria-hidden="true" />
          </button>
          {layoutPaneCount > 1 && (
            <button
              type="button"
              aria-label={workspace.zoomed ? "Restore panes" : "Zoom pane"}
              title={shortcutTitle(
                shortcuts,
                "zoom",
                workspace.zoomed ? "Restore panes" : "Zoom active pane",
              )}
              onClick={() => {
                if (workspace.activeId)
                  dispatch({
                    type: "zoom",
                    id: workspace.activeId,
                  });
              }}
              className="flex h-8 w-7 items-center justify-center rounded text-(--workspace-muted) hover:bg-(--workspace-hover) hover:text-(--workspace-fg) sm:w-8"
            >
              {workspace.zoomed ? (
                <Minimize2 size={16} aria-hidden="true" />
              ) : (
                <Maximize2 size={16} aria-hidden="true" />
              )}
            </button>
          )}
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
            className="flex h-8 w-7 items-center justify-center rounded text-(--workspace-muted) hover:bg-(--workspace-hover) hover:text-(--workspace-fg) sm:w-8"
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
          <div
            ref={setActionsMenu}
            id={actionsMenuId}
            popover="auto"
            className="fixed inset-auto top-11 right-2 m-0 w-52 flex-col rounded-md border border-(--workspace-border) bg-(--workspace-panel) p-1 text-xs text-(--workspace-fg) shadow-lg [&:popover-open]:flex"
          />
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
      </header>
      {!layoutSaved && (
        <p
          role="status"
          className="shrink-0 border-b border-(--workspace-border) px-3 py-1 text-xs text-(--workspace-muted)"
        >
          Pane layout could not be saved. Keep this page open to retain it.
        </p>
      )}

      <main className="min-h-0 min-w-0 flex-1 bg-(--workspace-bg) p-1">
        <div ref={viewportRef} className="size-full overflow-auto">
          <div className="relative" style={{ width, height }}>
            {workspace.sessions.map((session) => {
              const active = session.id === workspace.activeId;
              const rect = panes[session.id];
              const visible = !!rect;
              return (
                <div
                  key={session.id}
                  id={`pane-${session.id}`}
                  className={`absolute flex min-h-0 min-w-0 flex-col overflow-hidden rounded border ${paneCount > 1 ? (active ? "border-(--workspace-focus)" : "border-(--workspace-border)") : "border-transparent"}`}
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
                  <div className="min-h-0 flex-1">
                    {appearanceReady && (
                      <SessionTerminal
                        recovery={recovery}
                        shortcuts={shortcuts}
                        registerFind={registerFind}
                        registerPrompt={registerPrompt}
                        theme={theme}
                        fontSize={appearance.fontSize}
                        session={session}
                        active={active}
                        visible={visible}
                        toolsHost={toolsHost}
                        actionsMenu={actionsMenu}
                        actionsOpener={actionsOpener}
                        debugEnabled={debugEnabled}
                        onStatus={handleStatus}
                        onCwd={handleCwd}
                        onDirectory={handleDirectory}
                        onShell={handleShell}
                      />
                    )}
                  </div>
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
    </div>
  );
}

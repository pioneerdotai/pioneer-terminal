"use client";

import "@wterm/react/css";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  flushState,
  loadState,
  stateFailed,
  subscribeState,
} from "@/client/state";
import { useAppTheme } from "./theme";
import { WorkspaceView } from "./workspace/workspace-view";
import { closeConnections } from "./session/live-connections";

export function TerminalApp() {
  const theme = useAppTheme();
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const failed = useSyncExternalStore(subscribeState, stateFailed, () => false);

  useEffect(() => {
    let active = true;
    void loadState()
      .then(() => {
        if (active) setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("failed");
      });
    const save = () => {
      void flushState();
    };
    document.addEventListener("visibilitychange", save);
    const close = () => {
      closeConnections();
      save();
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) location.reload();
    };
    window.addEventListener("pagehide", close);
    window.addEventListener("pageshow", restore);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", save);
      window.removeEventListener("pagehide", close);
      window.removeEventListener("pageshow", restore);
      close();
    };
  }, []);

  return (
    <div
      className="terminal-app h-dvh w-full overflow-hidden bg-(--workspace-bg) text-(--workspace-fg)"
      data-theme={theme.ready ? theme.appearance : undefined}
      style={theme.ready ? theme.style : undefined}
    >
      {status !== "ready" || !theme.ready ? (
        null
      ) : (
        <>
          {failed && (
            <div
              role="alert"
              className="fixed top-0 right-0 left-0 z-50 border-b border-(--workspace-border) bg-(--workspace-panel) p-2 text-center text-sm text-(--workspace-fg)"
            >
              Terminal settings could not be saved. Reopening may lose recent changes.
            </div>
          )}
          <WorkspaceView theme={theme} />
        </>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { GhosttyCore } from "@wterm/ghostty";
import type { TerminalCore } from "@wterm/dom";
import { getAppClient } from "@/client/pioneer";
import type { SessionTerminalProps } from "./types";

function disposeCore(core: TerminalCore): void {
  const disposable = core as TerminalCore & { dispose?: () => void };
  disposable.dispose?.();
}

/** Load and dispose the parser independently of the connection's lifetime. */
export function useTerminalCore(
  sessionId: string,
  onStatus: SessionTerminalProps["onStatus"],
  onError: (message: string) => void,
) {
  const [core, setCore] = useState<TerminalCore | null>(null);
  useEffect(() => {
    let cancelled = false;
    onStatus(sessionId, "loading");
    getAppClient()
      .then((app) => GhosttyCore.load({ wasmPath: app.url("ghostty-vt.wasm") }))
      .then((loadedCore) => {
        if (cancelled) disposeCore(loadedCore);
        else setCore(loadedCore);
      })
      .catch(() => {
        if (!cancelled) {
          onError("Terminal engine could not be loaded. Close and reopen the App to retry.");
          onStatus(sessionId, "closed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onStatus, sessionId, onError]);

  useEffect(() => {
    return () => {
      if (core) disposeCore(core);
    };
  }, [core]);
  return core;
}

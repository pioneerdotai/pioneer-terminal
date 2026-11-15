"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  flushState,
  loadState,
  stateFailed,
  subscribeState,
} from "../lib/browser-state";
import { SessionWorkspace } from "./session-workspace";

export function GatewayWorkspace() {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const failed = useSyncExternalStore(subscribeState, stateFailed, () => false);
  useEffect(() => {
    let active = true;
    void loadState()
      .then(() => { if (active) setStatus("ready"); })
      .catch(() => { if (active) setStatus("failed"); });
    const save = () => { void flushState(); };
    document.addEventListener("visibilitychange", save);
    window.addEventListener("pagehide", save);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", save);
      window.removeEventListener("pagehide", save);
      save();
    };
  }, []);
  if (status !== "ready") return (
    <main className="p-4" role="status">
      {status === "loading" ? "Loading Terminal…" :
        "Terminal state could not be loaded. Close and reopen the App to retry."}
    </main>
  );
  return <>
    {failed && (
      <div role="alert" className="fixed top-0 right-0 left-0 z-50 bg-red-950 p-2 text-center text-sm text-white">
        Terminal state could not be saved. Reopening may lose recent output or settings.
      </div>
    )}
    <SessionWorkspace />
  </>;
}

"use client";

import { useState } from "react";
import { Check, PanelBottom, PanelRight, Maximize2, X } from "lucide-react";
import type { AppPlacement } from "@pioneercompany/app-sdk/client";
import { getAppClient } from "@/client/pioneer";
import { closeConnections } from "../session/live-connections";

const placements = [
  { placement: "bottom", label: "Move app to bottom", icon: PanelBottom },
  { placement: "right", label: "Move app to right", icon: PanelRight },
  { placement: "fullscreen", label: "Expand app", icon: Maximize2 },
] as const;

/** Pioneer opens new app views fullscreen and retains them when moved. */
export function useAppViewControls(onError: (error: string | null) => void) {
  const [placement, setPlacement] = useState<AppPlacement>("fullscreen");
  const [moving, setMoving] = useState(false);
  const [closing, setClosing] = useState(false);

  const move = async (next: AppPlacement) => {
    if (moving || closing) return false;
    setMoving(true);
    onError(null);
    try {
      const app = await getAppClient();
      await app.view.setPlacement(next);
      setPlacement(next);
      return true;
    } catch {
      onError("Could not move this app. Try again.");
      return false;
    } finally {
      setMoving(false);
    }
  };

  const close = async () => {
    if (closing) return;
    setClosing(true);
    onError(null);
    try {
      const app = await getAppClient();
      closeConnections();
      app.view.close();
    } catch {
      onError("Could not close this app. Try again.");
    } finally {
      // Closing has no acknowledgement; an unsupported host may keep the view.
      setClosing(false);
    }
  };

  return { placement, moving, closing, move, close };
}

type ViewControls = ReturnType<typeof useAppViewControls>;

export function AppPlacementControls({
  controls,
  onSelect,
}: {
  controls: ViewControls;
  onSelect: () => void;
}) {
  return (
    <div role="group" aria-label="App placement">
      {placements.map(({ placement, label, icon: Icon }) => {
        const selected = controls.placement === placement;
        return (
          <button
            key={placement}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={selected}
            disabled={controls.moving || controls.closing}
            onClick={async () => {
              if (await controls.move(placement)) onSelect();
            }}
            className={`flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-(--workspace-hover) focus-visible:outline-2 focus-visible:outline-(--workspace-focus) disabled:opacity-30 ${selected ? "bg-(--workspace-selected)" : ""}`}
          >
            <Icon size={14} aria-hidden="true" />
            <span className="flex-1">{label}</span>
            {selected && <Check size={14} aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

export function AppCloseButton({ controls }: { controls: ViewControls }) {
  return (
    <button
      type="button"
      title="Close app"
      aria-label="Close app"
      disabled={controls.closing}
      onClick={() => { void controls.close(); }}
      className="flex h-6 w-6 items-center justify-center rounded text-(--workspace-muted) hover:bg-(--workspace-hover) hover:text-(--workspace-fg) focus-visible:outline-2 focus-visible:outline-(--workspace-focus) disabled:opacity-30"
    >
      <X size={14} aria-hidden="true" />
    </button>
  );
}

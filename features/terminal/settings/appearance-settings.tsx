"use client";

import { useId, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Settings2 } from "lucide-react";
import {
  DEFAULT_APPEARANCE,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  type Appearance,
} from "./appearance";

export function AppearanceSettings({
  appearance,
  saved,
  update,
  menu,
  menuOpener,
}: {
  appearance: Appearance;
  saved: boolean;
  update: (next: Appearance) => void;
  menu: HTMLDivElement | null;
  menuOpener: RefObject<HTMLButtonElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fontSize = useRef<HTMLInputElement>(null);
  const title = useId();
  return (
    <>
      {menu &&
        createPortal(
          <button
            type="button"
            aria-haspopup="dialog"
            className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-(--workspace-hover)"
            title="Appearance"
            onClick={() => {
              menu?.hidePopover();
              dialog.current?.showModal();
              fontSize.current?.focus();
            }}
          >
            <Settings2 size={14} aria-hidden="true" />
            Appearance
          </button>,
          menu,
        )}
      <dialog
        ref={dialog}
        onClose={() => {
          if (!dialog.current?.open)
            menuOpener.current?.focus({ preventScroll: true });
        }}
        aria-labelledby={title}
        className="m-auto max-h-[calc(100vh-2rem)] w-[min(24rem,calc(100vw-2rem))] overflow-auto rounded-lg border border-(--workspace-border) bg-(--workspace-panel) p-5 text-(--workspace-fg) backdrop:bg-(--workspace-backdrop)"
      >
        <h2 id={title} className="text-base font-medium">
          Appearance
        </h2>
        <p className="mt-2 text-sm text-(--workspace-muted)">
          Colors follow the Pioneer theme. Font size applies to every terminal pane.
        </p>
        <label className="mt-5 block text-sm">
          <span className="flex justify-between gap-4">
            <span>Font size</span>
            <span>{appearance.fontSize} px</span>
          </span>
          <input
            ref={fontSize}
            type="range"
            min={MIN_FONT_SIZE}
            max={MAX_FONT_SIZE}
            step={1}
            value={appearance.fontSize}
            onChange={(event) =>
              update({
                ...appearance,
                fontSize: event.target.valueAsNumber,
              })
            }
            className="mt-3 w-full"
          />
        </label>
        <p
          role="status"
          className="mt-4 min-h-10 text-sm text-(--workspace-muted)"
        >
          {saved
            ? "Saved for this Terminal app."
            : "Changes apply now, but these settings could not be saved."}
        </p>
        <div className="mt-4 flex justify-end gap-3 text-sm">
          <button
            type="button"
            onClick={() => update({ ...DEFAULT_APPEARANCE })}
            className="rounded border border-(--workspace-border) px-3 py-2 hover:bg-(--workspace-hover)"
          >
            Reset defaults
          </button>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="rounded border border-(--workspace-border) px-3 py-2 hover:bg-(--workspace-hover)"
          >
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}

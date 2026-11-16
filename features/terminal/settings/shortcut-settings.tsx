"use client";

import { useId, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Keyboard } from "lucide-react";
import type { Shortcuts } from "./shortcuts";
import { ShortcutList } from "./shortcut-list";
import { useShortcutRecorder } from "./use-shortcut-recorder";

export function ShortcutSettings({
  shortcuts,
  saved,
  update,
  menu,
  menuOpener,
}: {
  shortcuts: Shortcuts;
  saved: boolean;
  update: (value: Shortcuts) => void;
  menu: HTMLDivElement | null;
  menuOpener: RefObject<HTMLButtonElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const recorder = useShortcutRecorder(shortcuts, update);
  const title = useId();
  const help = useId();
  const close = () => {
    dialog.current?.close();
    recorder.reset();
    menuOpener.current?.focus({ preventScroll: true });
  };
  const buttonClass =
    "rounded border border-(--workspace-border) px-3 py-2 hover:bg-(--workspace-hover) disabled:opacity-40";
  return (
    <>
      {menu &&
        createPortal(
          <button
            type="button"
            aria-haspopup="dialog"
            className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-(--workspace-hover)"
            title="Keyboard shortcuts"
            onClick={() => {
              menu?.hidePopover();
              dialog.current?.showModal();
              heading.current?.focus();
            }}
          >
            <Keyboard size={14} aria-hidden="true" />
            Keyboard shortcuts
          </button>,
          menu,
        )}
      <dialog
        ref={dialog}
        aria-labelledby={title}
        aria-describedby={help}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        {...recorder.handlers}
        className="m-auto max-h-[calc(100vh-2rem)] w-[min(42rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-(--workspace-border) bg-(--workspace-panel) p-0 text-(--workspace-fg) backdrop:bg-(--workspace-backdrop)"
      >
        <div className="flex max-h-[calc(100vh-2rem)] flex-col">
          <div className="shrink-0 px-5 pt-5">
            <h2
              ref={heading}
              tabIndex={-1}
              id={title}
              className="text-base font-medium outline-none"
            >
              Keyboard shortcuts
            </h2>
            <p id={help} className="mt-2 text-sm text-(--workspace-muted)">
              Choose Change, then press a shortcut with Control or Command.
              Escape cancels recording. Shortcuts use physical key positions and
              work from terminal input; Find and New also work from workspace
              buttons. Browser and OS shortcuts may be unavailable.
            </p>
          </div>
          <ShortcutList
            shortcuts={shortcuts}
            recorder={recorder}
            buttonClass={buttonClass}
          />
          <div className="shrink-0 border-t border-(--workspace-border) px-5 pb-5">
            <p
              role="status"
              aria-live="polite"
              className="mt-3 min-h-10 text-sm text-(--workspace-muted)"
            >
              {recorder.message}{" "}
              {saved
                ? "Saved in this browser."
                : "Changes apply now, but this browser could not save them."}
            </p>
            <div className="mt-2 flex justify-end gap-3 text-sm">
              <button
                type="button"
                className={buttonClass}
                onClick={recorder.restoreDefaults}
              >
                Reset defaults
              </button>
              <button type="button" className={buttonClass} onClick={close}>
                Close
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}

"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { BookOpen } from "lucide-react";
import type { WTerm } from "@wterm/dom";

export function OutputReader({
  terminal,
  name,
  active,
  children,
  menu,
  menuOpener,
}: {
  terminal: RefObject<WTerm | null>;
  name: string;
  active: boolean;
  children?: ReactNode;
  menu: HTMLDivElement | null;
  menuOpener: RefObject<HTMLButtonElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const capture = useRef<AbortController | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const titleId = useId();
  const helpId = useId();

  useEffect(() => () => capture.current?.abort(), []);
  useEffect(() => {
    if (!active) dialog.current?.close();
  }, [active]);
  useEffect(() => {
    if (text === null || !input.current) return;
    input.current.setSelectionRange(0, 0);
    input.current.scrollTop = 0;
    input.current.scrollLeft = 0;
  }, [text]);

  const refresh = async () => {
    capture.current?.abort();
    const request = new AbortController();
    capture.current = request;
    setBusy(true);
    setStatus("Reading output…");
    try {
      if (!terminal.current) throw new Error("Terminal is not ready");
      const value = await terminal.current.readText({
        signal: request.signal,
      });
      if (request.signal.aborted) return;
      setText(value);
      setStatus("Output ready.");
    } catch (error) {
      if (request.signal.aborted) return;
      setStatus(
        error instanceof RangeError
          ? "There is too much output to read at once."
          : error instanceof DOMException && error.name === "AbortError"
            ? "Output changed while being read. Refresh to try again."
            : "Unable to read output. Refresh to try again.",
      );
    } finally {
      if (capture.current === request && !request.signal.aborted) {
        capture.current = null;
        setBusy(false);
      }
    }
  };

  return (
    <>
      {menu &&
        createPortal(
          <div>
            <button
              type="button"
              aria-haspopup="dialog"
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-(--workspace-hover)"
              onClick={() => {
                menu?.hidePopover();
                dialog.current?.showModal();
                heading.current?.focus();
                void refresh();
              }}
            >
              <BookOpen size={14} aria-hidden="true" />
              Read output
            </button>
            {children && (
              <div className="border-t border-(--workspace-border) px-2 py-1">
                {children}
              </div>
            )}
          </div>,
          menu,
        )}
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        aria-describedby={helpId}
        className="m-auto max-h-[calc(100vh-2rem)] w-[min(56rem,calc(100vw-2rem))] overflow-auto rounded-lg border border-(--workspace-border) bg-(--workspace-panel) p-5 text-(--workspace-fg) backdrop:bg-black/70"
        onClose={() => {
          if (dialog.current?.open) return;
          capture.current?.abort();
          capture.current = null;
          setText(null);
          setBusy(false);
          setStatus("");
          if (active) menuOpener.current?.focus({ preventScroll: true });
        }}
      >
        <h2
          ref={heading}
          id={titleId}
          tabIndex={-1}
          className="text-base font-medium outline-none"
        >
          {name} output
        </h2>
        <p
          id={helpId}
          className="mt-2 text-sm/relaxed text-(--workspace-muted)"
        >
          Read and copy a snapshot of retained terminal output. New output
          appears only after Refresh. Close this view to return to the terminal.
        </p>
        <p
          role="status"
          className="my-3 min-h-5 text-sm text-(--workspace-muted)"
        >
          {status}
        </p>
        <textarea
          ref={input}
          aria-label={`${name} output text`}
          readOnly
          disabled={text === null}
          spellCheck={false}
          wrap="off"
          value={text ?? ""}
          className="block h-[min(55vh,32rem)] w-full resize-none rounded border border-(--workspace-border) bg-(--workspace-bg) p-3 font-mono text-sm/relaxed outline-none focus-visible:border-(--workspace-focus)"
        />
        <div className="mt-4 flex justify-end gap-3 text-sm">
          <button
            type="button"
            disabled={busy}
            onClick={() => void refresh()}
            className="rounded border border-(--workspace-border) px-3 py-2 hover:bg-(--workspace-hover) disabled:opacity-40"
          >
            Refresh
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

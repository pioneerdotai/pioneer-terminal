"use client";

import {
  useCallback,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import type { WTerm } from "@wterm/dom";
import type { ClipboardWriteRequest } from "./clipboard-request";

export function useTerminalClipboard(
  terminalRef: RefObject<WTerm | null>,
) {
  const [copyStatus, setCopyStatus] = useState("");
  const handleCopyKey = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (
      event.defaultPrevented ||
      !event.nativeEvent.isTrusted ||
      event.nativeEvent.isComposing ||
      event.altKey ||
      !(event.metaKey || event.ctrlKey) ||
      !(event.code === "KeyC" || event.key.toLowerCase() === "c")
    ) return;
    const terminal = terminalRef.current;
    if (
      !terminal ||
      !(event.target instanceof Node) ||
      !terminal.element.contains(event.target)
    ) return;
    const text = terminal.getSelectionText();
    if (!text) return; // No selection: Ctrl-C remains shell interruption.
    event.preventDefault();
    event.stopPropagation();
    const document = terminal.element.ownerDocument;
    let copied = false;
    const writeSelection = (copy: ClipboardEvent) => {
      if (!copy.clipboardData) return;
      copy.clipboardData.setData("text/plain", text);
      copy.preventDefault();
      copied = true;
    };
    // Supply the terminal's cell-accurate selection during the trusted copy
    // gesture. execCommand may return false for custom selection even after
    // its copy event was handled, so observe the event rather than its return.
    document.addEventListener("copy", writeSelection, true);
    try {
      document.execCommand("copy");
      if (!copied) throw new Error("Copy unavailable");
      setCopyStatus("");
    } catch {
      setCopyStatus("Copy failed. Try the desktop Edit → Copy action.");
    } finally {
      document.removeEventListener("copy", writeSelection, true);
    }
  }, [terminalRef]);

  const [clipboardRequest, setClipboardRequest] =
    useState<ClipboardWriteRequest | null>(null);
  const handleClipboardWrite = useCallback((text: string) => {
    setClipboardRequest({ text });
  }, []);

  return {
    copyStatus,
    handleCopyKey,
    clipboardRequest,
    setClipboardRequest,
    handleClipboardWrite,
  };
}

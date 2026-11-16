"use client";

import { useCallback } from "react";

/** Native arrow characters are not text; WTerm encodes the keydown separately. */
export function useTerminalTextInputGuard() {
  return useCallback((root: HTMLDivElement | null) => {
    if (!root) return;

    const guard = (event: Event) => {
      const input = event as InputEvent;
      const target = input.target;
      if (
        input.isComposing ||
        input.inputType !== "insertText" ||
        !/^[\u001c-\u001f]$/.test(input.data ?? "") ||
        !(target instanceof HTMLTextAreaElement) ||
        !target.closest(".local-terminal")
      ) return;

      if (event.type === "beforeinput") {
        if (event.cancelable) event.preventDefault();
        return;
      }

      // Some native input events cannot be canceled before insertion. Clear
      // their control text before WTerm's input listener reads the textarea.
      target.value = target.value.replace(/[\u001c-\u001f]/g, "");
      event.stopImmediatePropagation();
    };

    root.addEventListener("beforeinput", guard, true);
    root.addEventListener("input", guard, true);
    return () => {
      root.removeEventListener("beforeinput", guard, true);
      root.removeEventListener("input", guard, true);
    };
  }, []);
}

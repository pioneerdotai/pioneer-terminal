"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import {
  COMMANDS,
  DEFAULT_SHORTCUTS,
  bindingError,
  conflictingCommand,
  eventBinding,
  formatBinding,
  type Command,
  type Shortcuts,
} from "./shortcuts";

export function useShortcutRecorder(shortcuts: Shortcuts, update: (next: Shortcuts) => void) {
  const composing = useRef(false);
  const [recording, setRecording] = useState<Command | null>(null);
  const [message, setMessage] = useState("");
  const reset = () => {
    composing.current = false;
    setRecording(null);
    setMessage("");
  };
  const keyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (!recording) return;
    if (event.key === "Tab") {
      setRecording(null);
      setMessage("");
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setRecording(null);
      setMessage("Shortcut change canceled.");
      return;
    }
    if (event.repeat || composing.current) return;
    const binding = eventBinding(event.nativeEvent);
    if (!binding) return;
    const error = bindingError(binding);
    const conflict = conflictingCommand(shortcuts, recording, binding);
    if (error || conflict) {
      setMessage(error ??
        `Already assigned to ${COMMANDS.find(({ id }) => id === conflict)!.label}. Clear that binding first.`);
      return;
    }
    update({ ...shortcuts, [recording]: [binding] });
    setMessage(`${COMMANDS.find(({ id }) => id === recording)!.label}: ${formatBinding(binding)}.`);
    setRecording(null);
  };
  return {
    recording,
    message,
    reset,
    handlers: {
      onCompositionStartCapture: () => { composing.current = true; },
      onCompositionEndCapture: () => { composing.current = false; },
      onKeyDownCapture: keyDown,
    },
    record(id: Command, label: string) {
      setRecording(id);
      setMessage(`Recording ${label}. Press Escape to cancel.`);
    },
    cancel(id: Command) {
      if (recording === id) {
        setRecording(null);
        setMessage("Shortcut change canceled.");
      }
    },
    clear(id: Command, label: string) {
      update({ ...shortcuts, [id]: [] });
      setRecording(null);
      setMessage(`${label}: shortcut cleared.`);
    },
    restoreDefaults() {
      update(DEFAULT_SHORTCUTS);
      setRecording(null);
      setMessage("Default shortcuts restored.");
    },
  };
}

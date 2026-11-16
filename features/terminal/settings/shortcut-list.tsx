"use client";

import { COMMANDS, formatBinding, type Shortcuts } from "./shortcuts";
import type { useShortcutRecorder } from "./use-shortcut-recorder";

type ShortcutListProps = {
  shortcuts: Shortcuts;
  recorder: ReturnType<typeof useShortcutRecorder>;
  buttonClass: string;
};

export function ShortcutList({ shortcuts, recorder, buttonClass }: ShortcutListProps) {
  return (
    <ul className="mt-4 min-h-0 divide-y divide-(--workspace-border) overflow-y-auto px-5">
      {COMMANDS.map(({ id, label }) => (
        <li key={id} className="flex flex-wrap items-center gap-2 py-3 text-sm">
          <div className="min-w-0 flex-1 basis-56">
            <span className="block">{label}</span>
            <span className="mt-1 block text-xs text-(--workspace-muted)">
              {recorder.recording === id
                ? "Press a shortcut…"
                : shortcuts[id].map(formatBinding).join(" or ") || "Not assigned"}
            </span>
          </div>
          <button
            type="button"
            aria-label={`Change shortcut for ${label}`}
            aria-pressed={recorder.recording === id}
            className={buttonClass}
            onClick={() => recorder.record(id, label)}
            onBlur={() => recorder.cancel(id)}
          >
            Change
          </button>
          <button
            type="button"
            aria-label={`Clear shortcut for ${label}`}
            disabled={!shortcuts[id].length}
            className={buttonClass}
            onClick={() => recorder.clear(id, label)}
          >
            Clear
          </button>
        </li>
      ))}
    </ul>
  );
}

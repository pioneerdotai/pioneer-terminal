"use client";

import { createPortal } from "react-dom";
import type { RefObject } from "react";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import type { WTerm } from "@wterm/dom";
import { ariaShortcuts, shortcutTitle } from "../settings/shortcuts";
import { OutputReader } from "./output-reader";
import type { SessionTerminalProps } from "./types";

type TerminalToolsProps = Pick<
  SessionTerminalProps,
  "session" | "shortcuts" | "active" | "visible" | "toolsHost" | "actionsMenu" | "actionsOpener"
> & {
  ready: boolean;
  terminalRef: RefObject<WTerm | null>;
  openFind: () => void;
  navigatePrompt: (direction: -1 | 1) => void;
};

export function TerminalTools({
  session,
  shortcuts,
  active,
  visible,
  toolsHost,
  actionsMenu,
  actionsOpener,
  ready,
  terminalRef,
  openFind,
  navigatePrompt,
}: TerminalToolsProps) {
  if (!active || !toolsHost) return null;
  return createPortal(
    <>
      <button
        type="button"
        onClick={openFind}
        aria-label="Find"
        title={shortcutTitle(shortcuts, "find", "Find in terminal")}
        aria-keyshortcuts={ariaShortcuts(shortcuts, "find")}
        className="flex h-6 w-6 items-center justify-center rounded text-(--workspace-muted) hover:bg-(--workspace-hover) hover:text-(--workspace-fg)"
      >
        <Search size={14} aria-hidden="true" />
      </button>
      <OutputReader
        terminal={terminalRef}
        name={session.name}
        active={active && visible}
        menu={actionsMenu}
        menuOpener={actionsOpener}
      >
        {session.shell && session.shell.phase !== "unknown" && (
          <div role="group" aria-label="Prompt navigation">
            {([-1, 1] as const).map((direction) => {
              const command = direction < 0 ? "previousPrompt" : "nextPrompt";
              const label = direction < 0 ? "Previous prompt" : "Next prompt";
              const Icon = direction < 0 ? ArrowUp : ArrowDown;
              return (
                <button
                  key={direction}
                  type="button"
                  aria-label={label}
                  title={shortcutTitle(shortcuts, command, label)}
                  aria-keyshortcuts={active ? ariaShortcuts(shortcuts, command) : undefined}
                  disabled={!ready}
                  className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-(--workspace-hover) disabled:opacity-30"
                  onClick={() => {
                    actionsMenu?.hidePopover();
                    navigatePrompt(direction);
                  }}
                >
                  <Icon size={14} aria-hidden="true" />
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </OutputReader>
    </>,
    toolsHost,
  );
}

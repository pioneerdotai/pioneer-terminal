"use client";

import type { RefObject } from "react";
import type { WTerm } from "@wterm/dom";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import type { useTerminalNavigation } from "./use-terminal-navigation";

type TerminalFindBarProps = {
  navigation: ReturnType<typeof useTerminalNavigation>;
  terminal: RefObject<WTerm | null>;
};

export function TerminalFindBar({
  navigation,
  terminal: terminalRef,
}: TerminalFindBarProps) {
  const {
    findOpen,
    closeFind,
    findInputRef,
    query,
    setQuery,
    caseSensitive,
    setCaseSensitive,
    searchState,
  } = navigation;
  if (!findOpen) return null;
  return (
    <div
      className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-(--workspace-border) p-2 text-xs"
      role="search"
      aria-label="Terminal output"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          closeFind();
        }
        if (event.key === "Enter") {
          event.preventDefault();
          if (event.shiftKey) terminalRef.current?.findPrevious();
          else terminalRef.current?.findNext();
        }
      }}
    >
      <input
        ref={findInputRef}
        type="text"
        aria-label="Find in terminal"
        placeholder="Find in terminal…"
        maxLength={1024}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="min-w-0 flex-1 rounded border border-(--workspace-border) bg-(--workspace-bg) px-2 py-1 outline-none focus:border-(--workspace-focus)"
      />
      <span
        className="whitespace-nowrap text-(--workspace-muted)"
        role="status"
        aria-live="polite"
      >
        {!query
          ? ""
          : searchState?.searching
            ? "Searching…"
            : searchState?.count
              ? `${searchState.activeIndex + 1} of ${searchState.count}${searchState.limited ? "+" : ""}`
              : "No matches"}
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          aria-label="Match case"
          aria-pressed={caseSensitive}
          title="Match case"
          onClick={() => setCaseSensitive((value) => !value)}
          className={`rounded flex items-center justify-center w-6 h-6 ${caseSensitive ? "bg-(--workspace-selected) text-(--workspace-fg)" : "text-(--workspace-muted) hover:bg-(--workspace-hover)"}`}
        >
          Aa
        </button>
        <button
          type="button"
          aria-label="Previous match"
          title="Previous match (Shift+Enter)"
          disabled={!searchState?.count}
          className="rounded flex items-center justify-center w-6 h-6 text-(--workspace-muted) hover:bg-(--workspace-hover) hover:text-(--workspace-fg) disabled:opacity-30"
          onClick={() => terminalRef.current?.findPrevious()}
        >
          <ArrowUp size={14} />
        </button>
        <button
          type="button"
          aria-label="Next match"
          title="Next match (Enter)"
          disabled={!searchState?.count}
          className="rounded flex items-center justify-center w-6 h-6 text-(--workspace-muted) hover:bg-(--workspace-hover) hover:text-(--workspace-fg) disabled:opacity-30"
          onClick={() => terminalRef.current?.findNext()}
        >
          <ArrowDown size={14} />
        </button>
        <button
          type="button"
          aria-label="Close find"
          title="Close find (Escape)"
          className="rounded flex items-center justify-center w-6 h-6 text-(--workspace-muted) hover:bg-(--workspace-hover) hover:text-(--workspace-fg)"
          onClick={closeFind}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

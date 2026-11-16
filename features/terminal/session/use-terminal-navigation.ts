"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { SearchState, WTerm } from "@wterm/dom";
import type { SessionTerminalProps } from "./types";

type NavigationOptions = Pick<
  SessionTerminalProps,
  "registerFind" | "registerPrompt"
> & {
  sessionId: string;
  terminal: RefObject<WTerm | null>;
};

export function useTerminalNavigation({
  sessionId,
  terminal: terminalRef,
  registerFind,
  registerPrompt,
}: NavigationOptions) {
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [searchState, setSearchState] = useState<SearchState | null>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const openFind = useCallback(() => {
    setFindOpen(true);
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, []);

  const closeFind = () => {
    setFindOpen(false);
    terminalRef.current?.clearSearch();
    terminalRef.current?.focus();
  };

  useLayoutEffect(
    () => registerFind(sessionId, openFind),
    [registerFind, sessionId, openFind],
  );

  const navigatePrompt = useCallback(
    (direction: -1 | 1) => {
      terminalRef.current?.scrollToPrompt(direction);
    },
    [terminalRef],
  );
  useLayoutEffect(
    () => registerPrompt(sessionId, navigatePrompt),
    [registerPrompt, sessionId, navigatePrompt],
  );

  useEffect(() => {
    if (findOpen) terminalRef.current?.search(query, { caseSensitive });
  }, [query, caseSensitive, findOpen, terminalRef]);

  return {
    findOpen,
    openFind,
    closeFind,
    navigatePrompt,
    query,
    setQuery,
    caseSensitive,
    setCaseSensitive,
    searchState,
    setSearchState,
    findInputRef,
  };
}

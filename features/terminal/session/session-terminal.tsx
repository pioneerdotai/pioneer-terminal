"use client";

import type { CSSProperties } from "react";
import { Terminal as WTermTerminal } from "@wterm/react";
import { ClipboardRequest } from "./clipboard-request";
import { TerminalTools } from "./terminal-tools";
import { TerminalFindBar } from "./terminal-find-bar";
import { CopyNotice, ConnectionNotices } from "./terminal-notices";
import { useSessionTerminal } from "./use-session-terminal";
import { useTerminalTextInputGuard } from "./use-terminal-text-input-guard";
import type { SessionTerminalProps } from "./types";

export function SessionTerminal(props: SessionTerminalProps) {
  const inputGuard = useTerminalTextInputGuard();
  const {
    session,
    shortcuts,
    active,
    visible,
    toolsHost,
    actionsMenu,
    actionsOpener,
    debugEnabled,
    fontSize,
    onShell,
    onDirectory,
  } = props;
  const {
    core,
    ready,
    ref,
    terminalRef,
    handleReady,
    handleData,
    handleResize,
    navigation,
    clipboard,
    connectionMessage,
    reconnected,
    lostInput,
    dismissReconnect,
  } = useSessionTerminal(props);
  const {
    copyStatus,
    handleCopyKey,
    clipboardRequest,
    setClipboardRequest,
    handleClipboardWrite,
  } = clipboard;

  if (!core) {
    return null;
  }

  return (
    <div
      ref={inputGuard}
      className="flex h-full min-h-0 flex-col"
      onKeyDownCapture={handleCopyKey}
    >
      <CopyNotice copyStatus={copyStatus} />
      <TerminalTools
        session={session}
        shortcuts={shortcuts}
        active={active}
        visible={visible}
        toolsHost={toolsHost}
        actionsMenu={actionsMenu}
        actionsOpener={actionsOpener}
        ready={ready}
        terminalRef={terminalRef}
        openFind={navigation.openFind}
        navigatePrompt={navigation.navigatePrompt}
      />
      <TerminalFindBar navigation={navigation} terminal={terminalRef} />
      <ConnectionNotices
        reconnected={reconnected}
        lostInput={lostInput}
        connectionMessage={connectionMessage}
        onDismiss={dismissReconnect}
      />
      <ClipboardRequest
        request={clipboardRequest}
        dismiss={(request) =>
          setClipboardRequest((current) =>
            current === request ? null : current,
          )
        }
        terminal={terminalRef}
        name={session.name}
        active={visible}
      />
      <div className="min-h-0 flex-1" inert={!ready}>
        <WTermTerminal
          ref={ref}
          renderingPaused={!visible || !ready}
          cols={80}
          rows={24}
          autoResize
          debug={debugEnabled}
          maxImageWidth={640}
          maxImageHeight={480}
          core={core}
          webmcp={{
            name: session.name,
            description: "Local shell on this machine",
          }}
          onReady={handleReady}
          onData={handleData}
          onShellIntegration={(state) => onShell(session.id, state)}
          onWorkingDirectory={(uri) => onDirectory(session.id, uri)}
          onClipboardWrite={handleClipboardWrite}
          onResize={handleResize}
          aria-label={session.name}
          tabIndex={visible ? 0 : -1}
          className="local-terminal size-full"
          style={
            {
              borderRadius: 0,
              boxShadow: "none",
              padding: 4,
              "--term-font-size": `${fontSize}px`,
              "--term-row-height": `${Math.ceil(fontSize * 1.2)}px`,
            } as CSSProperties
          }
        />
      </div>
    </div>
  );
}

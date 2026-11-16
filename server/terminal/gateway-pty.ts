import {
  PioneerError,
  type AppServerContext,
  type OutputFrame,
  type OutputSubscription,
} from "@pioneercompany/app-sdk/server";
import type { SpawnPty, TerminalSize } from "./types";

const HOST_MESSAGES: Record<string, string> = {
  "host.output_cursor_expired": "Output was lost while disconnected. Close this terminal and open a new one.",
  "host.revoked": "This App execution has ended. Reopen the App to connect to its current execution.",
  "host.session_expired": "This host session expired. Open a new terminal.",
  "host.session_unavailable": "This host session is no longer available. Open a new terminal.",
  "host.capacity": "Gateway's terminal session limit was reached. Close an unused terminal.",
  "host.input_outcome_unknown": "Input delivery could not be confirmed. It will not be sent again.",
  "host.input_backpressure": "Gateway's input queue is full. Input was not accepted.",
  "host.pty_unsupported_platform": "Host terminals are not supported on this Gateway platform.",
  "host.utf8_locale_unavailable": "Gateway could not find an installed UTF-8 locale for this terminal.",
  "sdk.capability_unavailable": "Host terminal service is unavailable on this Gateway.",
  "sdk.delivery_unknown": "The host operation could not be confirmed. Reopen this terminal to try again.",
  "sdk.input_blocked": "Input delivery could not be confirmed. Open a new terminal.",
  "sdk.lease_unconfirmed": "The host session could not be kept alive. Open a new terminal.",
};
export class HostError extends Error {}
const dimensions = (size: TerminalSize) => ({
  cols: size.cols, rows: size.rows, pixelWidth: size.width, pixelHeight: size.height,
});
const sameSize = (a: TerminalSize, b: TerminalSize) =>
  a.rows === b.rows && a.cols === b.cols && a.width === b.width && a.height === b.height;

/** Adapts SDK-owned PTYs to Terminal's browser-session/output owner. */
export class GatewayHost {
  constructor(private app: AppServerContext) {}

  close(): Promise<void> { return this.app.close(); }

  readonly spawn: SpawnPty = (size, events) => {
    let stopped = false, paused = false, draining = false, resizing = false;
    let cursor = 0, stream = "", queuedBytes = 0;
    let frames: OutputFrame[] = [];
    let subscription: OutputSubscription | undefined;
    let desiredSize = size, appliedSize = size;
    const cancellation = new AbortController();
    // Do not cancel an in-flight create: retain its eventual handle for cleanup.
    const ready = this.app.host.pty.create(dimensions(size));
    const dispose = (kill: boolean) => {
      void kill; // Both close and process completion release this owned PTY.
      if (stopped) return;
      stopped = true;
      cancellation.abort();
      subscription?.dispose();
      frames = []; queuedBytes = 0;
      void ready.then(terminal => terminal.close().catch(() => {
        // The context retains unsuccessful closes and reports cleanup_incomplete.
        console.error("Terminal PTY cleanup could not be confirmed.");
      }), () => {});
    };
    const fail = (error: unknown) => {
      if (stopped) return;
      const message = error instanceof HostError ? error.message :
        error instanceof PioneerError ? HOST_MESSAGES[error.code] ?? "Gateway Host API is unavailable. Reopen this terminal to try again." :
        "Gateway Host API is unavailable. Reopen this terminal to try again.";
      events.data(`\r\n${message}\r\n`);
      dispose(true);
      events.exit();
    };
    const drain = () => {
      if (draining) return;
      draining = true;
      try {
        while (!paused && !stopped && frames.length) {
          const frame = frames.shift()!;
          queuedBytes -= frame.bytes.length;
          if (frame.after > cursor) { fail(new HostError("Host output has a cursor gap.")); return; }
          const skip = Math.min(frame.bytes.length, cursor - frame.after);
          if (skip < frame.bytes.length) events.data(frame.bytes.subarray(skip));
          if (stopped) return;
          cursor = Math.max(cursor, frame.next);
          // Acceptance by Terminal's bounded output owner is the upstream ACK
          // boundary. Browser consumption has its own existing credit window.
          void frame.ack().catch(error => {
            if (stopped) return;
            if (error instanceof PioneerError &&
                ["sdk.stale_receipt", "sdk.delivery_unknown", "sdk.disconnected"].includes(error.code)) {
              // SDK fences these receipts and restores its stream. Discard its
              // old queued frames; replay is deduplicated against cursor above.
              if (stream === frame.streamId) { stream = ""; frames = []; queuedBytes = 0; }
              return;
            }
            fail(error);
          });
          if (frame.failed) { fail(new HostError("Host PTY supervision failed.")); return; }
          if (frame.exitStatus !== null && cursor === frame.end) {
            events.data(`\r\nProcess exited with status ${frame.exitStatus}.\r\n`);
            dispose(false); events.exit(); return;
          }
        }
      } finally { draining = false; }
    };
    const receive = (frame: OutputFrame) => {
      if (stopped) return;
      if (frame.streamId !== stream) { stream = frame.streamId; frames = []; queuedBytes = 0; }
      if (frame.failed) { fail(new HostError("Host PTY supervision failed.")); return; }
      if (queuedBytes + frame.bytes.length > 65536 || frames.length >= 66) {
        fail(new HostError("Host output window exceeded.")); return;
      }
      frames.push(frame); queuedBytes += frame.bytes.length;
      drain();
    };
    const flushResize = async () => {
      if (stopped || resizing) return;
      resizing = true;
      try {
        const terminal = await ready;
        while (!stopped && !sameSize(desiredSize, appliedSize)) {
          const next = desiredSize;
          await terminal.resize(dimensions(next));
          appliedSize = next;
        }
      } catch (error) { fail(error); }
      finally { resizing = false; }
    };
    void ready.then(async terminal => {
      if (stopped) return;
      events.cwd("Gateway shell");
      void flushResize();
      const opened = await terminal.subscribe({
        signal: cancellation.signal, onOutput: receive, onError: fail,
      });
      if (stopped) opened.dispose(); else subscription = opened;
    }).catch(fail);
    return {
      write: async data => {
        try {
          const terminal = await ready;
          if (stopped) throw new HostError("Host session ended.");
          await terminal.write(data);
        } catch (error) { fail(error); throw error; }
      },
      resize: next => { desiredSize = next; void flushResize(); },
      pause: () => { paused = true; },
      resume: () => { paused = false; drain(); },
      dispose,
    };
  };
}

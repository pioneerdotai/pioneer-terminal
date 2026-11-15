import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import type { SpawnPty, TerminalSize } from "./terminal-sessions";

export interface AppBootstrap {
  execution_id: string;
  ui_proxy: { credential: string };
  host_api: { endpoint: string; credential: string; capabilities: string[] } | null;
}
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
};
export class HostError extends Error {}
interface OutputFrame {
  stream_id: string;
  after: number;
  bytes: number[];
  next: number;
  end: number;
  exit_status: number | null;
  failed: boolean;
  error?: string;
}
const id = () => randomBytes(16).toString("base64url").slice(0, 21);
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One backend-only connection, shared by this App's terminal sessions. */
export class GatewayHost {
  private socket: WebSocket | null = null;
  private opening: Promise<WebSocket> | null = null;
  private stopped = false;
  private listeners = new Set<() => void>();
  private streams = new Map<string, (frame: OutputFrame) => void>();
  private pending = new Map<string, { socket: WebSocket; resolve(value: unknown): void; reject(error: Error): void }>();

  constructor(private bootstrap: AppBootstrap) {}
  private connect(): Promise<WebSocket> {
    if (this.stopped) return Promise.reject(new HostError("Host connection stopped."));
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve(this.socket);
    if (this.opening) return this.opening;
    const host = this.bootstrap.host_api;
    if (!host?.capabilities.includes("host.pty")) return Promise.reject(new HostError("Host terminal service is unavailable on this Gateway."));
    const opening = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(host.endpoint, { headers: { Authorization: `Bearer ${host.credential}` }, maxPayload: 128 * 1024, handshakeTimeout: 10_000 });
      this.socket = socket;
      socket.once("open", () => {
        resolve(socket);
        for (const listener of this.listeners) listener();
      });
      socket.on("message", (raw) => {
        if (this.socket !== socket) return;
        try {
          const message = JSON.parse(raw.toString());
          if (message.jsonrpc !== "2.0") throw new Error();
          if (typeof message.id === "string") {
            const call = this.pending.get(message.id);
            if (call) {
              this.pending.delete(message.id);
              if (message.error) call.reject(new HostError(HOST_MESSAGES[message.error.message] ?? "Gateway rejected the host terminal operation."));
              else call.resolve(message.result);
            }
          } else if (message.method === "host.pty.output") {
            const params = message.params;
            if (!params || typeof params.session_id !== "string") throw new Error();
            this.streams.get(params.session_id)?.(params);
          }
        } catch { socket.terminate(); }
      });
      const disconnected = () => {
        const current = this.socket === socket;
        if (current) this.socket = null;
        reject(new Error("Host connection unavailable."));
        // An old socket can close after its replacement was selected. Settle
        // only that socket's RPCs, including their timers, without rejecting
        // requests already submitted on the replacement.
        for (const [requestId, call] of this.pending) {
          if (call.socket !== socket) continue;
          this.pending.delete(requestId);
          call.reject(new Error("Host connection interrupted."));
        }
        // A watch reopens from its delivered cursor even when no keyboard input
        // arrives. queueMicrotask lets the failed opening promise settle first.
        queueMicrotask(() => { if (current && !this.stopped) for (const listener of this.listeners) listener(); });
      };
      socket.on("error", () => { disconnected(); socket.terminate(); });
      socket.on("close", disconnected);
    });
    const tracked = opening.finally(() => { if (this.opening === tracked) this.opening = null; });
    this.opening = tracked;
    return tracked;
  }
  private request<T>(socket: WebSocket, method: string, params: object): Promise<T> {
    if (this.stopped || this.socket !== socket || socket.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error("Host connection unavailable."));
    if (this.pending.size >= 128)
      return Promise.reject(new HostError("Host request capacity exceeded."));
    const requestId = id();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        socket.terminate();
        reject(new Error("Host request timed out."));
      }, 10_000);
      const finish = () => clearTimeout(timer);
      this.pending.set(requestId, {
        socket,
        resolve: (value) => { finish(); resolve(value as T); },
        reject: (error) => { finish(); reject(error); },
      });
      const sendFailed = () => {
        const call = this.pending.get(requestId);
        this.pending.delete(requestId);
        call?.reject(new Error("Host send failed."));
        socket.terminate();
      };
      try {
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }), (error) => {
          if (error) sendFailed();
        });
      } catch { sendFailed(); }
    });
  }
  async call<T>(method: string, params: object, retry = true): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        const socket = await this.connect();
        return await this.request<T>(socket, method, params);
      } catch (error) {
        if (error instanceof HostError || !retry || attempt >= 1 || this.stopped) throw error;
        await delay(250);
      }
    }
  }
  close() {
    this.stopped = true;
    this.socket?.terminate();
    for (const call of this.pending.values()) call.reject(new HostError("Host connection stopped."));
    this.pending.clear();
    this.listeners.clear();
    this.streams.clear();
  }
  readonly spawn: SpawnPty = (size, events) => {
    const key = id();
    const dimensions = (s: TerminalSize) => ({ rows: s.rows, cols: s.cols, pixel_width: s.width, pixel_height: s.height });
    const sameSize = (a: TerminalSize, b: TerminalSize) => a.rows === b.rows && a.cols === b.cols && a.width === b.width && a.height === b.height;
    let stopped = false, paused = false, watching = false, acking = false;
    let resizing = false, keepingAlive = false;
    let streamSocket: WebSocket | null = null;
    let cursor = 0, sequence = 0, acknowledged = 0, streamId = "", sessionId = "";
    let queuedBytes = 0;
    let frames: OutputFrame[] = [];
    let desiredSize = size, appliedSize = size;
    const ready = this.call<{ session_id: string; input_sequence: number }>("host.pty.create", {
      key, dimensions: dimensions(size),
    }).then((result) => {
      sessionId = result.session_id;
      sequence = result.input_sequence;
      if (!stopped) this.streams.set(sessionId, receive);
      return result;
    });
    const fail = (error: unknown) => {
      if (stopped) return;
      events.data(`\r\n${error instanceof HostError ? error.message : "Gateway Host API is unavailable. Reopen this terminal to try again."}\r\n`);
      dispose(true);
      events.exit();
    };
    const acknowledge = async () => {
      const socket = streamSocket;
      if (stopped || paused || acking || !streamId || cursor <= acknowledged || !socket || socket !== this.socket || socket.readyState !== WebSocket.OPEN) return;
      acking = true;
      const stream = streamId, after = cursor;
      try {
        const result = await this.request<{ acknowledged: boolean }>(socket, "host.pty.ack", { session_id: sessionId, stream_id: stream, after });
        if (streamId === stream && streamSocket === socket) {
          if (result.acknowledged) acknowledged = Math.max(acknowledged, after);
          else { streamSocket = null; void watch(); }
        }
      } catch (error) {
        if (error instanceof HostError) fail(error);
        else { if (streamSocket === socket) streamSocket = null; void watch(); }
      }
      finally {
        acking = false;
        if (!stopped && !paused && cursor > acknowledged) void acknowledge();
      }
    };
    const drain = () => {
      while (!paused && !stopped && frames.length) {
        const frame = frames.shift()!;
        queuedBytes -= frame.bytes.length;
        if (frame.after > cursor) { fail(new HostError("Host output has a cursor gap.")); return; }
        const skip = Math.min(frame.bytes.length, cursor - frame.after);
        if (skip < frame.bytes.length) events.data(Uint8Array.from(frame.bytes.slice(skip)));
        cursor = Math.max(cursor, frame.next);
        if (frame.failed) { fail(new HostError("Host PTY supervision failed.")); return; }
        if (frame.exit_status !== null && cursor === frame.end) {
          events.data(`\r\nProcess exited with status ${frame.exit_status}.\r\n`);
          dispose(false); events.exit(); return;
        }
      }
      void acknowledge();
    };
    const receive = (frame: OutputFrame) => {
      if (stopped || frame.stream_id !== streamId) return;
      if (frame.error) { fail(new HostError(HOST_MESSAGES[frame.error] ?? "Host output is unavailable.")); return; }
      if (!Number.isSafeInteger(frame.after) || frame.after < 0 || !Array.isArray(frame.bytes) || frame.bytes.length > 16384 || !frame.bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255) || frame.next !== frame.after + frame.bytes.length || !Number.isSafeInteger(frame.end) || frame.end < frame.next || typeof frame.failed !== "boolean" || !(frame.exit_status === null || (Number.isInteger(frame.exit_status) && frame.exit_status >= 0))) {
        fail(new HostError("Invalid Host API output.")); return;
      }
      if (frame.failed) { fail(new HostError("Host PTY supervision failed.")); return; }
      if (queuedBytes + frame.bytes.length > 64 * 1024 || frames.length >= 66) { fail(new HostError("Host output window exceeded.")); return; }
      queuedBytes += frame.bytes.length;
      frames.push(frame);
      drain();
    };
    const watch = async () => {
      if (stopped || watching) return;
      watching = true;
      try {
        await ready;
        for (let attempt = 0; !stopped; attempt++) {
          // Replacement subscriptions start at bytes already handed to the App
          // output owner. Unconsumed frames are replayed, never silently skipped.
          try {
            const socket = await this.connect();
            if (streamSocket === socket) break;
            frames = []; queuedBytes = 0;
            streamSocket = null;
            streamId = id(); acknowledged = cursor;
            await this.request(socket, "host.pty.subscribe", { session_id: sessionId, stream_id: streamId, after: cursor });
            if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) throw new Error("Host connection interrupted.");
            streamSocket = socket;
            void acknowledge();
            break;
          } catch (error) {
            if (error instanceof HostError || attempt >= 1 || this.stopped) throw error;
            await delay(250);
          }
        }
      } catch (error) { fail(error); }
      finally {
        watching = false;
        if (!stopped && !this.stopped && (this.socket?.readyState !== WebSocket.OPEN || streamSocket !== this.socket)) queueMicrotask(() => { void watch(); });
      }
    };
    const flushResize = async () => {
      if (stopped || resizing) return;
      resizing = true;
      try {
        await ready;
        while (!stopped && !sameSize(desiredSize, appliedSize)) {
          const next = desiredSize;
          await this.call("host.pty.resize", { session_id: sessionId, dimensions: dimensions(next) });
          appliedSize = next;
        }
      } catch (error) { fail(error); }
      finally { resizing = false; }
    };
    const reconnect = () => { void watch(); };
    this.listeners.add(reconnect);
    // This heartbeat retains an idle/paused session's explicit five-minute
    // lease and detects silent transport failures; it never reads output or DB.
    const heartbeat = setInterval(() => {
      if (stopped || keepingAlive) return;
      keepingAlive = true;
      void ready.then(() => { if (!stopped) return this.call("host.pty.keepalive", { session_id: sessionId }); })
        .catch(fail).finally(() => { keepingAlive = false; });
    }, 10_000);
    heartbeat.unref();
    const dispose = (kill: boolean) => {
      void kill;
      if (stopped) return;
      stopped = true; clearInterval(heartbeat);
      this.listeners.delete(reconnect);
      this.streams.delete(sessionId);
      frames = []; queuedBytes = 0;
      streamSocket = null;
      void ready.then(({ session_id }) => this.call("host.pty.close", { session_id })).catch(() => {});
    };
    void ready.then(() => {
      if (stopped) return;
      events.cwd("Gateway shell");
      void flushResize();
      void watch();
    }).catch(fail);
    return {
      write: async (data) => {
        await ready;
        if (stopped) throw new HostError("Host session ended.");
        const bytes = Array.from(Buffer.from(data));
        if (!bytes.length) return;
        if (bytes.length > 16384) throw new HostError("Input exceeds the Host API limit.");
        // Assign before awaiting the RPC so the bounded input window can carry
        // distinct ordered writes concurrently. Retries keep this exact pair.
        const next = ++sequence;
        try {
          const result = await this.call<{ accepted_sequence: number }>("host.pty.input", { session_id: sessionId, sequence: next, bytes });
          if (result.accepted_sequence !== next) throw new HostError("Host input acknowledgement is invalid.");
        } catch (error) { fail(error); throw error; }
      },
      resize: (next) => {
        desiredSize = next;
        void flushResize();
      },
      pause: () => { paused = true; },
      resume: () => { paused = false; drain(); },
      dispose,
    };
  };
}

import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import { PtyOutput } from "./pty-output";
import {
  CONTROL_RESERVE,
  HANDSHAKE_MS,
  INPUT_LIMIT,
  INPUT_MESSAGES,
  OUTPUT_WINDOW,
  SESSION_GRACE_MS,
  SESSION_LIMIT,
  isResize,
  type ClientMessage,
} from "./terminal-protocol";

export type TerminalSize = Extract<ClientMessage, { type: "resize" }>;
export interface SessionPty {
  write(data: string): void | Promise<void>;
  resize(size: TerminalSize): void;
  pause(): void;
  resume(): void;
  dispose(kill: boolean): void;
}
export type SpawnPty = (
  size: TerminalSize,
  events: {
    data(data: string | Uint8Array): void;
    exit(): void;
    cwd(path: string): void;
  },
) => SessionPty;

class TerminalSession {
  readonly token = randomBytes(32).toString("hex");
  private socket: WebSocket | null = null;
  private attachmentReady = false;
  private process: SessionPty | null = null;
  private started = false;
  private exited = false;
  private stopped = false;
  private cwd: string | null = null;
  private sentCwd: string | null = null;
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private acceptedInput = 0;
  private submittedInput = 0;
  private inputWindow: Promise<void>[] = [];
  private sentInputAck = 0;
  private inputAckTimer: ReturnType<typeof setTimeout> | null = null;
  private output: PtyOutput;
  private messages: Promise<void> = Promise.resolve();
  private queued = 0;
  private queuedBytes = 0;
  private inputInFlight: Promise<void> | null = null;

  constructor(
    readonly owner: string,
    private spawn: SpawnPty,
    private remove: () => void,
  ) {
    this.output = new PtyOutput({
      send: (data) => {
        if (this.socket?.readyState !== WebSocket.OPEN)
          throw new Error("Socket closed");
        this.socket.send(data);
      },
      bufferedAmount: () => this.socket?.bufferedAmount ?? OUTPUT_WINDOW,
      pause: () => this.process?.pause(),
      resume: () => this.process?.resume(),
      finish: () => this.close(1000, "Session ended"),
      fail: () => this.close(1013, "Output could not be kept in sync"),
      disconnect: () => this.detach(),
    });
    this.output.detach();
  }

  attach(socket: WebSocket, bytes: number, resumed: boolean): void {
    if (!this.output.canResume(bytes)) {
      socket.close(4409, "Output can no longer be restored");
      return;
    }
    // Fence the previous attachment before closing it. Its queued callbacks
    // cannot supply input, resize, acknowledgments, or close this session.
    const previous = this.socket;
    this.socket = null;
    this.clearInputAckTimer();
    this.output.detach();
    previous?.close(4001, "Session reattached");
    if (this.expiry !== null) clearTimeout(this.expiry);
    this.expiry = null;
    this.socket = socket;
    this.attachmentReady = false;
    this.sentInputAck = this.acceptedInput;
    this.sentCwd = null;
    socket.on("message", (raw) => {
      if (this.stopped || this.socket !== socket) return;
      const bytes = Buffer.byteLength(raw.toString());
      this.queuedBytes += bytes;
      if (++this.queued > INPUT_MESSAGES + 256 || this.queuedBytes > 384 * 1024) { this.close(1013, "Input queue is full"); return; }
      this.messages = this.messages.then(async () => {
        if (this.stopped || this.socket !== socket) return;
        try {
          const message = JSON.parse(raw.toString());
          if (!message || typeof message !== "object") throw new Error();
          if (isResize(message)) {
            if (!this.started) {
              this.started = true;
              try {
                this.process = this.spawn(message, {
                  data: (data) => this.output.push(data),
                  exit: () => {
                    this.exited = true;
                    this.output.end();
                  },
                  cwd: (path) => {
                    this.cwd = path;
                    this.sendCwd();
                  },
                });
                if (!this.socket) this.process.pause();
              } catch {
                console.error("Failed to initialize terminal provider");
                this.exited = true;
                this.output.push("\r\nFailed to initialize host terminal.\r\n");
                this.output.end();
              }
            } else if (!this.exited) this.process?.resize(message);
          } else if (message.type === "ack") {
            this.output.acknowledge(message.bytes);
          } else if (
            message.type === "input" &&
            Number.isSafeInteger(message.id) &&
            message.id > 0 &&
            typeof message.data === "string" &&
            Buffer.byteLength(message.data) <= INPUT_LIMIT &&
            this.started
          ) {
            // Acknowledgments describe the contiguous prefix handed to the PTY,
            // not command execution. Repeating an accepted ID never writes again.
            if (message.id > this.submittedInput) {
              if (this.exited || !this.process) return;
              if (message.id !== this.submittedInput + 1) throw new Error();
              // Bound outstanding Host RPCs without making each keystroke wait
              // for the preceding round trip. WebSocket submission order and
              // the provider's sequence IDs preserve PTY input order.
              if (this.inputWindow.length >= 8) await this.inputWindow[0];
              if (this.stopped || this.socket !== socket || this.exited) return;
              const previous = this.inputInFlight ?? Promise.resolve();
              let delivery: Promise<void>;
              try {
                delivery = Promise.resolve(this.process.write(message.data));
              } catch {
                this.close(1011, "Input delivery failed");
                return;
              }
              this.submittedInput = message.id;
              const settled = Promise.all([previous, delivery]).then(() => {
                if (this.stopped) return;
                this.acceptedInput = message.id;
                this.sendInputAck();
              }, () => {
                // Unknown acceptance never becomes a successful browser ACK.
                this.close(1011, "Input delivery failed");
              });
              this.inputInFlight = settled;
              this.inputWindow.push(settled);
              void settled.then(() => {
                this.inputWindow = this.inputWindow.filter((pending) => pending !== settled);
                if (this.inputInFlight === settled) this.inputInFlight = null;
              });
            }
            this.sendInputAck();
          } else if (message.type === "close") {
            this.close(1000, "Session closed");
          } else throw new Error();
        } catch {
          this.close(1002, "Invalid terminal message");
        }
      }).finally(() => { this.queued--; this.queuedBytes -= bytes; });
    });
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.detach();
    });
    socket.on("error", () => {
      if (this.socket === socket) this.detach();
    });
    const sendReady = () => {
      if (this.stopped || this.socket !== socket) return;
      try {
        socket.send(
          JSON.stringify({
            type: "ready",
            session: this.token,
            resumed,
            input: this.acceptedInput,
          }),
        );
        this.attachmentReady = true;
        this.sentInputAck = this.acceptedInput;
        this.sendCwd();
        if (this.socket === socket) this.output.attach(bytes);
      } catch {
        this.detach();
      }
    };
    // Do not report a stale input prefix while a previous attachment's Host API
    // acceptance is still unknown. New input IDs start after that result.
    if (this.inputInFlight) void this.inputInFlight.then(sendReady, sendReady);
    else sendReady();
  }

  private clearInputAckTimer(): void {
    if (this.inputAckTimer !== null) clearTimeout(this.inputAckTimer);
    this.inputAckTimer = null;
  }

  private sendInputAck(): void {
    const socket = this.socket;
    if (
      !socket ||
      !this.attachmentReady ||
      socket.readyState !== WebSocket.OPEN ||
      this.sentInputAck === this.acceptedInput
    )
      return;
    // Retain only a counter while the socket is busy, not one queued control
    // per keystroke. Ready reports the same counter if this socket is lost.
    if (socket.bufferedAmount > OUTPUT_WINDOW) {
      if (this.inputAckTimer === null)
        this.inputAckTimer = setTimeout(() => {
          this.inputAckTimer = null;
          this.sendInputAck();
        }, 16);
      return;
    }
    try {
      socket.send(
        JSON.stringify({
          type: "input-ack",
          input: this.acceptedInput,
        }),
      );
      this.sentInputAck = this.acceptedInput;
      this.clearInputAckTimer();
    } catch {
      this.detach();
    }
  }

  private sendCwd(): void {
    if (
      !this.attachmentReady ||
      !this.cwd ||
      this.cwd === this.sentCwd ||
      this.socket?.readyState !== WebSocket.OPEN
    )
      return;
    const message = JSON.stringify({ type: "cwd", cwd: this.cwd });
    if (
      Buffer.byteLength(message) <= CONTROL_RESERVE &&
      this.socket.bufferedAmount <= OUTPUT_WINDOW
    ) {
      try {
        this.socket.send(message);
        this.sentCwd = this.cwd;
      } catch {
        this.detach();
      }
    }
  }

  private detach(): void {
    if (this.stopped || !this.socket) return;
    const socket = this.socket;
    this.socket = null;
    this.clearInputAckTimer();
    this.output.detach();
    socket.close(4000, "Connection interrupted");
    this.expiry = setTimeout(
      () => this.close(1000, "Session expired"),
      SESSION_GRACE_MS,
    );
  }

  close(code = 1000, reason = "Server stopped"): void {
    if (this.stopped) return;
    this.stopped = true;
    const socket = this.socket;
    this.socket = null;
    this.clearInputAckTimer();
    if (this.expiry !== null) clearTimeout(this.expiry);
    this.expiry = null;
    this.output.stop();
    this.process?.dispose(!this.exited);
    this.remove();
    socket?.close(code, reason);
  }
}

/** Session identity outlives sockets; clients must retain a complete replay prefix. */
export class TerminalSessions {
  private sessions = new Map<string, TerminalSession>();
  constructor(private spawn: SpawnPty) {}

  get size(): number {
    return this.sessions.size;
  }

  accept(socket: WebSocket, owner: string): void {
    if (!owner) { socket.close(1008, "Missing terminal owner"); return; }
    const timeout = setTimeout(
      () => socket.close(1002, "Missing terminal attachment"),
      HANDSHAKE_MS,
    );
    socket.once("close", () => clearTimeout(timeout));
    // An error can precede the attachment and must not be an unhandled event.
    socket.on("error", () => {});
    socket.once("message", (raw) => {
      clearTimeout(timeout);
      if (socket.readyState !== WebSocket.OPEN) return;
      try {
        const message = JSON.parse(raw.toString());
        if (
          message?.type !== "attach" ||
          !Number.isSafeInteger(message.bytes) ||
          message.bytes < 0
        )
          throw new Error();
        if (message.session === null && message.bytes === 0) {
          if (this.sessions.size >= SESSION_LIMIT) {
            socket.close(1013, "Too many terminal sessions");
            return;
          }
          const session = new TerminalSession(owner, this.spawn, () =>
            this.sessions.delete(session.token),
          );
          this.sessions.set(session.token, session);
          session.attach(socket, 0, false);
        } else if (
          typeof message.session === "string" &&
          /^[a-f0-9]{64}$/.test(message.session)
        ) {
          const session = this.sessions.get(message.session);
          // Knowing a replay token does not grant access to another user's PTY.
          // Reject before attach can fence or close the legitimate attachment.
          if (!session || session.owner !== owner) socket.close(4404, "Session is no longer available");
          else session.attach(socket, message.bytes, true);
        } else throw new Error();
      } catch {
        socket.close(1002, "Invalid terminal attachment");
      }
    });
  }

  close(): void {
    for (const session of this.sessions.values()) session.close();
  }
}

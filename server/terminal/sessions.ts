import { WebSocket } from "ws";
import { HANDSHAKE_MS, SESSION_LIMIT } from "../../shared/terminal-protocol";
import { TerminalSession } from "./session";
import type { SpawnPty } from "./types";

/** Live sessions survive transient disconnects; no session or output is persisted. */
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

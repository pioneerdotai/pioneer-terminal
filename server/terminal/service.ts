import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { CONTROL_RESERVE, INPUT_LIMIT } from "../../shared/terminal-protocol";
import { TerminalSessions } from "./sessions";
import type { SpawnPty } from "./types";

export interface TerminalService {
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, owner: string): void;
  close(): void | Promise<void>;
}

/** Own session registration and WebSockets together, for either PTY provider. */
export function createTerminalService(
  spawn: SpawnPty,
  closeProvider?: () => Promise<void>,
): TerminalService {
  const sessions = new TerminalSessions(spawn);
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: INPUT_LIMIT * 6 + CONTROL_RESERVE,
  });
  return {
    upgrade(req, socket, head, owner) {
      wss.handleUpgrade(req, socket, head, (ws) => sessions.accept(ws, owner));
    },
    close() {
      sessions.close();
      for (const client of wss.clients) client.terminate();
      wss.close();
      return closeProvider?.();
    },
  };
}

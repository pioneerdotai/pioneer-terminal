// This module is reachable only from dev-server.ts, never the release entry.
import { spawnShell } from "./local-pty";
import { createTerminalService, type TerminalService } from "./service";

export function createDevelopmentTerminal(): TerminalService {
  const terminal = createTerminalService(spawnShell);
  return {
    upgrade(req, socket, head, owner) {
      const host = process.env.HOST || "127.0.0.1";
      const port = process.env.PORT || "3000";
      const origins = new Set([`http://${host}:${port}`]);
      if (host === "127.0.0.1" || host === "localhost") {
        origins.add(`http://127.0.0.1:${port}`);
        origins.add(`http://localhost:${port}`);
      }
      if (!req.headers.origin || !origins.has(req.headers.origin)) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      terminal.upgrade(req, socket, head, owner);
    },
    close: () => terminal.close(),
  };
}

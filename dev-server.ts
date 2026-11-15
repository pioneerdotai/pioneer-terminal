// Local development only; excluded from the production server bundle.
import { WebSocketServer } from "ws";
import { spawnShell } from "./lib/local-pty";
import { TerminalSessions } from "./lib/terminal-sessions";
import { CONTROL_RESERVE, INPUT_LIMIT } from "./lib/terminal-protocol";
import { startServer } from "./server";

const sessions = new TerminalSessions(spawnShell);
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: INPUT_LIMIT * 6 + CONTROL_RESERVE,
});
startServer({
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
    wss.handleUpgrade(req, socket, head, (ws) => sessions.accept(ws, owner));
  },
  close() {
    sessions.close();
    for (const client of wss.clients) client.terminate();
    wss.close();
  },
});

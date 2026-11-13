// Local development only; excluded from the production server bundle.
import { WebSocketServer } from "ws";
import { spawnShell } from "./lib/local-pty";
import { TerminalSessions } from "./lib/terminal-sessions";
import { CONTROL_RESERVE, INPUT_LIMIT } from "./lib/terminal-protocol";
import { startServer } from "./server";

const sessions = new TerminalSessions(spawnShell);
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: INPUT_LIMIT + CONTROL_RESERVE,
});
startServer({
  upgrade(req, socket, head) {
    const origin = `http://${process.env.HOST || "127.0.0.1"}:${process.env.PORT || "3000"}`;
    if (req.headers.origin !== origin) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => sessions.accept(ws));
  },
  close() {
    sessions.close();
    for (const client of wss.clients) client.terminate();
    wss.close();
  },
});

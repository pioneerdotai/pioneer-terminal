// Developer-only stand-in for the future Gateway PTY service. Never packaged.
import { createServer, request } from "node:http";
import { createServer as createNetServer, type Socket } from "node:net";
import { WebSocketServer } from "ws";
import { spawnShell } from "../../lib/local-pty";
import { TerminalSessions } from "../../lib/terminal-sessions";
import { CONTROL_RESERVE, INPUT_LIMIT } from "../../lib/terminal-protocol";

export async function startHostPreview(port: number) {
  const origin = `http://127.0.0.1:${port}`;
  const host = new URL(origin).host;
  const sessions = new TerminalSessions(spawnShell);
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: INPUT_LIMIT + CONTROL_RESERVE,
  });
  const sockets = new Set<Socket>();
  let upstreamPort: number | undefined;
  let stopping = false;
  const server = createServer((req, res) => {
    if (stopping || req.headers.host !== host) {
      res.writeHead(403).end();
      return;
    }
    if (!upstreamPort) {
      res.writeHead(503).end("Microsandbox UI is starting; retry shortly.");
      return;
    }
    // Streaming HTTP only. Terminal upgrades never reach the guest PTY server.
    const upstream = request({
      hostname: "127.0.0.1",
      port: upstreamPort,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, connection: "close" },
      agent: false,
    });
    upstream.on("response", (response) => {
      if (res.destroyed) {
        response.destroy();
        return;
      }
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.on("error", () => res.destroy());
      response.pipe(res);
    });
    upstream.on("error", () => {
      if (res.destroyed) return;
      if (res.headersSent) res.destroy();
      else
        res
          .writeHead(503, { "Content-Type": "text/plain; charset=utf-8" })
          .end(
            "Microsandbox UI is unavailable. Wait for Local Terminal ready.",
          );
    });
    req.on("error", () => upstream.destroy());
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (req, socket, head) => {
    socket.on("error", () => socket.destroy());
    if (
      stopping ||
      req.headers.host !== host ||
      req.headers.origin !== origin ||
      req.method !== "GET"
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    if (req.url?.split("?", 1)[0] !== "/api/terminal") {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => sessions.accept(ws));
  });

  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    if (closing) return closing;
    stopping = true;
    sessions.close();
    for (const client of wss.clients) client.terminate();
    wss.close();
    for (const socket of sockets) socket.destroy();
    closing = new Promise((resolve) => server.close(() => resolve()));
    return closing;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    // Choose a distinct loopback port for msb's guest HTTP forward. msb binds
    // it immediately afterward and fails normally if another process takes it.
    const reservation = createNetServer();
    await new Promise<void>((resolve, reject) => {
      reservation.once("error", reject);
      reservation.listen(0, "127.0.0.1", () => resolve());
    });
    const address = reservation.address();
    await new Promise<void>((resolve, reject) =>
      reservation.close((error) => (error ? reject(error) : resolve())),
    );
    if (!address || typeof address === "string")
      throw new Error("Unable to choose the Microsandbox HTTP port");
    upstreamPort = address.port;
    return { upstreamPort, close };
  } catch (error) {
    await close();
    throw error;
  }
}

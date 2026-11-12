import { timingSafeEqual } from "node:crypto";
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer } from "ws";
import { TerminalSessions } from "./lib/terminal-sessions";
import { spawnShell } from "./lib/local-pty";
import { CONTROL_RESERVE, INPUT_LIMIT } from "./lib/terminal-protocol";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "127.0.0.1";
const port = parseInt(process.env.PORT || "3000", 10);
const appToken = process.env.PIONEER_APP_TOKEN;
const appOrigin = process.env.PIONEER_APP_ORIGIN;

function authorized(value: string | string[] | undefined): boolean {
  if (!appToken) return true; // Existing standalone development mode.
  if (typeof value !== "string") return false;
  const expected = Buffer.from(appToken);
  const actual = Buffer.from(value);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const app = next({ dev, hostname, port, turbopack: dev });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    let stopping = false;
    const server = createServer((req, res) => {
      if (!authorized(req.headers["x-pioneer-app-token"])) {
        res.writeHead(401).end();
        return;
      }
      const parsedUrl = parse(req.url || "/", true);
      if (parsedUrl.pathname === "/healthz") {
        res
          .writeHead(stopping ? 503 : 200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          })
          .end(JSON.stringify({ status: stopping ? "stopping" : "ready" }));
        return;
      }
      void handle(req, res, parsedUrl).catch((error: unknown) => {
        console.error("Request failed", error);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });

    const sessions = new TerminalSessions(spawnShell);
    const wss = new WebSocketServer({
      noServer: true,
      maxPayload: INPUT_LIMIT + CONTROL_RESERVE,
    });

    server.on("upgrade", (req, socket, head) => {
      if (
        stopping ||
        !authorized(req.headers["x-pioneer-app-token"]) ||
        (appOrigin && req.headers.origin !== appOrigin)
      ) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      const { pathname } = parse(req.url || "/", true);

      if (pathname === "/api/terminal") {
        wss.handleUpgrade(req, socket, head, (ws) => {
          sessions.accept(ws);
        });
      } else {
        app.getUpgradeHandler()(req, socket, head);
      }
    });

    server.listen(port, hostname, () => {
      console.log(`> Local Terminal ready on http://${hostname}:${port}`);
    });
    const shutdown = () => {
      if (stopping) return;
      stopping = true;
      const deadline = setTimeout(() => process.exit(1), 10_000);
      deadline.unref();
      sessions.close();
      for (const client of wss.clients) client.terminate();
      wss.close();
      server.close(() => {
        void app
          .close()
          .then(() => {
            clearTimeout(deadline);
            process.exit(0);
          })
          .catch((error: unknown) => {
            console.error("Shutdown failed", error);
            process.exit(1);
          });
      });
      server.closeIdleConnections();
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    server.on("error", (error) => {
      console.error("Server failed", error);
      process.exit(1);
    });
  })
  .catch((error: unknown) => {
    console.error("Server preparation failed", error);
    process.exit(1);
  });

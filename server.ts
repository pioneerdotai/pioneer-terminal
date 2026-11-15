import { createAppServerContext, nodeRequestHeaders, type AppServerContext } from "@pioneercompany/app-sdk/server";
import { createServer, type IncomingMessage } from "node:http";
import { parse } from "node:url";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import next from "next";
import { GatewayHost } from "./lib/gateway-host";
import { TerminalSessions } from "./lib/terminal-sessions";
import { CONTROL_RESERVE, INPUT_LIMIT } from "./lib/terminal-protocol";
import { AppState } from "./lib/app-state";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || (dev ? "127.0.0.1" : "0.0.0.0");
const port = Number(process.env.PORT || "3000");
type TerminalService = {
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, owner: string): void;
  close(): void | Promise<void>;
};

// The injected local PTY service exists only in dev-server.ts, never in production.
export function startServer(developmentTerminal?: TerminalService) {
  let context: AppServerContext | null = null;
  void (async () => {
    const local = developmentTerminal !== undefined;
    context = local ? null : await createAppServerContext();
    const state = new AppState(context?.appData ?? (process.env.APP_DATA || ".terminal-data"), context?.execution.id ?? "local-development");
    await state.load();
    const host = context ? new GatewayHost(context) : null;
    const sessions = host ? new TerminalSessions(host.spawn) : null;
    const wss = new WebSocketServer({ noServer: true, maxPayload: INPUT_LIMIT * 6 + CONTROL_RESERVE });
    const terminal: TerminalService | undefined = developmentTerminal ?? (sessions ? {
      upgrade(req, socket, head, owner) { wss.handleUpgrade(req, socket, head, (ws) => sessions.accept(ws, owner)); },
      close() { sessions.close(); for (const client of wss.clients) client.terminate(); wss.close(); return host?.close(); },
    } : undefined);
    const authorized = (req: IncomingMessage) => {
      if (!context) return true;
      try { context.authenticateServiceRequest(nodeRequestHeaders(req)); return true; }
      catch { return false; }
    };
    // Only trust this header after the execution credential check. Gateway
    // supplies it from the admitted view's principal, never from browser input.
    const requestOwner = (req: IncomingMessage): string | null => {
      if (local) return "local-development";
      try { return context!.authenticateRequest(nodeRequestHeaders(req)).user.id; }
      catch { return null; }
    };
    const app = next({ dev, hostname, port, turbopack: dev });
    await app.prepare();
    const handle = app.getRequestHandler();
    let stopping = false;
    const server = createServer((req, res) => {
      if (!authorized(req)) { res.writeHead(401).end(); return; }
      const parsed = parse(req.url || "/", true);
      if (parsed.pathname === "/healthz") {
        res.writeHead(stopping ? 503 : 200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify({ status: stopping ? "stopping" : "ready" }));
        return;
      }
      const owner = requestOwner(req);
      if (!owner) { res.writeHead(403).end(); return; }
      const operation = parsed.pathname === "/state" ? state.handle(req, res, owner) : handle(req, res, parsed);
      void Promise.resolve(operation).catch(() => {
        console.error("Terminal request failed");
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    server.on("upgrade", (req, socket, head) => {
      if (stopping || !authorized(req)) { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
      const owner = requestOwner(req);
      if (!owner) { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
      const { pathname } = parse(req.url || "/", true);
      if (pathname === "/terminal" && terminal) terminal.upgrade(req, socket, head, owner);
      else if (dev) app.getUpgradeHandler()(req, socket, head);
      else socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    });
    server.listen(port, hostname, () => console.log("> Terminal backend ready"));
    const shutdown = () => {
      if (stopping) return;
      stopping = true;
      const deadline = setTimeout(() => process.exit(1), 10_000);
      deadline.unref();
      // Observe cleanup immediately, then wait for confirmed SDK teardown before
      // reporting successful shutdown. The existing deadline remains the bound.
      const cleanup = Promise.resolve().then(() => terminal?.close()).then(() => true, () => {
        console.error("Terminal Host API cleanup could not be confirmed.");
        return false;
      });
      server.close(() => {
        void Promise.all([cleanup, app.close()]).then(([clean]) => {
          clearTimeout(deadline); process.exit(clean ? 0 : 1);
        }).catch(() => process.exit(1));
      });
      server.closeIdleConnections();
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    server.on("error", () => { console.error("Terminal server failed"); process.exit(1); });
  })().catch(async () => {
    await context?.close().catch(() => { console.error("Terminal Host API cleanup could not be confirmed."); });
    console.error("Terminal backend preparation failed"); process.exit(1);
  });
}

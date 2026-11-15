import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { createServer, type IncomingMessage } from "node:http";
import { parse } from "node:url";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import next from "next";
import { GatewayHost, type AppBootstrap } from "./lib/gateway-host";
import { TerminalSessions } from "./lib/terminal-sessions";
import { CONTROL_RESERVE, INPUT_LIMIT } from "./lib/terminal-protocol";
import { AppState } from "./lib/app-state";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || (dev ? "127.0.0.1" : "0.0.0.0");
const port = Number(process.env.PORT || "3000");
type TerminalService = {
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, owner: string): void;
  close(): void;
};

async function bootstrap(): Promise<AppBootstrap> {
  const file = process.env.PIONEER_BOOTSTRAP;
  if (!file || !isAbsolute(file)) throw new Error("Missing Gateway bootstrap");
  const raw = await readFile(file, "utf8");
  if (raw.length > 16384) throw new Error("Invalid Gateway bootstrap");
  const value: AppBootstrap = JSON.parse(raw);
  if (!/^[A-Za-z0-9_-]{21}$/.test(value.execution_id) || !/^[a-f0-9]{64}$/.test(value.ui_proxy?.credential)) throw new Error("Invalid Gateway bootstrap");
  if (value.host_api !== null) {
    const host = value.host_api;
    if (!host || !/^[a-f0-9]{64}$/.test(host.credential) || !Array.isArray(host.capabilities) || !host.capabilities.every((v) => typeof v === "string")) throw new Error("Invalid Host API bootstrap");
    const url = new URL(host.endpoint);
    if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Invalid Host API endpoint");
  }
  return value;
}

// The injected local PTY service exists only in dev-server.ts, never in production.
export function startServer(developmentTerminal?: TerminalService) {
  void (async () => {
    const local = developmentTerminal !== undefined;
    const config = local ? null : await bootstrap();
    const directory = process.env.APP_DATA || (local ? ".terminal-data" : "");
    if (!local && !isAbsolute(directory)) throw new Error("Missing Gateway App data path");
    const state = new AppState(directory, config?.execution_id ?? "local-development");
    await state.load();
    const host = config ? new GatewayHost(config) : null;
    const sessions = host ? new TerminalSessions(host.spawn) : null;
    const wss = new WebSocketServer({ noServer: true, maxPayload: INPUT_LIMIT * 6 + CONTROL_RESERVE });
    const terminal: TerminalService | undefined = developmentTerminal ?? (sessions ? {
      upgrade(req, socket, head, owner) { wss.handleUpgrade(req, socket, head, (ws) => sessions.accept(ws, owner)); },
      close() { sessions.close(); for (const client of wss.clients) client.terminate(); wss.close(); host?.close(); },
    } : undefined);
    const authorized = (req: IncomingMessage) => {
      if (!config) return true;
      const value = req.headers["pioneer-app-execution-credential"];
      if (typeof value !== "string") return false;
      const expected = Buffer.from(config.ui_proxy.credential);
      const actual = Buffer.from(value);
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    };
    // Only trust this header after the execution credential check. Gateway
    // supplies it from the admitted view's principal, never from browser input.
    const requestOwner = (req: IncomingMessage): string | null => {
      if (local) return "local-development";
      const owner = req.headers["pioneer-app-user-id"];
      return typeof owner === "string" && /^[A-Za-z0-9]{21}$/.test(owner) ? owner : null;
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
      terminal?.close();
      server.close(() => {
        void app.close().then(() => { clearTimeout(deadline); process.exit(0); }).catch(() => process.exit(1));
      });
      server.closeIdleConnections();
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    server.on("error", () => { console.error("Terminal server failed"); process.exit(1); });
  })().catch(() => { console.error("Terminal backend preparation failed"); process.exit(1); });
}

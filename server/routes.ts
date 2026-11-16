import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { parse } from "node:url";
import type { requestIdentity } from "./auth";
import type { AppState } from "./state/route";
import type { TerminalService } from "./terminal/service";
import type { NextApp } from "./types";

type RouteOptions = {
  app: Pick<NextApp, "getRequestHandler" | "getUpgradeHandler">;
  state: AppState;
  terminal: TerminalService | undefined;
  identity: ReturnType<typeof requestIdentity>;
  lifecycle: { stopping: boolean };
  dev: boolean;
};

export function createRoutes({ app, state, terminal, identity, lifecycle, dev }: RouteOptions) {
  const handle = app.getRequestHandler();
  return {
    request(req: IncomingMessage, res: ServerResponse) {
      if (!identity.authorized(req)) {
        res.writeHead(401).end();
        return;
      }
      const parsed = parse(req.url || "/", true);
      if (parsed.pathname === "/healthz") {
        res.writeHead(lifecycle.stopping ? 503 : 200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        }).end(JSON.stringify({ status: lifecycle.stopping ? "stopping" : "ready" }));
        return;
      }
      const owner = identity.owner(req);
      if (!owner) {
        res.writeHead(403).end();
        return;
      }
      const operation = parsed.pathname === "/state"
        ? state.handle(req, res, owner)
        : handle(req, res, parsed);
      void Promise.resolve(operation).catch(() => {
        console.error("Terminal request failed");
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    },
    upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
      if (lifecycle.stopping || !identity.authorized(req)) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      const owner = identity.owner(req);
      if (!owner) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      const { pathname } = parse(req.url || "/", true);
      if (pathname === "/terminal" && terminal) terminal.upgrade(req, socket, head, owner);
      else if (dev) app.getUpgradeHandler()(req, socket, head);
      else socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    },
  };
}

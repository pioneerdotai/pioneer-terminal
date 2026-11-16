import {
  createAppServerContext,
  type AppServerContext,
} from "@pioneercompany/app-sdk/server";
import { createServer } from "node:http";
import next from "next";
import { serverConfig } from "./config";
import { requestIdentity } from "./auth";
import { createRoutes } from "./routes";
import { installShutdown } from "./lifecycle";
import { AppState } from "./state/route";
import { GatewayHost } from "./terminal/gateway-pty";
import {
  createTerminalService,
  type TerminalService,
} from "./terminal/service";

/** The production composition root; local PTYs are injected by dev-server.ts. */
export function startServer(developmentTerminal?: TerminalService) {
  let context: AppServerContext | null = null;
  void (async () => {
    const local = developmentTerminal !== undefined;
    context = local ? null : await createAppServerContext();
    const state = new AppState(
      context?.appData ?? (process.env.APP_DATA || ".terminal-data"),
      context?.execution.id ?? "local-development",
    );
    await state.load();
    const host = context ? new GatewayHost(context) : null;
    const terminal = developmentTerminal ?? (host
      ? createTerminalService(host.spawn, () => host.close())
      : undefined);
    const { dev, hostname, port } = serverConfig;
    const app = next({ dev, hostname, port, turbopack: dev });
    await app.prepare();
    const lifecycle = { stopping: false };
    const routes = createRoutes({
      app,
      state,
      terminal,
      identity: requestIdentity(context, local),
      lifecycle,
      dev,
    });
    const server = createServer(routes.request);
    server.on("upgrade", routes.upgrade);
    server.listen(port, hostname, () => console.log("> Terminal backend ready"));
    installShutdown(server, app, terminal, lifecycle);
  })().catch(async () => {
    await context?.close().catch(() => {
      console.error("Terminal Host API cleanup could not be confirmed.");
    });
    console.error("Terminal backend preparation failed");
    process.exit(1);
  });
}

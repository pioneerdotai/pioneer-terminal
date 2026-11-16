import type { Server } from "node:http";
import type { TerminalService } from "./terminal/service";
import type { NextApp } from "./types";

export function installShutdown(
  server: Server,
  app: Pick<NextApp, "close">,
  terminal: TerminalService | undefined,
  lifecycle: { stopping: boolean },
) {
  const shutdown = () => {
    if (lifecycle.stopping) return;
    lifecycle.stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10_000);
    deadline.unref();
    // Observe cleanup immediately; SDK teardown must settle before success.
    const cleanup = Promise.resolve()
      .then(() => terminal?.close())
      .then(() => true, () => {
        console.error("Terminal Host API cleanup could not be confirmed.");
        return false;
      });
    server.close(() => {
      void Promise.all([cleanup, app.close()]).then(([clean]) => {
        clearTimeout(deadline);
        process.exit(clean ? 0 : 1);
      }).catch(() => process.exit(1));
    });
    server.closeIdleConnections();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  server.on("error", () => {
    console.error("Terminal server failed");
    process.exit(1);
  });
}

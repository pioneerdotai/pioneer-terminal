import { execFile, execFileSync } from "child_process";
import { timingSafeEqual } from "node:crypto";
import { readlink } from "fs/promises";
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer } from "ws";
import * as pty from "node-pty";
import { TerminalSessions, type SpawnPty } from "./lib/terminal-sessions";
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

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    // The Gateway-to-backend credential must never be inherited by a shell.
    if (v !== undefined && !k.startsWith("PIONEER_")) env[k] = v;
  }
  return env;
}

function displayCwd(cwd: string): string {
  const normalized = cwd.replace(/[/\\]+$/, "") || "/";
  const home = (process.env.HOME || "").replace(/[/\\]+$/, "");
  if (home && (normalized === home || normalized.startsWith(`${home}/`))) {
    return `~${normalized.slice(home.length)}` || "~";
  }
  return normalized;
}

function setPtyWindowSize(
  ptyProcess: pty.IPty,
  rows: number,
  cols: number,
  width: number,
  height: number,
): void {
  if (process.platform === "win32") return;

  const fd = (ptyProcess as pty.IPty & { fd?: number }).fd;
  if (fd === undefined) return;

  // node-pty's resize API intentionally resets ws_xpixel/ws_ypixel to zero.
  // Kitty's icat reads those fields with TIOCGWINSZ before it starts, so use
  // the platform's standard ioctl through the system Perl that is available
  // on macOS and common Unix development environments.
  const request = process.platform === "darwin" ? 0x80087467 : 0x5414;
  const safeWidth = Math.min(0xffff, Math.max(1, Math.round(width)));
  const safeHeight = Math.min(0xffff, Math.max(1, Math.round(height)));
  const script = `my $ws=pack("S4",${rows},${cols},${safeWidth},${safeHeight}); ioctl(STDIN,${request},$ws) or exit 1`;
  try {
    execFileSync("perl", ["-e", script], {
      stdio: [fd, "ignore", "ignore"],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to set PTY pixel size: ${message}`);
  }
}

const spawnShell: SpawnPty = (size, events) => {
  const shell =
    process.env.SHELL ||
    (process.platform === "win32"
      ? process.env.ComSpec || "cmd.exe"
      : process.platform === "darwin"
        ? "/bin/zsh"
        : "/bin/bash");
  const initialCwd = process.env.HOME || "/";
  const processPty = pty.spawn(
    shell,
    process.platform === "win32" ? [] : ["-l"],
    {
      name: "xterm-256color",
      cols: size.cols,
      rows: size.rows,
      cwd: initialCwd,
      env: cleanEnv(),
      encoding: null,
    },
  );
  let disposed = false;
  let querying = false;
  function report(cwd: string) {
    if (disposed) return;
    events.cwd(displayCwd(cwd));
  }
  async function reportCwd() {
    if (disposed || querying) return;
    querying = true;
    try {
      if (process.platform === "linux") {
        const cwd = await readlink(`/proc/${processPty.pid}/cwd`).catch(
          () => null,
        );
        if (cwd) report(cwd);
      } else if (process.platform === "darwin") {
        await new Promise<void>((resolve) => {
          execFile(
            "lsof",
            ["-a", "-p", String(processPty.pid), "-d", "cwd", "-Fn"],
            { encoding: "utf8" },
            (error, stdout) => {
              if (!error) {
                const cwd = stdout.match(/^n(.+)$/m)?.[1];
                if (cwd) report(cwd);
              }
              resolve();
            },
          );
        });
      }
    } finally {
      querying = false;
    }
  }
  const resize = (nextSize: typeof size) => {
    processPty.resize(nextSize.cols, nextSize.rows);
    setPtyWindowSize(
      processPty,
      nextSize.rows,
      nextSize.cols,
      nextSize.width,
      nextSize.height,
    );
  };
  setPtyWindowSize(processPty, size.rows, size.cols, size.width, size.height);
  report(initialCwd);
  void reportCwd();
  const poll = setInterval(() => void reportCwd(), 500);
  const data = processPty.onData(events.data);
  const exit = processPty.onExit(() => {
    clearInterval(poll);
    events.exit();
  });
  return {
    write: (text) => processPty.write(text),
    resize,
    pause: () => processPty.pause(),
    resume: () => processPty.resume(),
    dispose: (kill) => {
      if (disposed) return;
      disposed = true;
      clearInterval(poll);
      data.dispose();
      exit.dispose();
      if (kill) processPty.kill();
    },
  };
};

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

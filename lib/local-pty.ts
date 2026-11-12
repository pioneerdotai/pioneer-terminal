import { execFile, execFileSync } from "child_process";
import { readlink } from "fs/promises";
import { homedir } from "node:os";
import * as pty from "node-pty";
import type { SpawnPty } from "./terminal-sessions";

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

export const spawnShell: SpawnPty = (size, events) => {
  const shell =
    process.env.SHELL ||
    (process.platform === "win32"
      ? process.env.ComSpec || "cmd.exe"
      : process.platform === "darwin"
        ? "/bin/zsh"
        : "/bin/bash");
  const initialCwd = process.env.HOME || homedir();
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

import type { Session } from "./model";

export function directoryLabel(session: Session): string {
  if (session.reportedCwd !== null) {
    // OSC 7 metadata is either an absolute path or host:/path. Keep the
    // decoded path intact, including colons and dot segments within it.
    return session.reportedCwd.replace(/^[^/]+:(?=\/)/, "");
  }
  if (!session.cwd) return "Starting…";
  return session.cwd.replace(/[/\\]+$/, "") || "/";
}

export function shellLabel(session: Session): string | null {
  const shell = session.shell;
  if (session.status !== "connected" || !shell || shell.phase === "unknown")
    return null;
  if (shell.phase === "running") return "Running";
  if (shell.exitCode !== null)
    return shell.exitCode === 0 ? "Done" : `Exit ${shell.exitCode}`;
  return shell.phase === "complete" ? "Done" : "Ready";
}


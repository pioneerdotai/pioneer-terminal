import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { machine } from "node:os";
import { join } from "node:path";
import { json, option, packagePath, root, run } from "./common.mjs";
import { sha256 } from "./package.mjs";

if (process.argv.includes("--help")) {
  console.log(
    "bun run preview:microsandbox [--port 3000]\nUses existing built artifacts and msb 0.7.14 CLI. Never builds the App or installs dependencies. App launch only happens when you run this command.",
  );
  process.exit(0);
}
const hostArch = machine().toLowerCase();
const arch = ["arm64", "aarch64"].includes(hostArch)
  ? "arm64"
  : ["amd64", "x86_64", "x64"].includes(hostArch)
    ? "x64"
    : null;
if (!arch) throw new Error(`Unsupported architecture: ${hostArch}`);
if (process.platform === "darwin" && arch !== "arm64") {
  throw new Error(
    "Microsandbox currently requires Apple Silicon on macOS; no direct-host fallback",
  );
}
const port = Number(option("--port") ?? "3000");
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Choose --port between 1024 and 65535");
const app = await json(join(root, "app.json"));
const directory = join(root, "dist/pioneer", `${app.slug}-${app.version}`);
const proposal = await json(join(directory, "runtime.proposal.json"));
const image = await json(join(root, "packaging/runtime-image.json"));
const artifact = proposal.artifacts[`linux-${arch}`];
if (!artifact)
  throw new Error(
    `Missing linux-${arch} artifact; download the combined Actions output first`,
  );
const archive = await packagePath(directory, artifact.archive);
if ((await sha256(archive)) !== artifact.sha256)
  throw new Error("Archive checksum mismatch");
// Only generated archives with this verified index are accepted, not arbitrary
// user-provided tar files. The CI verifier also rejects links/special entries.
await run("msb", ["--version"]);
const stage = await mkdtemp(join(root, "dist/.terminal-preview-"));
const data = join(root, "dist/microsandbox-preview-data", arch);
await mkdir(join(data, "home"), { recursive: true });
try {
  await run("tar", ["-xzf", archive, "-C", stage]);
  const args = [
    "run",
    "--no-tty",
    "--no-stdin",
    "--memory",
    "1G",
    "--cpus",
    "2",
    "--net",
    "public",
    "--port",
    `127.0.0.1:${port}:3000`,
    "--copy-dir",
    `${join(stage, "runtime")}:/app/runtime`,
    "--copy-file",
    `${join(root, "packaging/local-preview.cjs")}:/app/runtime/local-preview.cjs`,
    "--mount-dir",
    `${data}:/data`,
    "--workdir",
    "/app/runtime",
    "--env",
    "PIONEER_LOCAL_PREVIEW=1",
    "--env",
    `PIONEER_APP_ORIGIN=http://127.0.0.1:${port}`,
    "--env",
    "PIONEER_APP_TOKEN=",
    "--env",
    "HOST=0.0.0.0",
    "--env",
    "PORT=3000",
    "--env",
    "HOME=/data/home",
    "--env",
    "SHELL=/bin/bash",
    image.image,
    "--",
    "node",
    "local-preview.cjs",
  ];
  console.log(`\nLocal developer preview: http://127.0.0.1:${port}`);
  console.log(
    "Wait for 'Local Terminal ready', then open that exact URL. Ctrl+C stops the preview.",
  );
  console.log(
    "Shells run inside Microsandbox. Only the preview data directory is mounted from the host.",
  );
  console.log(
    "No Gateway header authentication is exercised in this loopback-only developer mode.\n",
  );
  await new Promise((accept, reject) => {
    const child = spawn("msb", args, {
      stdio: "inherit",
      shell: false,
      // Forward a Unix terminal signal once, not both as a group and directly.
      detached: process.platform !== "win32",
    });
    const interrupt = () => {
      if (process.platform !== "win32") child.kill("SIGINT");
    };
    const terminate = () => child.kill("SIGTERM");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    const release = () => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    };
    child.once("error", (error) => {
      release();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      release();
      if (code === 0 || code === 130 || signal === "SIGINT") accept();
      else reject(new Error(`msb exited with ${signal ?? code}`));
    });
  });
} finally {
  await rm(stage, { recursive: true, force: true });
}

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../", import.meta.url));

export function run(command, args, cwd = root, extraEnv = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) accept();
      else reject(new Error(`${command} exited with ${signal ?? code}`));
    });
  });
}

export async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeJson(path, value) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${name} needs a value`);
  return value;
}

export function nativeTarget() {
  if (!["linux", "darwin", "win32"].includes(process.platform)) {
    throw new Error(`Unsupported build OS: ${process.platform}`);
  }
  if (!["arm64", "x64"].includes(process.arch)) {
    throw new Error(`Unsupported build architecture: ${process.arch}`);
  }
  return `${process.platform}-${process.arch}`;
}

export async function filesUnder(directory) {
  const result = [];
  async function visit(current) {
    for (const entry of (await readdir(current)).sort()) {
      const path = join(current, entry);
      const info = await lstat(path);
      if (info.isSymbolicLink()) {
        throw new Error(`Unmaterialized symlink in package: ${path}`);
      }
      if (info.isDirectory()) await visit(path);
      else if (info.isFile()) result.push(path);
      else throw new Error(`Special file in package: ${path}`);
    }
  }
  await visit(directory);
  return result;
}

export async function fileIndex(directory) {
  const entries = [];
  for (const path of await filesUnder(directory)) {
    const info = await lstat(path);
    entries.push({
      path: relative(directory, path).split(sep).join("/"),
      size: info.size,
      mode: info.mode & 0o777,
      sha256: createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    });
  }
  return entries;
}

export async function packagePath(directory, path) {
  if (typeof path !== "string" || path.includes("\\") || path.includes(":")) {
    throw new Error(`Invalid package-relative path: ${path}`);
  }
  const absolute = resolve(directory, path);
  const base = await realpath(directory);
  const actual = await realpath(absolute);
  if (!actual.startsWith(`${base}${sep}`)) {
    throw new Error(`Path escapes package: ${path}`);
  }
  return absolute;
}

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
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

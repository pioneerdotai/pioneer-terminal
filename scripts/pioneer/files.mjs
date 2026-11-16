import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
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

// Matches pioneer-packages' canonical member snapshot, including directory modes.
export async function treeDigest(directory) {
  const entries = [];
  async function visit(path, key) {
    const stat = await lstat(path);
    if (!stat.isDirectory() && !stat.isFile()) throw new Error(`Invalid payload member: ${key}`);
    entries.push({ path, key, stat });
    if (stat.isDirectory()) for (const name of await readdir(path)) await visit(join(path, name), key ? `${key}/${name}` : name);
  }
  await visit(directory, "");
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
  const hash = createHash("sha256").update("pioneer-plugin-tree-v1\0");
  const u64 = (value) => { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(BigInt(value)); return bytes; };
  for (const { path, key, stat } of entries) {
    const mode = Buffer.alloc(4); mode.writeUInt32LE(stat.mode & 0o777);
    hash.update(u64(Buffer.byteLength(key))).update(key).update(stat.isDirectory() ? "d" : "f").update(mode);
    if (stat.isFile()) hash.update(u64(stat.size)).update(await readFile(path));
  }
  return hash.digest("hex");
}

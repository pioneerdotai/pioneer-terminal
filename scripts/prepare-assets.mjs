import { chmod, copyFile, mkdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(join(root, "public"), { recursive: true });
await copyFile(
  require.resolve("@wterm/ghostty/ghostty-vt.wasm"),
  join(root, "public", "ghostty-vt.wasm"),
);
if (process.platform === "darwin") {
  const helper = join(
    dirname(require.resolve("node-pty/package.json")),
    "prebuilds",
    `darwin-${process.arch}`,
    "spawn-helper",
  );
  try {
    const info = await stat(helper);
    await chmod(helper, info.mode | 0o111);
  } catch (error) {
    // Source-built node-pty does not use this prebuilt helper location.
    if (error.code !== "ENOENT") throw error;
  }
}

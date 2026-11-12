import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { json, nativeTarget, root, run, writeJson } from "./common.mjs";

// This runs on the developer/CI builder, never on an installing Gateway.
nativeTarget();
const buildDirectory = join(root, "build");
await mkdir(buildDirectory, { recursive: true });
// An interrupted rebuild must never leave a previous successful receipt behind.
await rm(join(buildDirectory, "pioneer-build.json"), { force: true });
await rm(join(root, ".next"), { recursive: true, force: true });
await run("node", ["scripts/prepare-assets.mjs"]);
await run("bun", ["run", "build"]);
await run("bun", ["run", "build:server"]);
const pkg = await json(join(root, "package.json"));
await writeJson(join(buildDirectory, "pioneer-build.json"), {
  name: pkg.name,
  version: pkg.version,
  platform: process.platform,
  arch: process.arch,
  node: process.versions.node,
  nodeModulesABI: process.versions.modules,
  buildId: (await readFile(join(root, ".next/BUILD_ID"), "utf8")).trim(),
  createdAt: new Date().toISOString(),
});
console.log(
  `Built ${nativeTarget()}. Package on this same builder/architecture.`,
);

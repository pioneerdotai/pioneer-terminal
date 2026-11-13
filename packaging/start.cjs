// No Bun, tsx, package-manager hooks or build tools are needed at runtime.
const { mkdirSync } = require("node:fs");
const { isAbsolute, join } = require("node:path");
const target = require("./runtime-target.json");

if (
  process.platform !== target.platform ||
  process.arch !== target.arch ||
  process.versions.modules !== target.nodeModulesABI ||
  Number(process.versions.node.split(".")[0]) !== target.nodeMajor
) {
  throw new Error(
    "Runtime OS/architecture/Node ABI does not match the packaged native modules",
  );
}

process.env.NODE_ENV = "production";
if (
  !process.env.PIONEER_APP_TOKEN ||
  process.env.PIONEER_APP_TOKEN.length < 32
) {
  throw new Error("Gateway must provide a per-execution PIONEER_APP_TOKEN");
}
if (!process.env.PIONEER_APP_ORIGIN) {
  throw new Error("Gateway must provide the public PIONEER_APP_ORIGIN");
}
const origin = new URL(process.env.PIONEER_APP_ORIGIN);
if (
  !["http:", "https:"].includes(origin.protocol) ||
  origin.origin !== process.env.PIONEER_APP_ORIGIN
) {
  throw new Error(
    "PIONEER_APP_ORIGIN must be an HTTP(S) origin without a path",
  );
}
const data = process.env.PIONEER_APP_DATA;
if (!data || !isAbsolute(data)) {
  throw new Error("Gateway must provide an absolute PIONEER_APP_DATA path");
}
mkdirSync(join(data, "cache"), { recursive: true });
process.env.HOME = data;
// Guest interface only. Gateway publishes/routes this port; no host bind here.
process.env.HOST ??= "0.0.0.0";
process.env.PORT ??= "3000";
process.chdir(__dirname);
// Use the exact production config serialized by Next's standalone build.
// The generated standalone server is NOT used: server.cjs serves HTTP; Gateway owns terminal WebSockets.
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(
  require("./.next/required-server-files.json").config,
);
require("./server.cjs").startServer();

// Explicit developer preview only. This file is NOT in production artifacts.
// The CLI publishes the guest port on host loopback, never on a LAN interface.
const { mkdirSync } = require("node:fs");
const target = require("./runtime-target.json");
if (
  process.env.PIONEER_LOCAL_PREVIEW !== "1" ||
  process.env.PIONEER_APP_TOKEN
) {
  throw new Error(
    "This entry point is only for explicit local preview without Gateway credentials",
  );
}
const origin = new URL(process.env.PIONEER_APP_ORIGIN);
if (
  origin.protocol !== "http:" ||
  origin.hostname !== "127.0.0.1" ||
  origin.origin !== process.env.PIONEER_APP_ORIGIN
) {
  throw new Error("Local preview requires an explicit HTTP loopback origin");
}
if (
  process.platform !== target.platform ||
  process.arch !== target.arch ||
  process.versions.modules !== target.nodeModulesABI ||
  Number(process.versions.node.split(".")[0]) !== target.nodeMajor
) {
  throw new Error("Preview runtime does not match the packaged native target");
}
mkdirSync(process.env.HOME, { recursive: true });
process.env.NODE_ENV = "production";
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(
  require("./.next/required-server-files.json").config,
);
require("./server.cjs");

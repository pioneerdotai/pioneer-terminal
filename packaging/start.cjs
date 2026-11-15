// The common launcher is separate from architecture-specific, read-only payloads.
const { isAbsolute } = require("node:path");
const payload = "/payload";
const target = require(`${payload}/runtime-target.json`);
if (
  process.platform !== target.platform || process.arch !== target.arch ||
  process.versions.modules !== target.nodeModulesABI ||
  Number(process.versions.node.split(".")[0]) !== target.nodeMajor
) throw new Error("Runtime OS/architecture/Node ABI does not match this payload");
if (!process.env.PIONEER_BOOTSTRAP || !isAbsolute(process.env.PIONEER_BOOTSTRAP) ||
    !process.env.APP_DATA || !isAbsolute(process.env.APP_DATA)) {
  throw new Error("Gateway must provide PIONEER_BOOTSTRAP and APP_DATA");
}
process.env.NODE_ENV = "production";
process.env.WS_NO_BUFFER_UTIL = "1";
process.env.WS_NO_UTF_8_VALIDATE = "1";
process.env.HOST = "0.0.0.0";
process.env.PORT = "3000";
process.chdir(payload);
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(
  require(`${payload}/.next/required-server-files.json`).config,
);
require(`${payload}/server.cjs`).startServer();

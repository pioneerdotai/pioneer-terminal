import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { json, option, root, writeJson } from "./common.mjs";
import { copyMetadata, metadata, sha256 } from "./package.mjs";

const input = resolve(option("--input") ?? join(root, "dist/pioneer-targets"));
const info = await metadata();
const image = await json(join(root, "packaging/runtime-image.json"));
const output = join(
  root,
  "dist/pioneer",
  `${info.app.slug}-${info.app.version}`,
);
if (input === output || input.startsWith(`${output}/`))
  throw new Error("Input cannot be inside output");
const targets = ["linux-x64", "linux-arm64"];
const builds = [];
for (const target of targets) {
  const directory = join(input, target);
  const build = await json(join(directory, "build-info.json"));
  if (
    build.target !== target ||
    build.slug !== info.app.slug ||
    build.version !== info.app.version ||
    build.manifestSha256 !== (await sha256(join(root, "app.json"))) ||
    build.lockSha256 !== (await sha256(join(root, "bun.lock"))) ||
    !/^22\./.test(build.node)
  ) {
    throw new Error(`Incompatible or stale artifact: ${target}`);
  }
  if (
    build.sourceCommit &&
    process.env.GITHUB_SHA &&
    build.sourceCommit !== process.env.GITHUB_SHA
  ) {
    throw new Error(`Artifact comes from a different source commit: ${target}`);
  }
  const archive = `${info.app.slug}-${info.app.version}-${target}.tar.gz`;
  if (
    build.archive !== archive ||
    build.archiveSha256 !== (await sha256(join(directory, archive)))
  ) {
    throw new Error(`Archive checksum mismatch: ${target}`);
  }
  for (const path of info.assets) {
    const key = path.replaceAll("\\", "/");
    if (build.assetSha256[key] !== (await sha256(join(root, path)))) {
      throw new Error(`Different shared asset in ${target}: ${path}`);
    }
  }
  builds.push({ ...build, directory });
}
await rm(output, { recursive: true, force: true });
await copyMetadata(output, info);
await mkdir(join(output, "runtime-artifacts"));
const artifacts = {};
for (const build of builds) {
  await cp(
    join(build.directory, build.archive),
    join(output, "runtime-artifacts", build.archive),
  );
  await cp(
    join(build.directory, "files.json"),
    join(output, "runtime-artifacts", `${build.target}.files.json`),
  );
  artifacts[build.target] = {
    archive: `runtime-artifacts/${build.archive}`,
    sha256: build.archiveSha256,
    files: `runtime-artifacts/${build.target}.files.json`,
    node: build.node,
    nodeModulesABI: build.nodeModulesABI,
    sourceCommit: build.sourceCommit,
    unpackedBytes: build.unpackedBytes,
    runtimeFileCount: build.runtimeFileCount,
    dependencyTrace: `runtime-artifacts/${build.target}.dependency-trace.json`,
    packagingStats: `runtime-artifacts/${build.target}.packaging-stats.json`,
  };
  for (const name of ["dependency-trace", "packaging-stats"]) {
    await cp(
      join(build.directory, `${name}.json`),
      join(output, "runtime-artifacts", `${build.target}.${name}.json`),
    );
  }
}
// Deliberately outside app.json: future runtime schema is NOT yet agreed or
// supported by the minimal Apps installer. This is a developer handoff only.
await writeJson(join(output, "runtime.proposal.json"), {
  status: "developer-preview-not-an-installed-runtime-contract",
  provider: "microsandbox",
  imageCandidate: "node:22-bookworm-slim",
  image: image.image,
  imageDigest: image.image.split("@")[1],
  platformImageDigests: image.platformDigests,
  imageDigestStatus:
    "pinned-slim-runtime; separate-full-CI-builder; Microsandbox qualification pending",
  guest: { os: "linux", libc: "glibc", distribution: "debian-bookworm" },
  archiveRoot: "runtime",
  command: ["node", "start.cjs"],
  port: 3000,
  readiness: { method: "GET", path: "/healthz", header: "x-pioneer-app-token" },
  gatewayEnvironment: [
    "PIONEER_APP_TOKEN",
    "PIONEER_APP_ORIGIN",
    "PIONEER_APP_DATA",
  ],
  requiredGuestCommands: ["node", "/bin/bash", "perl"],
  gatewayProxy:
    "Inject x-pioneer-app-token server-side for every HTTP request and WebSocket upgrade; preserve the public Origin. Never expose the token to client JS.",
  ui: {
    path: "/",
    routing: "dedicated-origin-required",
    websocketPath: "/api/terminal",
  },
  artifacts,
});
await writeFile(
  join(output, "INSTALLATION-NOTES.txt"),
  "Developer preview for the FUTURE Gateway runtime. Not installable by the current minimal Apps parser.\n" +
    "Select one Linux architecture archive, extract in the app package, provide Node.js 22 via Microsandbox, attach persistent data and inject the documented Gateway environment/header.\n" +
    "Use the pinned slim runtime image and validate its Node ABI before execution. Never install dependencies or build this package on the Gateway.\n" +
    "The terminal shell runs inside the sandbox, not on the Gateway host or client. Live PTYs do not survive backend restart.\n",
);
const { fileIndex } = await import("./common.mjs");
const sums = (await fileIndex(output))
  .map((file) => `${file.sha256}  ${file.path}`)
  .join("\n");
await writeFile(join(output, "SHA256SUMS"), `${sums}\n`);
console.log(`Combined developer package: ${output}`);

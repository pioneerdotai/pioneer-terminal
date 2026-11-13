import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { json, option, root, writeJson } from "./common.mjs";
import { copyMetadata, metadata, sha256 } from "./package.mjs";

const input = resolve(option("--input") ?? join(root, "dist/pioneer-targets"));
const info = await metadata();
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
    !/^26\./.test(build.node)
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
  if (info.app.runtime.artifacts[target] !== `./runtime-artifacts/${archive}`) {
    throw new Error(`Manifest artifact path mismatch: ${target}`);
  }
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
await writeJson(join(output, "build-info.json"), {
  slug: info.app.slug,
  version: info.app.version,
  environment: info.app.runtime.environment,
  sourceCommit: process.env.GITHUB_SHA ?? null,
  artifacts,
});
const { fileIndex } = await import("./common.mjs");
const sums = (await fileIndex(output))
  .map((file) => `${file.sha256}  ${file.path}`)
  .join("\n");
await writeFile(join(output, "SHA256SUMS"), `${sums}\n`);
console.log(`Assembled application package: ${output}`);

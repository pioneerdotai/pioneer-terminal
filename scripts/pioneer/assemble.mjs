import { chmod, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { json, option, root, run, treeDigest, writeJson } from "./common.mjs";
import { copyMetadata, metadata, sha256 } from "./package.mjs";

const input = resolve(option("--input") ?? join(root, "dist/pioneer-targets"));
const info = await metadata();
const output = resolve(option("--output") ?? join(
  root,
  "dist/pioneer",
  `${info.app.slug}-${info.app.version}`,
));
if (
  output === root || root.startsWith(`${output}${sep}`) ||
  input === output || input.startsWith(`${output}${sep}`) ||
  output.startsWith(`${input}${sep}`)
)
  throw new Error("Output must be separate from the source root and input artifacts");
const selectedTarget = option("--target");
const supportedTargets = ["linux-x64", "linux-arm64"];
if (selectedTarget && !supportedTargets.includes(selectedTarget))
  throw new Error(`Unsupported target: ${selectedTarget}`);
const targets = selectedTarget ? [selectedTarget] : supportedTargets;
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
  const architecture = target === "linux-x64" ? "linux/amd64" : "linux/arm64";
  const expectedPath = target === "linux-x64" ? "runtime-artifacts/linux-amd64" : "runtime-artifacts/linux-arm64";
  if (info.app.runtime.artifacts[architecture]?.path !== expectedPath) {
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
await mkdir(join(output, "runtime"), { recursive: true, mode: 0o755 });
await chmod(join(output, "runtime"), 0o755);
await cp(join(root, "packaging/start.cjs"), join(output, "runtime/start.cjs"));
await chmod(join(output, "runtime/start.cjs"), 0o644);
await mkdir(join(output, "runtime-artifacts"), { mode: 0o755 });
const artifacts = {};
for (const build of builds) {
  const architecture = build.target === "linux-x64" ? "linux/amd64" : "linux/arm64";
  const member = info.app.runtime.artifacts[architecture];
  await run("python3", [join(root, "scripts/pioneer/extract-runtime.py"), join(build.directory, build.archive), join(build.directory, "files.json"), join(output, member.path)]);
  member.sha256 = await treeDigest(join(output, member.path));
  artifacts[architecture] = {
    path: member.path, sha256: member.sha256,
    node: build.node, nodeModulesABI: build.nodeModulesABI,
    sourceCommit: build.sourceCommit, unpackedBytes: build.unpackedBytes,
    runtimeFileCount: build.runtimeFileCount,
  };
  // Keep build provenance outside the execution payload.
  for (const name of ["files", "dependency-trace", "packaging-stats"]) {
    await cp(join(build.directory, `${name}.json`), join(output, `${build.target}.${name}.json`));
  }
}
info.app.runtime.artifacts = Object.fromEntries(
  Object.keys(artifacts).map((architecture) => [architecture, info.app.runtime.artifacts[architecture]]),
);
await writeJson(join(output, "app.json"), info.app);
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

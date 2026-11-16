import { cp, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { join, sep } from "node:path";
import { json, nativeTarget, root, run, writeJson } from "./common.mjs";
import { fileIndex, sha256 } from "./files.mjs";
import { metadata } from "./metadata.mjs";
import { createRuntimePayload } from "./runtime-payload.mjs";

async function main() {
  if (
    process.platform !== "linux" ||
    Number(process.versions.node.split(".")[0]) !== 26
  ) {
    throw new Error(
      "Package on Linux with Node.js 26 (the CI Debian builder). No host-native artifact may be labelled Linux.",
    );
  }
  const target = nativeTarget();
  const receipt = await json(join(root, "build/pioneer-build.json"));
  const info = await metadata();
  if (
    receipt.platform !== process.platform ||
    receipt.arch !== process.arch ||
    receipt.nodeModulesABI !== process.versions.modules ||
    receipt.version !== info.app.version
  ) {
    throw new Error(
      "Build receipt does not match this runtime target; rebuild first",
    );
  }
  if (
    receipt.buildId !==
    (await readFile(join(root, ".next/BUILD_ID"), "utf8")).trim()
  ) {
    throw new Error("Next build changed since build receipt; rebuild first");
  }
  const temporary = await mkdtemp(join(root, ".pioneer-stage-"));
  const output = join(root, "dist/pioneer-targets", target);
  try {
    await createRuntimePayload(temporary, info);
    const release = join(temporary, "release");
    await mkdir(release);
    await cp(
      join(temporary, "dependency-trace.json"),
      join(release, "dependency-trace.json"),
    );
    const archive = `${info.app.slug}-${info.app.version}-${target}.tar.gz`;
    const entries = await fileIndex(join(temporary, "payload"));
    const unpackedBytes = entries.reduce(
      (total, entry) => total + entry.size,
      0,
    );
    if (unpackedBytes > 100 * 1024 * 1024) {
      throw new Error(
        `Runtime exceeded 100 MiB: ${unpackedBytes} bytes; inspect the trace, do not blindly prune it`,
      );
    }
    await writeJson(join(release, "files.json"), entries);
    await writeJson(join(release, "packaging-stats.json"), {
      files: entries.length,
      unpackedBytes,
      dependenciesBytes: entries
        .filter((entry) => entry.path.startsWith("runtime/node_modules/"))
        .reduce((total, entry) => total + entry.size, 0),
      nodeRuntimeIncluded: false,
    });
    // GNU tar in the Debian builder preserves Linux executable modes.
    await run("tar", [
      "--sort=name",
      "--mtime=@0",
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "-czf",
      join(release, archive),
      "-C",
      join(temporary, "payload"),
      "runtime",
    ]);
    await writeJson(join(release, "build-info.json"), {
      slug: info.app.slug,
      version: info.app.version,
      target,
      node: process.versions.node,
      nodeModulesABI: process.versions.modules,
      libc: "glibc",
      buildBase: "debian-trixie",
      manifestSha256: await sha256(join(root, "app.json")),
      lockSha256: await sha256(join(root, "bun.lock")),
      assetSha256: Object.fromEntries(
        await Promise.all(
          info.assets.map(async (path) => [
            path.split(sep).join("/"),
            await sha256(join(root, path)),
          ]),
        ),
      ),
      archive,
      unpackedBytes,
      runtimeFileCount: entries.length,
      archiveSha256: await sha256(join(release, archive)),
      sourceCommit: process.env.GITHUB_SHA ?? null,
    });
    await mkdir(join(root, "dist/pioneer-targets"), { recursive: true });
    await rm(output, { recursive: true, force: true });
    await rename(release, output);
    console.log(`Prepared ${output}`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

await main();

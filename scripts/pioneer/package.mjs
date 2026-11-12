import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
  fileIndex,
  json,
  nativeTarget,
  packagePath,
  root,
  run,
  writeJson,
} from "./common.mjs";

export async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

// Used by assemble.mjs too; importing it must not start a build.
export async function metadata() {
  const app = await json(join(root, "app.json"));
  const pkg = await json(join(root, "package.json"));
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(app.slug) || app.slug.length > 64) {
    throw new Error("Invalid app slug");
  }
  if (app.version !== pkg.version || !/^\d+\.\d+\.\d+$/.test(app.version)) {
    throw new Error(
      "This developer packager requires matching x.y.z app/package versions",
    );
  }
  if (app.skills || app.mcp || app.locales) {
    throw new Error(
      "Terminal packaging currently has no Skill/MCP/locale payload; declare these only after adding their packaging",
    );
  }
  const assets = new Set();
  for (const icon of [app.icon, app.composerIcon, app.developer?.logo].filter(
    Boolean,
  )) {
    for (const theme of ["light", "dark"]) {
      const path = await packagePath(root, icon[theme]);
      if (!(await lstat(path)).isFile())
        throw new Error(`Expected icon file: ${path}`);
      assets.add(relative(root, path));
    }
  }
  if (!app.icon?.light || !app.icon?.dark)
    throw new Error("Both icon themes are required");
  return { app, pkg, assets: [...assets] };
}

export async function copyMetadata(destination, info) {
  await mkdir(destination, { recursive: true });
  await cp(join(root, "app.json"), join(destination, "app.json"));
  for (const asset of info.assets) {
    const { dirname } = await import("node:path");
    await mkdir(dirname(join(destination, asset)), { recursive: true });
    await cp(join(root, asset), join(destination, asset));
  }
}

async function main() {
  if (
    process.platform !== "linux" ||
    Number(process.versions.node.split(".")[0]) !== 22
  ) {
    throw new Error(
      "Package on Linux with Node.js 22 (the CI Debian builder). No host-native artifact may be labelled Linux.",
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
    const runtime = join(temporary, "payload/runtime");
    const deps = join(temporary, "dependencies");
    await mkdir(runtime, { recursive: true });
    await mkdir(deps);
    for (const file of ["package.json", "bun.lock"]) {
      await cp(join(root, file), join(deps, file));
    }
    // This is author/CI packaging. No package manager will run on the Gateway.
    await run(
      "bun",
      ["install", "--production", "--frozen-lockfile", "--ignore-scripts"],
      deps,
    );
    await run("npm", ["rebuild", "node-pty", "--build-from-source"], deps, {
      npm_config_build_from_source: "true",
    });
    const modules = join(deps, "node_modules");
    const canonicalModules = await realpath(modules);
    // Materialize package-manager symlinks, but never follow links out of this
    // isolated production install. No developer node_modules is copied.
    await cp(modules, join(runtime, "node_modules"), {
      recursive: true,
      dereference: true,
      async filter(source) {
        const actual = await realpath(source);
        if (
          actual !== canonicalModules &&
          !actual.startsWith(`${canonicalModules}${sep}`)
        ) {
          throw new Error(
            `Dependency symlink escapes production install: ${source}`,
          );
        }
        return true;
      },
    });
    for (const entry of await readdir(join(root, ".next"))) {
      await mkdir(join(runtime, ".next"), { recursive: true });
      if (
        [
          "cache",
          "dev",
          "diagnostics",
          "types",
          "trace",
          "trace-build",
        ].includes(entry)
      )
        continue;
      await cp(join(root, ".next", entry), join(runtime, ".next", entry), {
        recursive: true,
      });
    }
    await cp(join(root, "public"), join(runtime, "public"), {
      recursive: true,
    });
    await cp(join(root, "next.config.mjs"), join(runtime, "next.config.mjs"));
    await cp(join(root, "build/server.cjs"), join(runtime, "server.cjs"));
    await cp(join(root, "packaging/start.cjs"), join(runtime, "start.cjs"));
    await writeJson(join(runtime, "runtime-target.json"), {
      platform: process.platform,
      arch: process.arch,
      nodeModulesABI: process.versions.modules,
      nodeMajor: 22,
    });
    await writeJson(join(runtime, "package.json"), {
      name: info.pkg.name,
      version: info.pkg.version,
      private: true,
      scripts: { start: "node start.cjs" },
      dependencies: info.pkg.dependencies,
    });
    const elf = await readFile(
      join(runtime, "node_modules/node-pty/build/Release/pty.node"),
    );
    const machine = process.arch === "arm64" ? 183 : 62;
    if (
      !elf.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
      elf[5] !== 1 ||
      elf.readUInt16LE(18) !== machine
    ) {
      throw new Error(`node-pty native binary is not ${target} ELF`);
    }
    const release = join(temporary, "release");
    await mkdir(release);
    const archive = `${info.app.slug}-${info.app.version}-${target}.tar.gz`;
    await writeJson(
      join(release, "files.json"),
      await fileIndex(join(temporary, "payload")),
    );
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
      buildBase: "debian-bookworm",
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

if (
  process.argv[1] &&
  (await realpath(process.argv[1])) ===
    (await realpath(new URL(import.meta.url)))
) {
  await main();
}

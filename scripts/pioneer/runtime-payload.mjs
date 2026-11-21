import { cp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { root, writeJson } from "./common.mjs";
import { copyRuntimeDependencies } from "./trace-runtime.mjs";

/** Materialize the existing Next output and the traced production server. */
export async function createRuntimePayload(temporary, info) {
  const runtime = join(temporary, "payload/runtime");
  await mkdir(runtime, { recursive: true });
  await copyRuntimeDependencies(
    runtime,
    join(temporary, "dependency-trace.json"),
  );
  for (const entry of await readdir(join(root, ".next"))) {
    await mkdir(join(runtime, ".next"), { recursive: true });
    if (
      [
        "standalone",
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
  await writeJson(join(runtime, "runtime-target.json"), {
    platform: process.platform,
    arch: process.arch,
    nodeModulesABI: process.versions.modules,
    nodeMajor: 26,
  });
  await writeJson(join(runtime, "package.json"), {
    name: info.pkg.name,
    version: info.app.version,
    private: true,
    dependencies: {
      next: info.pkg.dependencies.next,
      ws: info.pkg.dependencies.ws,
      "@pioneercompany/app-sdk": info.pkg.dependencies["@pioneercompany/app-sdk"],
    },
  });
}

import { cp, lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { root, writeJson } from "./common.mjs";

const require = createRequire(join(root, "package.json"));
// Next is pinned. Reuse the same tracer as this exact Next build, not a second
// independently versioned framework/packager dependency.
export async function copyRuntimeDependencies(runtime, reportPath) {
  // The assemble job imports package metadata helpers without installing Next.
  // Load build-only tools only when actually producing a runtime artifact.
  const { nodeFileTrace } = require("next/dist/compiled/@vercel/nft");
  const canonicalRoot = await realpath(root);
  const standalone = join(root, ".next/standalone/node_modules");
  if (!(await lstat(standalone)).isDirectory()) {
    throw new Error("Missing Next standalone dependency output; rebuild first");
  }
  const withinProject = async (source) => {
    const actual = await realpath(source);
    if (!actual.startsWith(`${canonicalRoot}${sep}`)) {
      throw new Error(`Traced dependency escapes the build project: ${source}`);
    }
    return true;
  };
  // This is Next's already traced production closure, not its full npm package.
  await cp(standalone, join(runtime, "node_modules"), {
    recursive: true,
    dereference: true,
    filter: withinProject,
  });
  const trace = await nodeFileTrace([join(root, "build/server.cjs")], {
    base: root,
    processCwd: root,
    conditions: ["node", "production"],
    fileIOConcurrency: 32,
    // Next's own closure comes from its standalone collector. Re-tracing Next's
    // public entry without Next's collector rules also follows development code.
    ignore: ["node_modules/next/**", "node_modules/@next/**"],
  });
  const selected = new Set(trace.fileList);
  const warnings = [...trace.warnings].map((warning) => warning.message);
  if (warnings.length) {
    throw new Error(`Unresolved custom server dependencies:\n${warnings.join("\n")}`);
  }
  const copied = [];
  for (const entry of [...selected].sort()) {
    if (!entry.startsWith("node_modules/")) continue;
    const source = join(root, entry);
    await withinProject(source);
    if ((await lstat(source)).isDirectory()) continue;
    const destination = join(runtime, entry);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { dereference: true });
    copied.push(entry);
  }
  // Production packages must not contain compiler/tooling or a second libc's
  // binaries. Fail instead of pruning potentially necessary code silently.
  const { filesUnder } = await import("./common.mjs");
  for (const file of await filesUnder(join(runtime, "node_modules"))) {
    const path = relative(runtime, file).split(sep).join("/");
    if (
      /node_modules\/(?:@next\/swc-|@tailwindcss\/|lightningcss|lucide-react\/|node-pty\/|ws\/|tsx\/|typescript\/|@playwright\/|playwright|eslint\/|prettier\/)/.test(
        path,
      ) ||
      path.includes("linuxmusl") ||
      path.includes("-musl/")
    ) {
      throw new Error(
        `Build-only or wrong-libc dependency in runtime trace: ${path}`,
      );
    }
  }
  await writeJson(reportPath, {
    strategy: "Next standalone production closure plus custom server NFT trace",
    nextVersion: JSON.parse(
      await readFile(require.resolve("next/package.json"), "utf8"),
    ).version,
    customServerFiles: copied,
    // NFT can report optional/foreign-platform imports. Keep its diagnostics
    // visible for source review; never call static tracing runtime validation.
    warnings,
  });
}

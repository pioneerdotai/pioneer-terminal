import { cp, lstat, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { json, root } from "./common.mjs";
import { packagePath } from "./files.mjs";

// Shared manifest and icon metadata; importing it never runs packaging.
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


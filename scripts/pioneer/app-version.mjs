import { join } from "node:path";
import { json, root } from "./common.mjs";

const releaseVersion =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;

export function validateAppVersion(version) {
  if (typeof version !== "string" || !releaseVersion.test(version)) {
    throw new Error(
      `app.json version is ${JSON.stringify(version) ?? "missing"}; expected X.Y.Z (for example, 0.3.0).`,
    );
  }
}

export async function readAppManifest() {
  const app = await json(join(root, "app.json"));
  validateAppVersion(app?.version);
  return app;
}

export function validateReleaseTag(tag, version) {
  const expected = `v${version}`;
  if (tag !== expected) {
    throw new Error(
      `Release tag ${JSON.stringify(tag)} does not match app.json version ${JSON.stringify(version)}. Expected tag ${expected} for this commit.`,
    );
  }
}

if (import.meta.main) {
  try {
    const { version } = await readAppManifest();
    const tag = process.argv[2];
    if (tag !== undefined) validateReleaseTag(tag, version);
    console.log(`version=${version}`);
  } catch (error) {
    const message = error.message;
    if (process.env.GITHUB_ACTIONS === "true") {
      const escaped = message
        .replaceAll("%", "%25")
        .replaceAll("\r", "%0D")
        .replaceAll("\n", "%0A");
      console.error(
        `::error file=app.json,title=Release version check::${escaped}`,
      );
    } else {
      console.error(message);
    }
    process.exitCode = 1;
  }
}

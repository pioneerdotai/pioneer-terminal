import assert from "node:assert/strict";
import { test } from "node:test";

test("app.json must declare a stable X.Y.Z version", async () => {
  const { validateAppVersion } =
    await import("../scripts/pioneer/app-version.mjs");
  for (const version of ["0.0.0", "12.3.45"]) validateAppVersion(version);
  for (const version of [undefined, 1, "v1.2.3", "01.2.3", "1.2.3-rc.1"])
    assert.throws(() => validateAppVersion(version), /app\.json.*X\.Y\.Z/);
});

test("a release tag must match the manifest and report the expected tag", async () => {
  const { validateReleaseTag } =
    await import("../scripts/pioneer/app-version.mjs");
  validateReleaseTag("v0.3.0", "0.3.0");
  for (const tag of ["v0.2.0", "0.3.0", ""]) {
    assert.throws(() => validateReleaseTag(tag, "0.3.0"), {
      message: `Release tag ${JSON.stringify(tag)} does not match app.json version "0.3.0". Expected tag v0.3.0 for this commit.`,
    });
  }
});

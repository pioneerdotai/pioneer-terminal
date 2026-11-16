import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readAppearance,
} from "../features/terminal/settings/appearance";

test("stored font size is bounded and legacy theme choices do not override the host", () => {
  for (const value of [
    null,
    "{",
    "null",
    "[]",
    '"light"',
    '{"theme":"unknown","fontSize":999}',
    '{"theme":{},"fontSize":"18"}',
  ])
    assert.deepEqual(readAppearance(value), { fontSize: 13 });
  assert.deepEqual(
    readAppearance(
      '{"theme":"light","fontSize":18,"session":"not-a-preference"}',
    ),
    { fontSize: 18 },
  );
  assert.deepEqual(readAppearance('{"theme":"dark","fontSize":14.5}'), {
    fontSize: 13,
  });
});

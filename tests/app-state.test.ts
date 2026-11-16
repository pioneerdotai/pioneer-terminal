import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppState } from "../server/state/route";
import { AppStateStore } from "../server/state/store";
import { STATE_FILE } from "../server/state/validation";

test("personal state stays isolated through concurrent commits, deletion and execution restart", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "terminal-state-"));
  const alice = "A".repeat(21), bob = "B".repeat(21);
  let state = new AppState(directory, "first-execution");
  await state.load();
  // The owner argument represents server-authenticated context; the HTTP fixture
  // lets each request select that context without starting a Gateway or Next app.
  const server = createServer((req, res) => {
    const owner = req.headers["test-owner"] as string;
    void state.handle(req, res, owner).catch(() => res.writeHead(500).end());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/state`;
  const read = async (owner: string) => (await fetch(url, { headers: { "test-owner": owner } })).json();
  const update = async (owner: string, execution: string, changes: Record<string, string | null>) => {
    // Body/query identity must not redirect writes away from trusted context.
    const response = await fetch(`${url}?owner=${bob}`, { method: "POST", headers: { "Content-Type": "application/json", "test-owner": owner }, body: JSON.stringify({ execution, changes, owner: bob }) });
    await response.arrayBuffer();
    return response.status;
  };
  const anonymous = await fetch(url);
  assert.equal(anonymous.status, 403);
  await anonymous.arrayBuffer();
  assert.deepEqual(await read(alice), { execution: "first-execution", values: {} });
  assert.deepEqual(await read(bob), { execution: "first-execution", values: {} });
  assert.deepEqual(await Promise.all([
    update(alice, "first-execution", { "wterm.local.appearance.v1": "light" }),
    update(alice, "first-execution", { "wterm.local.shortcuts.v1": "alice-shortcuts" }),
    update(bob, "first-execution", { "wterm.local.appearance.v1": "dark", "wterm.local.shortcuts.v1": "bob-shortcuts" }),
  ]), [200, 200, 200]);
  state = new AppState(directory, "first-execution");
  await state.load();
  assert.deepEqual(await read(alice), { execution: "first-execution", values: { "wterm.local.appearance.v1": "light", "wterm.local.shortcuts.v1": "alice-shortcuts" } });
  assert.deepEqual(await read(bob), { execution: "first-execution", values: { "wterm.local.appearance.v1": "dark", "wterm.local.shortcuts.v1": "bob-shortcuts" } });
  assert.equal(await update(alice, "first-execution", {
    "wterm.local.recovery.v1:first-execution": "must not persist output",
  }), 500);
  assert.equal(await update(alice, "stale-execution", { "wterm.local.appearance.v1": "stale" }), 409);
  state = new AppState(directory, "second-execution");
  await state.load();
  assert.deepEqual(await read(alice), { execution: "second-execution", values: { "wterm.local.appearance.v1": "light", "wterm.local.shortcuts.v1": "alice-shortcuts" } });
  assert.deepEqual(await read(bob), { execution: "second-execution", values: { "wterm.local.appearance.v1": "dark", "wterm.local.shortcuts.v1": "bob-shortcuts" } });
  assert.equal(await update(alice, "second-execution", { "wterm.local.appearance.v1": null }), 200);
  state = new AppState(directory, "second-execution");
  await state.load();
  assert.deepEqual(await read(alice), { execution: "second-execution", values: { "wterm.local.shortcuts.v1": "alice-shortcuts" } });
  assert.deepEqual(await read(bob), { execution: "second-execution", values: { "wterm.local.appearance.v1": "dark", "wterm.local.shortcuts.v1": "bob-shortcuts" } });
});


test("startup deletes legacy session data from disk without changing preferences or waiting for a write", async t => {
  const directory = await mkdtemp(join(tmpdir(), "terminal-state-migration-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const owner = "A".repeat(21);
  const preferences = { "wterm.local.appearance.v1": '{"fontSize":18}' };
  const file = join(directory, STATE_FILE);
  await writeFile(file, JSON.stringify({
    version: 1,
    execution: "same-execution",
    users: {
      [owner]: {
        ...preferences,
        "wterm.local.recovery.v1:same-execution": '["session-1"]',
        "wterm.local.recovery.v1:same-execution:session-1": '{"session":"private-token"}',
        "wterm.local.recovery.v1:same-execution:session-1.0": '{"type":"output","data":"cHJpdmF0ZQ=="}',
      },
    },
  }));
  const store = new AppStateStore(directory, "same-execution");
  await store.load();
  assert.deepEqual(await store.read(owner), preferences);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
    version: 1, execution: "same-execution", users: { [owner]: preferences },
  });
  const reopened = new AppStateStore(directory, "later-execution");
  await reopened.load();
  assert.deepEqual(await reopened.read(owner), preferences);
});

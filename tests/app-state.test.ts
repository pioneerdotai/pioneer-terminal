import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppState } from "../lib/app-state";

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
    update(alice, "first-execution", { "wterm.local.recovery.v1:first-execution": "alice-session" }),
    update(bob, "first-execution", { "wterm.local.appearance.v1": "dark", "wterm.local.recovery.v1:first-execution": "bob-session" }),
  ]), [200, 200, 200]);
  state = new AppState(directory, "first-execution");
  await state.load();
  assert.deepEqual(await read(alice), { execution: "first-execution", values: { "wterm.local.appearance.v1": "light", "wterm.local.recovery.v1:first-execution": "alice-session" } });
  assert.deepEqual(await read(bob), { execution: "first-execution", values: { "wterm.local.appearance.v1": "dark", "wterm.local.recovery.v1:first-execution": "bob-session" } });
  assert.equal(await update(alice, "stale-execution", { "wterm.local.appearance.v1": "stale" }), 409);
  state = new AppState(directory, "second-execution");
  await state.load();
  assert.deepEqual(await read(alice), { execution: "second-execution", values: { "wterm.local.appearance.v1": "light" } });
  assert.deepEqual(await read(bob), { execution: "second-execution", values: { "wterm.local.appearance.v1": "dark" } });
  assert.equal(await update(alice, "second-execution", { "wterm.local.appearance.v1": null }), 200);
  state = new AppState(directory, "second-execution");
  await state.load();
  assert.deepEqual(await read(alice), { execution: "second-execution", values: {} });
  assert.deepEqual(await read(bob), { execution: "second-execution", values: { "wterm.local.appearance.v1": "dark" } });
});

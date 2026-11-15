import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as settle } from "node:timers/promises";
import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import {
  TerminalSessions,
  type SpawnPty,
  type TerminalSize,
} from "../lib/terminal-sessions";
import {
  HANDSHAKE_MS,
  SESSION_GRACE_MS,
  SESSION_LIMIT,
  OUTPUT_WINDOW,
  OUTPUT_PENDING_LIMIT,
} from "../lib/terminal-protocol";

class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  sent: (string | Buffer)[] = [];
  code: number | undefined;
  send(data: string | Uint8Array) {
    this.sent.push(typeof data === "string" ? data : Buffer.from(data));
  }
  close(code = 1000) {
    this.readyState = 3;
    this.code = code;
    this.emit("close", code);
  }
  async message(data: object) {
    this.emit("message", Buffer.from(JSON.stringify(data)));
    await settle();
  }
  binary() {
    return Buffer.concat(
      this.sent.filter((data): data is Buffer => Buffer.isBuffer(data)),
    );
  }
  ready() {
    return JSON.parse(
      this.sent.find((data) => typeof data === "string") as string,
    );
  }
}
const size: TerminalSize = {
  type: "resize",
  cols: 80,
  rows: 24,
  width: 800,
  height: 480,
};
function setup() {
  let events: Parameters<SpawnPty>[1];
  let spawns = 0,
    kills = 0,
    pauses = 0;
  const inputs: string[] = [];
  const sizes: TerminalSize[] = [];
  const sessions = new TerminalSessions((initial, callbacks) => {
    spawns++;
    events = callbacks;
    sizes.push(initial);
    return {
      write: (data) => {
        inputs.push(data);
      },
      resize: (next) => sizes.push(next),
      pause: () => pauses++,
      resume: () => {},
      dispose: (kill) => {
        if (kill) kills++;
      },
    };
  });
  const attach = (session: string | null = null, bytes = 0, owner = "A".repeat(21)) => {
    const socket = new Socket();
    sessions.accept(socket as unknown as WebSocket, owner);
    socket.message({ type: "attach", session, bytes });
    return socket;
  };
  return {
    sessions,
    attach,
    inputs,
    sizes,
    data: (data: string | Uint8Array) => events.data(data),
    cwd: (path: string) => events.cwd(path),
    exit: () => events.exit(),
    counts: () => ({ spawns, kills, pauses }),
  };
}

test("users cannot attach to each other's PTYs or interrupt an owner, while same-user reconnect works", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup();
  t.after(() => h.sessions.close());
  const alice = "A".repeat(21), bob = "B".repeat(21);
  const first = h.attach(null, 0, alice);
  const token = first.ready().session;
  await first.message(size);
  h.data("alice-private");
  t.mock.timers.tick(4);

  const intruder = new Socket();
  h.sessions.accept(intruder as unknown as WebSocket, bob);
  // An owner claimed in browser-controlled protocol data has no authority.
  await intruder.message({ type: "attach", session: token, bytes: 0, owner: alice });
  assert.equal(intruder.code, 4404);
  assert.equal(intruder.sent.length, 0);
  assert.equal(first.readyState, 1);
  await intruder.message({ type: "input", id: 1, data: "intrusion" });
  await intruder.message({ ...size, cols: 120 });
  await intruder.message({ type: "close" });
  assert.deepEqual(h.inputs, []);
  assert.deepEqual(h.sizes, [size]);
  assert.equal(h.counts().kills, 0);
  await first.message({ type: "input", id: 1, data: "alice" });
  assert.deepEqual(h.inputs, ["alice"]);

  first.close(1006);
  const resumed = h.attach(token, 0, alice);
  assert.equal(resumed.ready().session, token);
  t.mock.timers.tick(4);
  assert.equal(resumed.binary().toString(), "alice-private");
  assert.equal(h.counts().spawns, 1);

  const second = h.attach(null, 0, bob);
  assert.notEqual(second.ready().session, token);
  await second.message(size);
  h.data("bob-private");
  t.mock.timers.tick(4);
  assert.equal(second.binary().toString(), "bob-private");
  assert.equal(resumed.binary().toString(), "alice-private");
  await second.message({ type: "input", id: 1, data: "bob" });
  await second.message({ type: "close" });
  assert.deepEqual(h.inputs, ["alice", "bob"]);
  assert.equal(resumed.readyState, 1);
  assert.equal(h.sessions.size, 1);
});

test("one PTY survives detach, lost ACK, and takeover with old callbacks fenced", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup();
  t.after(() => h.sessions.close());
  const first = h.attach();
  const token = first.ready().session;
  await first.message(size);
  await first.message({ type: "input", id: 1, data: "once" });
  h.data("prefix");
  t.mock.timers.tick(4);
  await first.message({ type: "ack", bytes: 2 });
  h.data("suffix");
  first.close(1006);
  h.data("detached");
  assert.equal(h.counts().kills, 0);
  const second = h.attach(token, 6);
  assert.equal(second.ready().resumed, true);
  assert.equal(second.binary().toString(), "suffixdetached");
  await second.message({ ...size, cols: 100 });
  const third = h.attach(token, 6);
  await first.message({ type: "input", id: 2, data: "stale" });
  await second.message({ type: "ack", bytes: 999999 });
  await second.message({ ...size, cols: 1 });
  await second.message({ type: "close" });
  second.emit("close", 1000);
  assert.equal(third.binary().toString(), "suffixdetached");
  assert.equal(h.sessions.size, 1);
  assert.equal(h.counts().spawns, 1);
  assert.deepEqual(h.inputs, ["once"]);
  assert.deepEqual(
    h.sizes.map((value) => value.cols),
    [80, 100],
  );
  await third.message({ type: "ack", bytes: 20 });
  await third.message({ type: "close" });
  assert.equal(h.counts().kills, 1);
  assert.equal(h.sessions.size, 0);
  t.mock.timers.tick(SESSION_GRACE_MS);
  assert.equal(h.counts().kills, 1);
});

test("expiry and unavailable output never silently create a replacement shell", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup();
  t.after(() => h.sessions.close());
  const first = h.attach();
  const token = first.ready().session;
  await first.message(size);
  h.data("123456");
  t.mock.timers.tick(4);
  await first.message({ type: "ack", bytes: 4 });
  assert.equal(h.attach(token, 3).code, 4409);
  assert.equal(h.attach(token, 7).code, 4409);
  await first.message({ type: "input", id: 1, data: "still alive" });
  assert.deepEqual(h.inputs, ["still alive"]);
  first.close(1006);
  t.mock.timers.tick(SESSION_GRACE_MS - 1);
  assert.equal(h.counts().kills, 0);
  t.mock.timers.tick(1);
  assert.equal(h.counts().kills, 1);
  assert.equal(h.attach(token, 4).code, 4404);
  assert.equal(h.counts().spawns, 1);
});

test("a PTY read burst shares one frame while input stays immediately available", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup();
  t.after(() => h.sessions.close());
  const socket = h.attach();
  await socket.message(size);
  const bytes = Buffer.from("語😀\x1b[31moutput\x1b[0m\r\n".repeat(20));
  for (const byte of bytes) h.data(Uint8Array.of(byte));
  assert.equal(socket.binary().length, 0);
  await socket.message({ type: "input", id: 1, data: "responsive" });
  assert.deepEqual(h.inputs, ["responsive"]);
  assert.deepEqual(JSON.parse(socket.sent.at(-1) as string), {
    type: "input-ack",
    input: 1,
  });
  t.mock.timers.tick(4);
  assert.deepEqual(socket.binary(), bytes);
  assert.equal(socket.sent.filter(Buffer.isBuffer).length, 1);
  h.exit();
  assert.equal(socket.code, undefined);
  await socket.message({ type: "ack", bytes: bytes.length });
  assert.equal(socket.code, 1000);
});

test("detached final output drains after reconnect and overflow releases the PTY", async () => {
  const h = setup();
  const first = h.attach();
  await first.message(size);
  first.close(1006);
  h.data("final");
  h.exit();
  const next = h.attach(first.ready().session, 0);
  assert.equal(next.binary().toString(), "final");
  await next.message({ type: "ack", bytes: 5 });
  assert.equal(next.code, 1000);
  assert.equal(h.counts().kills, 0);
  assert.equal(h.sessions.size, 0);
  const overflow = h.attach();
  await overflow.message(size);
  overflow.close(1006);
  h.data("x".repeat(OUTPUT_PENDING_LIMIT + 1));
  assert.equal(h.counts().kills, 1);
  assert.equal(h.sessions.size, 0);
});

test("unattached connections expire and session retention has a hard count limit", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup();
  t.after(() => h.sessions.close());
  const silent = new Socket();
  h.sessions.accept(silent as unknown as WebSocket, "A".repeat(21));
  t.mock.timers.tick(HANDSHAKE_MS);
  assert.equal(silent.code, 1002);
  await silent.message({ type: "attach", session: null, bytes: 0 });
  assert.equal(h.sessions.size, 0);
  for (let i = 0; i < SESSION_LIMIT; i++) h.attach().close(1006);
  assert.equal(h.attach().code, 1013);
  assert.equal(h.sessions.size, SESSION_LIMIT);
  t.mock.timers.tick(SESSION_GRACE_MS);
  assert.equal(h.sessions.size, 0);
});

test("working-directory updates retry after socket backlog and refresh on attachment", async () => {
  const h = setup();
  const first = h.attach();
  await first.message(size);
  first.bufferedAmount = OUTPUT_WINDOW + 1;
  h.cwd("/tmp");
  assert.equal(first.sent.length, 1);
  first.bufferedAmount = 0;
  h.cwd("/tmp");
  h.cwd("/tmp");
  assert.equal(first.sent.length, 2);
  first.close(1006);
  h.cwd("/tmp/new");
  const next = h.attach(first.ready().session);
  assert.deepEqual(JSON.parse(next.sent[1] as string), {
    type: "cwd",
    cwd: "/tmp/new",
  });
  h.sessions.close();
});

test("a failed shell spawn reports output once and drains before closing", async () => {
  let attempts = 0;
  const sessions = new TerminalSessions(() => {
    attempts++;
    throw new Error("Shell unavailable");
  });
  const socket = new Socket();
  sessions.accept(socket as unknown as WebSocket, "A".repeat(21));
  await socket.message({ type: "attach", session: null, bytes: 0 });
  await socket.message(size);
  await socket.message(size);
  assert.equal(attempts, 1);
  assert.match(
    socket.binary().toString(),
    /Failed to initialize host terminal/,
  );
  assert.equal(socket.code, undefined);
  await socket.message({ type: "ack", bytes: socket.binary().length });
  assert.equal(socket.code, 1000);
  assert.equal(sessions.size, 0);
});

test("accepted input IDs are deduplicated across attachments and gaps are rejected", async () => {
  const h = setup();
  const first = h.attach();
  await first.message(size);
  await first.message({ type: "input", id: 1, data: "command\r" });
  await first.message({ type: "input", id: 1, data: "command\r" });
  assert.deepEqual(JSON.parse(first.sent.at(-1) as string), {
    type: "input-ack",
    input: 1,
  });
  const next = h.attach(first.ready().session);
  assert.equal(next.ready().input, 1);
  await next.message({ type: "input", id: 1, data: "command\r" });
  await first.message({ type: "input", id: 2, data: "stale\r" });
  await next.message({ type: "input", id: 2, data: "new\r" });
  assert.deepEqual(h.inputs, ["command\r", "new\r"]);
  assert.deepEqual(JSON.parse(next.sent.at(-1) as string), {
    type: "input-ack",
    input: 2,
  });
  await next.message({ type: "input", id: 4, data: "gap\r" });
  assert.equal(next.code, 1002);
  assert.deepEqual(h.inputs, ["command\r", "new\r"]);
  assert.equal(h.sessions.size, 0);
});

test("a lost input acknowledgment retains the accepted prefix without repeating a write", async () => {
  const h = setup();
  const first = h.attach();
  await first.message(size);
  first.send = () => {
    throw new Error("Connection lost during ACK");
  };
  await first.message({ type: "input", id: 1, data: "once\r" });
  assert.equal(first.code, 4000);
  assert.equal(h.counts().kills, 0);
  const next = h.attach(first.ready().session);
  assert.equal(next.ready().input, 1);
  await next.message({ type: "input", id: 1, data: "once\r" });
  assert.deepEqual(h.inputs, ["once\r"]);
  h.sessions.close();
});

test("input acknowledgments coalesce under socket pressure and stop polling when detached", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup();
  t.after(() => h.sessions.close());
  const first = h.attach();
  await first.message(size);
  first.bufferedAmount = OUTPUT_WINDOW + 1;
  for (let id = 1; id <= 100; id++)
    await first.message({ type: "input", id, data: "x" });
  t.mock.timers.tick(16);
  assert.equal(first.sent.length, 1);
  first.bufferedAmount = 0;
  t.mock.timers.tick(16);
  assert.equal(first.sent.length, 2);
  assert.deepEqual(JSON.parse(first.sent[1] as string), {
    type: "input-ack",
    input: 100,
  });
  first.bufferedAmount = OUTPUT_WINDOW + 1;
  await first.message({ type: "input", id: 101, data: "y" });
  first.close(1006);
  first.bufferedAmount = 0;
  t.mock.timers.tick(100);
  assert.equal(first.sent.length, 2);
  const next = h.attach(first.ready().session);
  assert.equal(next.ready().input, 101);
  await next.message({ type: "input", id: 102, data: "z" });
  assert.deepEqual(JSON.parse(next.sent[1] as string), {
    type: "input-ack",
    input: 102,
  });
  assert.equal(h.inputs.length, 102);
});

test("a throwing PTY writer is never acknowledged or made available for replay", async () => {
  let writes = 0,
    kills = 0;
  const sessions = new TerminalSessions(() => ({
    write: () => {
      writes++;
      throw new Error("write failed");
    },
    resize: () => {},
    pause: () => {},
    resume: () => {},
    dispose: () => {
      kills++;
    },
  }));
  const socket = new Socket();
  sessions.accept(socket as unknown as WebSocket, "A".repeat(21));
  await socket.message({ type: "attach", session: null, bytes: 0 });
  await socket.message(size);
  await socket.message({ type: "input", id: 1, data: "uncertain" });
  assert.equal(socket.code, 1011);
  assert.equal(socket.sent.length, 1);
  assert.equal(writes, 1);
  assert.equal(kills, 1);
  const next = new Socket();
  sessions.accept(next as unknown as WebSocket, "A".repeat(21));
  await next.message({
    type: "attach",
    session: socket.ready().session,
    bytes: 0,
  });
  assert.equal(next.code, 4404);
});

test("invalid input IDs never reach the PTY and input after exit is not acknowledged", async () => {
  for (const id of [undefined, 0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1]) {
    const h = setup();
    const socket = h.attach();
    await socket.message(size);
    await socket.message({ type: "input", id, data: "rejected" });
    assert.equal(socket.code, 1002);
    assert.deepEqual(h.inputs, []);
    assert.equal(h.sessions.size, 0);
  }
  const h = setup();
  const socket = h.attach();
  await socket.message(size);
  h.data("final");
  h.exit();
  const sent = socket.sent.length;
  await socket.message({ type: "input", id: 1, data: "late reply" });
  await socket.message({ type: "input", id: 2, data: "another late reply" });
  assert.equal(socket.sent.length, sent);
  assert.equal(socket.code, undefined);
  assert.deepEqual(h.inputs, []);
  await socket.message({ type: "ack", bytes: 5 });
  assert.equal(socket.code, 1000);
});

test("takeover waits for pending Host acceptance before reporting the input prefix", async (t) => {
  let accept!: () => void;
  const pending = new Promise<void>((resolve) => {
    accept = resolve;
  });
  const writes: string[] = [];
  const sessions = new TerminalSessions(() => ({
    write(data) {
      writes.push(data);
      return pending;
    },
    resize() {},
    pause() {},
    resume() {},
    dispose() {},
  }));
  t.after(() => sessions.close());
  const first = new Socket();
  sessions.accept(first as unknown as WebSocket, "A".repeat(21));
  await first.message({ type: "attach", session: null, bytes: 0 });
  await first.message(size);
  await first.message({ type: "input", id: 1, data: "old" });
  assert.equal(first.sent.length, 1, "pending input is not acknowledged");
  const next = new Socket();
  sessions.accept(next as unknown as WebSocket, "A".repeat(21));
  await next.message({
    type: "attach",
    session: first.ready().session,
    bytes: 0,
  });
  assert.equal(next.sent.length, 0, "ready must wait for the previous outcome");
  accept();
  await settle();
  assert.deepEqual(next.ready(), {
    type: "ready",
    session: first.ready().session,
    resumed: true,
    input: 1,
  });
  await next.message({ type: "input", id: 2, data: "new" });
  assert.deepEqual(writes, ["old", "new"]);
  next.close(1000);
  assert.equal(sessions.size, 1, "closing a view does not close its PTY");
});

test("input uses a bounded window while acknowledgments retain a contiguous accepted prefix", async (t) => {
  const writes: string[] = [];
  const accept: (() => void)[] = [];
  const sessions = new TerminalSessions(() => ({
    write(data) {
      writes.push(data);
      return new Promise<void>((resolve) => accept.push(resolve));
    },
    resize() {},
    pause() {},
    resume() {},
    dispose() {},
  }));
  t.after(() => sessions.close());
  const socket = new Socket();
  sessions.accept(socket as unknown as WebSocket, "A".repeat(21));
  await socket.message({ type: "attach", session: null, bytes: 0 });
  await socket.message(size);
  for (let id = 1; id <= 9; id++)
    await socket.message({ type: "input", id, data: String(id) });
  assert.deepEqual(writes, ["1", "2", "3", "4", "5", "6", "7", "8"]);
  assert.equal(
    socket.sent.length,
    1,
    "pending writes must not be acknowledged",
  );
  accept[1]();
  await settle();
  assert.equal(
    socket.sent.length,
    1,
    "accepting input 2 cannot acknowledge a gap before input 1",
  );
  accept[0]();
  await settle();
  assert.deepEqual(writes, ["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  assert.equal(JSON.parse(socket.sent.at(-1) as string).input, 2);
  for (let ix = accept.length - 1; ix >= 2; ix--) accept[ix]();
  await settle();
  assert.deepEqual(JSON.parse(socket.sent.at(-1) as string), {
    type: "input-ack",
    input: 9,
  });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { GatewayHost, HostError } from "../lib/gateway-host";

test(
  "Host transport retries ambiguous input with identical sequence and bytes, without browser Origin",
  { timeout: 5000 },
  async (t) => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(server, "listening");
    const address = server.address();
    assert.equal(typeof address, "object");
    const credential = "a".repeat(64);
    const host = new GatewayHost({
      execution_id: "e".repeat(21),
      ui_proxy: { credential: "b".repeat(64) },
      host_api: {
        endpoint: `ws://127.0.0.1:${(address as { port: number }).port}/apps/host`,
        credential,
        capabilities: ["host.pty"],
      },
    });
    t.after(async () => {
      host.close();
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const inputs: unknown[] = [];
    const violations: string[] = [];
    let opened!: () => void;
    const ready = new Promise<void>((resolve) => {
      opened = resolve;
    });
    server.on("connection", (socket, request) => {
      if (
        request.headers.authorization !== `Bearer ${credential}` ||
        request.headers.origin !== undefined
      )
        violations.push("invalid backend admission headers");
      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString());
        if (
          message.jsonrpc !== "2.0" ||
          !/^[A-Za-z0-9_-]{21}$/.test(message.id)
        )
          violations.push("invalid request envelope");
        let result: object;
        switch (message.method) {
          case "host.pty.create":
            result = {
              session_id: "s".repeat(21),
              input_sequence: 0,
              retention_seconds: 300,
            };
            break;
          case "host.pty.read":
            result = {
              bytes: [],
              next: 0,
              exit_status: null,
              failed: false,
              input_sequence: inputs.length ? 1 : 0,
            };
            break;
          case "host.pty.input":
            inputs.push(message.params);
            if (inputs.length === 1) {
              socket.terminate();
              return;
            }
            result = { accepted_sequence: 1 };
            break;
          case "host.pty.subscribe":
            result = { subscribed: true, window: 65536 };
            break;
          case "host.pty.ack":
            result = { acknowledged: true };
            break;
          case "host.pty.keepalive":
            result = { alive: true };
            break;
          case "host.pty.resize":
            result = { resized: true };
            break;
          case "host.pty.close":
            result = { closed: true };
            break;
          default:
            violations.push("unexpected host method");
            result = {};
        }
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
      });
    });
    const pty = host.spawn(
      { type: "resize", rows: 24, cols: 80, width: 800, height: 480 },
      {
        data() {},
        exit() {},
        cwd() {
          opened();
        },
      },
    );
    await ready;
    await pty.write("λ\r");
    const expected = {
      session_id: "s".repeat(21),
      sequence: 1,
      bytes: [206, 187, 13],
    };
    assert.deepEqual(inputs, [expected, expected]);
    assert.deepEqual(violations, []);
    pty.dispose(true);
  },
);

test("an App without an available host.pty service reports unavailability", async (t) => {
  const host = new GatewayHost({
    execution_id: "e".repeat(21),
    ui_proxy: { credential: "b".repeat(64) },
    host_api: null,
  });
  t.after(() => host.close());
  await assert.rejects(
    host.call("host.pty.create", {}),
    (error: unknown) =>
      error instanceof HostError &&
      /service is unavailable/.test(error.message),
  );
});

test(
  "pushed output reconnects at the delivered cursor and ignores superseded stream frames",
  { timeout: 5000 },
  async (t) => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(server, "listening");
    const address = server.address() as { port: number };
    const host = new GatewayHost({
      execution_id: "execution",
      ui_proxy: { credential: "ui" },
      host_api: {
        endpoint: `ws://127.0.0.1:${address.port}/apps/host`,
        credential: "a".repeat(64),
        capabilities: ["host.pty"],
      },
    });
    t.after(async () => {
      host.close();
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    let rendered = "",
      oldStream = "",
      connections = 0;
    const resumedFrom: number[] = [];
    let finish!: () => void;
    const complete = new Promise<void>((resolve) => {
      finish = resolve;
    });
    server.on("connection", (socket) => {
      const connection = ++connections;
      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString());
        const p = message.params;
        let result: object = {};
        if (message.method === "host.pty.create")
          result = { session_id: "session", input_sequence: 0 };
        if (message.method === "host.pty.subscribe")
          result = { subscribed: true, window: 65536 };
        if (message.method === "host.pty.ack") result = { acknowledged: true };
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
        const push = (stream_id: string, after: number, byte: number) =>
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "host.pty.output",
              params: {
                session_id: "session",
                stream_id,
                after,
                bytes: [byte],
                next: after + 1,
                end: 2,
                exit_status: null,
                failed: false,
              },
            }),
          );
        if (message.method === "host.pty.subscribe") {
          resumedFrom.push(p.after);
          if (connection === 1 && p.after === 0) {
            oldStream = p.stream_id;
            push(p.stream_id, 0, 65);
          } else if (connection > 1 && p.after === 1) {
            push(oldStream, 0, 88);
            push(p.stream_id, 1, 66);
          }
        } else if (
          message.method === "host.pty.ack" &&
          p.after === 1 &&
          connection === 1
        ) {
          socket.terminate();
        } else if (message.method === "host.pty.ack" && p.after === 2) finish();
      });
    });
    const pty = host.spawn(
      { type: "resize", rows: 24, cols: 80, width: 800, height: 480 },
      {
        data(data) {
          rendered +=
            typeof data === "string" ? data : Buffer.from(data).toString();
        },
        exit() {},
        cwd() {},
      },
    );
    await complete;
    assert.equal(rendered, "AB");
    assert.equal(resumedFrom[0], 0);
    assert.ok(
      resumedFrom.includes(1),
      "reconnect must retain the delivered prefix",
    );
    assert.ok(
      connections >= 2,
      "the test must exercise a real transport replacement",
    );
    pty.dispose(true);
  },
);

test(
  "resize bursts retain the final size without exhausting host requests or corrupting UTF-8",
  { timeout: 5000 },
  async (t) => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(server, "listening");
    const address = server.address() as { port: number };
    const host = new GatewayHost({
      execution_id: "execution",
      ui_proxy: { credential: "ui" },
      host_api: {
        endpoint: `ws://127.0.0.1:${address.port}/apps/host`,
        credential: "a".repeat(64),
        capabilities: ["host.pty"],
      },
    });
    t.after(async () => {
      host.close();
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const received: Buffer[] = [];
    const expected = Buffer.from("Привет\n");
    let exits = 0,
      subscriptions = 0,
      stream = "";
    const widths: number[] = [];
    let subscribed!: () => void,
      held!: () => void,
      latest!: () => void,
      outputReady!: () => void,
      releaseResize!: () => void;
    const connected = new Promise<void>((resolve) => {
      subscribed = resolve;
    });
    const firstResize = new Promise<void>((resolve) => {
      held = resolve;
    });
    const lastResize = new Promise<void>((resolve) => {
      latest = resolve;
    });
    const output = new Promise<void>((resolve) => {
      outputReady = resolve;
    });
    server.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString());
        const p = message.params;
        const reply = (result: object) =>
          socket.send(
            JSON.stringify({ jsonrpc: "2.0", id: message.id, result }),
          );
        switch (message.method) {
          case "host.pty.create":
            assert.equal(
              p.command,
              undefined,
              "the shell must be selected on the host",
            );
            reply({ session_id: "session", input_sequence: 0 });
            break;
          case "host.pty.subscribe":
            subscriptions++;
            stream = p.stream_id;
            reply({ subscribed: true, window: 65536 });
            subscribed();
            break;
          case "host.pty.resize":
            widths.push(p.dimensions.cols);
            if (widths.length === 1) {
              releaseResize = () => reply({ resized: true });
              held();
            } else {
              reply({ resized: true });
              if (p.dimensions.cols === 600) latest();
            }
            break;
          case "host.pty.input": {
            assert.deepEqual(p.bytes, Array.from(expected));
            reply({ accepted_sequence: p.sequence });
            // Split inside the first UTF-8 character, as PTY reads may do.
            let after = 0;
            for (const bytes of [
              expected.subarray(0, 1),
              expected.subarray(1),
            ]) {
              socket.send(
                JSON.stringify({
                  jsonrpc: "2.0",
                  method: "host.pty.output",
                  params: {
                    session_id: "session",
                    stream_id: stream,
                    after,
                    bytes: Array.from(bytes),
                    next: after + bytes.length,
                    end: expected.length,
                    exit_status: null,
                    failed: false,
                  },
                }),
              );
              after += bytes.length;
            }
            break;
          }
          case "host.pty.ack":
            reply({ acknowledged: true });
            break;
          default:
            reply({});
        }
      });
    });
    const size = {
      type: "resize" as const,
      rows: 24,
      cols: 80,
      width: 800,
      height: 480,
    };
    const pty = host.spawn(size, {
      data(data) {
        received.push(
          typeof data === "string"
            ? Buffer.from(data, "utf8")
            : Buffer.from(data),
        );
        if (Buffer.concat(received).length >= expected.length) outputReady();
      },
      exit() {
        exits++;
      },
      cwd() {},
    });
    await connected;
    pty.resize({ ...size, cols: 81 });
    await firstResize;
    for (let cols = 82; cols <= 600; cols++) pty.resize({ ...size, cols });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(exits, 0, "a resize burst must not terminate a terminal");
    assert.deepEqual(widths, [81], "only one resize may be in flight");
    releaseResize();
    await lastResize;
    assert.deepEqual(widths, [81, 600]);
    assert.equal(
      subscriptions,
      1,
      "startup must not replace an already live subscription",
    );
    await pty.write("Привет\n");
    await output;
    assert.deepEqual(Buffer.concat(received), expected);
    assert.equal(exits, 0);
    pty.dispose(true);
  },
);

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

// One bounded snapshot keeps each user's recovery events and heads consistent.
const LIMIT = 16 * 1024 * 1024;
const REQUEST_LIMIT = 6 * 1024 * 1024;
const FILE = "terminal-state.json";
export class AppState {
  private users = new Map<string, Record<string, string>>();
  private tail: Promise<void> = Promise.resolve();
  constructor(private directory: string, readonly execution: string) {}
  async load() {
    await mkdir(this.directory, { recursive: true });
    try {
      const raw = await readFile(join(this.directory, FILE), "utf8");
      if (Buffer.byteLength(raw) > LIMIT) throw new Error("State exceeds limit");
      const state = JSON.parse(raw);
      if (state.version !== 1 || typeof state.execution !== "string" || !state.users || typeof state.users !== "object" || Array.isArray(state.users)) throw new Error("Invalid state");
      this.users = new Map(Object.entries(state.users).map(([owner, values]) => {
        if (!this.validOwner(owner)) throw new Error("Invalid state owner");
        return [owner, this.validate(values)];
      }));
      if (state.execution !== this.execution) {
        for (const values of this.users.values()) {
          for (const key of Object.keys(values)) {
            if (key.startsWith("wterm.local.recovery.")) delete values[key];
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Cannot load Terminal state");
    }
  }
  private validOwner(owner: string): boolean {
    return owner === "local-development" || /^[A-Za-z0-9]{21}$/.test(owner);
  }
  private validate(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid state");
    const entries = Object.entries(value);
    if (entries.length > 34000 || entries.some(([key, data]) => key.length > 256 || !key.startsWith("wterm.") || typeof data !== "string" || data.length > 35000)) throw new Error("Invalid state");
    return Object.fromEntries(entries);
  }
  async handle(req: IncomingMessage, res: ServerResponse, owner: string) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    if (!this.validOwner(owner)) { res.writeHead(403).end(); return; }
    if (req.method === "GET") {
      await this.tail;
      res.end(JSON.stringify({ execution: this.execution, values: this.users.get(owner) ?? {} }));
      return;
    }
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > REQUEST_LIMIT) { res.writeHead(413).end(); return; }
      chunks.push(Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (body.execution !== this.execution) { res.writeHead(409).end(); return; }
    if (!body.changes || typeof body.changes !== "object" || Array.isArray(body.changes)) throw new Error("Invalid state changes");
    const changes = Object.entries(body.changes);
    if (changes.length > 34000 || changes.some(([key, value]) => key.length > 256 || !key.startsWith("wterm.") || (value !== null && (typeof value !== "string" || value.length > 35000)))) throw new Error("Invalid state changes");
    const commit = this.tail.then(async () => {
      // Resolve the namespace inside the serialized commit so simultaneous
      // writes by different users cannot replace one another's state.
      const next = new Map(Object.entries(this.users.get(owner) ?? {}));
      for (const [key, value] of changes) {
        if (value === null) next.delete(key);
        else next.set(key, value as string);
      }
      const values = this.validate(Object.fromEntries(next));
      const users = new Map(this.users);
      if (Object.keys(values).length) users.set(owner, values);
      else users.delete(owner);
      const raw = JSON.stringify({ version: 1, execution: this.execution, users: Object.fromEntries(users) });
      if (Buffer.byteLength(raw) > LIMIT) throw new Error("State exceeds limit");
      const file = join(this.directory, FILE);
      await writeFile(`${file}.tmp`, raw, { mode: 0o600 });
      await rename(`${file}.tmp`, file);
      this.users = users;
    });
    this.tail = commit.catch(() => {});
    await commit;
    res.end("{}");
  }
}

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isPreferenceKey } from "../../shared/preferences";
import {
  STATE_FILE,
  STATE_LIMIT,
  validOwner,
  validateValues,
} from "./validation";

// Only per-user font and shortcut preferences survive application closure.
export class AppStateStore {
  private users = new Map<string, Record<string, string>>();
  private tail: Promise<void> = Promise.resolve();

  constructor(private directory: string, readonly execution: string) {}

  async load() {
    await mkdir(this.directory, { recursive: true });
    try {
      const raw = await readFile(join(this.directory, STATE_FILE), "utf8");
      if (Buffer.byteLength(raw) > STATE_LIMIT) throw new Error("State exceeds limit");
      const state = JSON.parse(raw);
      if (
        state.version !== 1 ||
        typeof state.execution !== "string" ||
        !state.users || typeof state.users !== "object" ||
        Array.isArray(state.users)
      ) throw new Error("Invalid state");
      let cleaned = false;
      this.users = new Map(Object.entries(state.users).map(([owner, values]) => {
        if (!validOwner(owner)) throw new Error("Invalid state owner");
        const stored = validateValues(values);
        const preferences = Object.fromEntries(Object.entries(stored).filter(([key]) => isPreferenceKey(key)));
        if (Object.keys(preferences).length !== Object.keys(stored).length) cleaned = true;
        return [owner, preferences];
      }));
      if (cleaned) {
        // Rewrite the old snapshot so discarded output and session tokens no
        // longer occupy disk, even if no preference is changed afterward.
        const file = join(this.directory, STATE_FILE);
        await writeFile(`${file}.tmp`, JSON.stringify({
          version: 1, execution: this.execution, users: Object.fromEntries(this.users),
        }), { mode: 0o600 });
        await rename(`${file}.tmp`, file);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("Cannot load Terminal state");
    }
  }

  async read(owner: string): Promise<Record<string, string>> {
    await this.tail;
    return this.users.get(owner) ?? {};
  }

  async commit(owner: string, changes: [string, string | null][]): Promise<void> {
    const commit = this.tail.then(async () => {
      // Resolve the namespace inside the serialized commit so simultaneous
      // writes by different users cannot replace one another's state.
      const next = new Map(Object.entries(this.users.get(owner) ?? {}));
      for (const [key, value] of changes) {
        if (!isPreferenceKey(key)) throw new Error("Invalid preference");
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      const values = validateValues(Object.fromEntries(next));
      const users = new Map(this.users);
      if (Object.keys(values).length) users.set(owner, values);
      else users.delete(owner);
      const raw = JSON.stringify({
        version: 1,
        execution: this.execution,
        users: Object.fromEntries(users),
      });
      if (Buffer.byteLength(raw) > STATE_LIMIT) throw new Error("State exceeds limit");
      const file = join(this.directory, STATE_FILE);
      await writeFile(`${file}.tmp`, raw, { mode: 0o600 });
      await rename(`${file}.tmp`, file);
      this.users = users;
    });
    this.tail = commit.catch(() => {});
    await commit;
  }
}

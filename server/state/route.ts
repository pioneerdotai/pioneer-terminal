import type { IncomingMessage, ServerResponse } from "node:http";
import { AppStateStore } from "./store";
import { REQUEST_LIMIT, validOwner, validateChanges } from "./validation";

/** HTTP state contract; persistence and commit ordering belong to the store. */
export class AppState {
  private store: AppStateStore;

  constructor(directory: string, readonly execution: string) {
    this.store = new AppStateStore(directory, execution);
  }

  load(): Promise<void> {
    return this.store.load();
  }

  async handle(req: IncomingMessage, res: ServerResponse, owner: string) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    if (!validOwner(owner)) {
      res.writeHead(403).end();
      return;
    }
    if (req.method === "GET") {
      res.end(JSON.stringify({
        execution: this.execution,
        values: await this.store.read(owner),
      }));
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > REQUEST_LIMIT) {
        res.writeHead(413).end();
        return;
      }
      chunks.push(Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (body.execution !== this.execution) {
      res.writeHead(409).end();
      return;
    }
    const changes = validateChanges(body.changes);
    await this.store.commit(owner, changes);
    res.end("{}");
  }
}

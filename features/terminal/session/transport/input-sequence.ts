import {
  INPUT_LIMIT,
  INPUT_MESSAGES,
} from "../../../../shared/terminal-protocol";

type PreparedInput =
  | { type: "ready"; message: string }
  | { type: "rejected"; message: string }
  | { type: "exhausted" };

/** Retain wire lengths and sequence IDs; input text is never replayed. */
export class InputSequence {
  sent = 0;
  acknowledged = 0;
  private sizes: number[] = [];
  private bytes = 0;
  private rejectedOffline = false;

  get unconfirmed(): boolean {
    return this.sizes.length > 0;
  }

  rejectOffline(): void {
    this.rejectedOffline = true;
  }

  prepare(data: string, bufferedAmount: number): PreparedInput {
    // Reject before JSON/UTF-8 allocation when the string cannot fit.
    if (data.length > INPUT_LIMIT) {
      return {
        type: "rejected",
        message: "Input was not sent because the paste is too large.",
      };
    }
    if (!Number.isSafeInteger(this.sent + 1)) return { type: "exhausted" };
    const message = JSON.stringify({ type: "input", id: this.sent + 1, data });
    const bytes = new TextEncoder().encode(message).length;
    if (
      bytes > INPUT_LIMIT ||
      this.bytes + bytes > INPUT_LIMIT ||
      this.sizes.length >= INPUT_MESSAGES ||
      bufferedAmount + bytes > INPUT_LIMIT
    ) {
      return {
        type: "rejected",
        message: "Input was not sent because the connection is busy or the paste is too large.",
      };
    }
    this.sent++;
    this.sizes.push(bytes);
    this.bytes += bytes;
    return { type: "ready", message };
  }

  acknowledge(input: unknown): void {
    if (
      typeof input !== "number" ||
      !Number.isSafeInteger(input) ||
      input < this.acknowledged ||
      input > this.sent
    ) throw new Error("Invalid input acknowledgment");
    const count = input - this.acknowledged;
    for (const bytes of this.sizes.splice(0, count)) this.bytes -= bytes;
    this.acknowledged = input;
  }

  /** The server fenced the old socket; abandon only its unaccepted suffix. */
  resume(): boolean {
    const lost = this.unconfirmed || this.rejectedOffline;
    this.sent = this.acknowledged;
    this.clear();
    this.rejectedOffline = false;
    return lost;
  }

  clear(): void {
    this.sizes = [];
    this.bytes = 0;
  }
}

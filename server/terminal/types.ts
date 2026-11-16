import type { ClientMessage } from "../../shared/terminal-protocol";

export type TerminalSize = Extract<ClientMessage, { type: "resize" }>;
export interface SessionPty {
  write(data: string): void | Promise<void>;
  resize(size: TerminalSize): void;
  pause(): void;
  resume(): void;
  dispose(kill: boolean): void;
}
export type SpawnPty = (
  size: TerminalSize,
  events: {
    data(data: string | Uint8Array): void;
    exit(): void;
    cwd(path: string): void;
  },
) => SessionPty;


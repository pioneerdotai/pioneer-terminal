import type { TerminalConnection } from "./transport/connection";

// Only live connections in this document. No tokens or output are persisted.
const connections = new Set<TerminalConnection>();

export function trackConnection(connection: TerminalConnection): () => void {
  connections.add(connection);
  return () => { connections.delete(connection); };
}

export function closeConnections(): void {
  for (const connection of connections) connection.close();
  connections.clear();
}

"use client";

import { getAppClient } from "./pioneer";

type StateSnapshot = {
  execution: string;
  values: Record<string, string>;
};

/** Only the HTTP boundary knows the SDK URL and the state response shape. */
export async function readState(): Promise<StateSnapshot> {
  const app = await getAppClient();
  const response = await fetch(app.url("state"), {
    credentials: "omit",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Cannot load Terminal state");
  const state = await response.json();
  if (
    typeof state.execution !== "string" ||
    !state.values || typeof state.values !== "object" ||
    Array.isArray(state.values) ||
    Object.values(state.values).some((value) => typeof value !== "string")
  ) throw new Error("Invalid Terminal state");
  return state;
}

export async function writeState(
  execution: string,
  changes: ReadonlyMap<string, string | null>,
): Promise<void> {
  const app = await getAppClient();
  const response = await fetch(app.url("state"), {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ execution, changes: Object.fromEntries(changes) }),
  });
  if (!response.ok) throw new Error();
}

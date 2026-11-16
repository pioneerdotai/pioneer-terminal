"use client";

import { connectApp, type AppClient } from "@pioneercompany/app-sdk/client";

// Install the SDK listener at browser module initialization, before page load.
// The backend renders base href for both direct dev and grant-scoped views.
const connection = typeof window === "undefined" ? null : connectApp();
// Consumers surface initialization errors; module evaluation must not produce
// an unhandled rejection before the workspace's loadState effect runs.
void connection?.catch(() => {});

export function getAppClient(): Promise<AppClient> {
  return connection ?? Promise.reject(new Error("Terminal client requires a browser"));
}

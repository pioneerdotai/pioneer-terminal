import {
  nodeRequestHeaders,
  type AppServerContext,
} from "@pioneercompany/app-sdk/server";
import type { IncomingMessage } from "node:http";

export function requestIdentity(context: AppServerContext | null, local: boolean) {
  return {
    authorized(req: IncomingMessage): boolean {
      if (!context) return true;
      try {
        context.authenticateServiceRequest(nodeRequestHeaders(req));
        return true;
      } catch {
        return false;
      }
    },
    // Only use the owner after the execution credential check. The SDK
    // authenticates the principal supplied by Gateway, never browser input.
    owner(req: IncomingMessage): string | null {
      if (local) return "local-development";
      try {
        return context!.authenticateRequest(nodeRequestHeaders(req)).user.id;
      } catch {
        return null;
      }
    },
  };
}

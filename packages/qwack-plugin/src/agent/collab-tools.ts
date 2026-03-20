import { z } from "zod/v4";
import type { QwackToolDefinition } from "./tools";
import type { CollaboratorState } from "../state/collaborator-state";
import { readConfig } from "../auth/store";

/**
 * Accessor for collaboration state — QwackBridge implicitly satisfies this.
 */
 export interface CollabAccessor {
  readonly isActive: boolean;
  getSessionId(): string | null;
  getWsClient(): { send(msg: any): boolean; isConnected: boolean } | null;
  getCollaboratorState(): CollaboratorState | null;
}

/**
 * Collaboration tools for the Qwack agent — status, who, msg.
 * These let the agent query session state and communicate with the team.
 * Registered alongside peer tools (propose, disagree) at plugin load time.
 */
export function createCollabTools(
  accessor: CollabAccessor,
): Record<string, QwackToolDefinition> {
  return {
    qwack_status: {
      description:
        "Check the current Qwack session status, connection state, and server configuration. Call this to understand the collaboration context before making decisions.",
      args: {},
      async execute(): Promise<string> {
        const config = readConfig();
        const sessionId = accessor.getSessionId();
        const ws = accessor.getWsClient();
        const connected = ws && "isConnected" in ws ? ws.isConnected : false;

        return [
          "🦆 Qwack Status",
          `  Server: ${config?.server ?? "not configured"}`,
          `  Auth: ${config ? "logged in" : "not logged in"}`,
          `  Session: ${sessionId ?? "none"}`,
          `  Connection: ${connected ? "connected" : "disconnected"}`,
        ].join("\n");
      },
    },

    qwack_who: {
      description:
        "List all participants currently online in the Qwack session with their roles. Uses live WebSocket presence data.",
      args: {},
      async execute(): Promise<string> {
        if (!accessor.isActive) {
          return "No active Qwack session.";
        }
        const state = accessor.getCollaboratorState();
        if (!state) return "No collaboration state available.";

        const participants = state.getPresenceList();
        if (participants.length === 0) return "No participants online.";

        const lines = participants.map((p) => {
          const icon = p.role === "host" ? "🎯" : "👤";
          return `  ${icon} ${p.name} (${p.role})`;
        });
        return `🦆 Online (${participants.length}):\n${lines.join("\n")}`;
      },
    },

    qwack_msg: {
      description:
        "Send a message to all collaborators in the current Qwack session. Messages appear with 👤 prefix in all connected clients. Use to communicate decisions, ask questions, or share context.",
      args: {
        message: z.string().describe("The message to send to the team"),
      },
      async execute(args: { message: string }): Promise<string> {
        if (!accessor.isActive) {
          return "No active Qwack session.";
        }
        const ws = accessor.getWsClient();
        if (!ws) return "Not connected to Qwack server.";
        if (!ws.isConnected) return "WebSocket not yet connected. Try again in a moment.";

        const sessionId = accessor.getSessionId()!;
        const sent = ws.send({
          type: "collab:message",
          sessionId,
          senderId: "qwack-agent",
          timestamp: Date.now(),
          payload: { authorName: "Qwack", content: args.message },
        });

        if (!sent) return "Failed to send message — connection dropped.";
        return `👤 Qwack: ${args.message}`;
      },
    },
  };
}

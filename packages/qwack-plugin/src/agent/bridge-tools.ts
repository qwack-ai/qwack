import { z } from "zod/v4";
import { ulid } from "ulid";
import type { QwackToolDefinition } from "./tools";

/**
 * Minimal interface for session access — avoids circular dependency with QwackBridge.
 * QwackBridge implicitly satisfies this interface.
 */
export interface SessionAccessor {
  readonly isActive: boolean;
  getWsClient(): { send(msg: any): void } | null;
  getCollaboratorState(): {
    addProposal(id: string, content: string, reason: string): void;
    getPendingProposals(): { id: string }[];
  } | null;
  getSessionId(): string | null;
}

/**
 * Create tools that reference the bridge dynamically via SessionAccessor.
 * These survive session restarts — execute checks for active session each call.
 * Registered once at plugin load time via Hooks.tool.
 */
export function createBridgeTools(
  accessor: SessionAccessor,
): Record<string, QwackToolDefinition> {
  return {
    qwack_propose: {
      description:
        "Propose a change to the team for review before executing. Use before architectural changes, adding dependencies, or modifying multiple files.",
      args: {
        proposal: z.string().describe("What you want to do — be specific"),
        rationale: z.string().describe("Why this change is needed"),
      },
      async execute(args: { proposal: string; rationale: string }): Promise<string> {
        if (!accessor.isActive) {
          return "No active Qwack session. Run /qwack start first.";
        }
        const ws = accessor.getWsClient()!;
        const state = accessor.getCollaboratorState()!;
        const sessionId = accessor.getSessionId()!;
        const proposalId = ulid();
        state.addProposal(proposalId, args.proposal, args.rationale);
        ws.send({
          type: "agent:plan_propose",
          sessionId,
          senderId: "qwack-agent",
          timestamp: Date.now(),
          payload: { proposalId, content: args.proposal, reason: args.rationale },
        });
        const count = state.getPendingProposals().length;
        return `✅ Proposal sent to team (ID: ${proposalId}). ${count} pending. Continue working — you'll see the response when the team decides.`;
      },
    },

    qwack_disagree: {
      description:
        "Flag a disagreement or concern. Use 'minor' for style issues, 'major' for correctness/security concerns (major pauses execution).",
      args: {
        concern: z.string().describe("What you disagree with and why"),
        severity: z.enum(["minor", "major"]).describe("minor = awareness, major = pause"),
        suggestion: z.string().optional().describe("Alternative approach, if any"),
      },
      async execute(args: {
        concern: string;
        severity: "minor" | "major";
        suggestion?: string;
      }): Promise<string> {
        if (!accessor.isActive) {
          return "No active Qwack session. Run /qwack start first.";
        }
        const ws = accessor.getWsClient()!;
        const sessionId = accessor.getSessionId()!;
        ws.send({
          type: "agent:disagreement",
          sessionId,
          senderId: "qwack-agent",
          timestamp: Date.now(),
          payload: { reason: args.concern, severity: args.severity, suggestion: args.suggestion },
        });
        if (args.severity === "major") {
          return `⚠️ MAJOR disagreement flagged: "${args.concern}". Paused for team discussion.`;
        }
        return `📝 Minor concern noted: "${args.concern}". Shared with team.`;
      },
    },
  };
}

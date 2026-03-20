import { z } from "zod";
import { ulid } from "ulid";
import type { CollaboratorState } from "../state/collaborator-state";
import type { QwackWsClient } from "../ws-client";

/** ToolContext from OpenCode — minimal subset we use */
export interface ToolContext {
  sessionID: string;
  messageID: string;
  agent: string;
  abort: AbortSignal;
}

export interface QwackToolDefinition {
  description: string;
  args: z.ZodRawShape;
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<string>;
}

/**
 * Create Qwack collaboration tools that close over the WS client and state.
 * These get registered via Hooks.tool = { qwack_propose: ..., qwack_disagree: ... }
 */
export function createQwackTools(
  wsClient: QwackWsClient,
  state: CollaboratorState,
  sessionId: string,
): Record<string, QwackToolDefinition> {
  return {
    qwack_propose: {
      description:
        "Propose a change to the team for review before executing. Use this before making architectural changes, adding dependencies, or modifying multiple files. The proposal is sent to all collaborators who can accept or reject it.",
      args: {
        proposal: z.string().describe("What you want to do — be specific"),
        rationale: z
          .string()
          .describe(
            "Why this change is needed and what alternatives you considered",
          ),
      },
      async execute(args: {
        proposal: string;
        rationale: string;
      }): Promise<string> {
        const proposalId = ulid();
        state.addProposal(proposalId, args.proposal, args.rationale);
        wsClient.send({
          type: "agent:plan_propose",
          sessionId,
          senderId: "qwack-agent",
          timestamp: Date.now(),
          payload: {
            proposalId,
            content: args.proposal,
            reason: args.rationale,
          },
        });
        const pendingCount = state.getPendingProposals().length;
        return `✅ Proposal sent to team (ID: ${proposalId}). ${pendingCount} proposal${pendingCount === 1 ? "" : "s"} pending. Continue with other work — you'll see the team's response when they decide.`;
      },
    },

    qwack_disagree: {
      description:
        "Flag a disagreement or concern with the current direction. Use 'minor' for style/preference issues, 'major' for correctness/security concerns (major will pause execution for team discussion).",
      args: {
        concern: z
          .string()
          .describe("What you disagree with and why"),
        severity: z
          .enum(["minor", "major"])
          .describe("minor = flag for awareness, major = pause for discussion"),
        suggestion: z
          .string()
          .optional()
          .describe("Your alternative approach, if any"),
      },
      async execute(args: {
        concern: string;
        severity: "minor" | "major";
        suggestion?: string;
      }): Promise<string> {
        wsClient.send({
          type: "agent:disagreement",
          sessionId,
          senderId: "qwack-agent",
          timestamp: Date.now(),
          payload: {
            reason: args.concern,
            severity: args.severity,
            suggestion: args.suggestion,
          },
        });
        if (args.severity === "major") {
          return `⚠️ MAJOR disagreement flagged: "${args.concern}". Execution paused — waiting for team discussion before proceeding.`;
        }
        return `📝 Minor concern noted: "${args.concern}". Shared with team. Continuing work.`;
      },
    },
  };
}

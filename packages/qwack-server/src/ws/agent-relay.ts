import { broadcastToSession } from "./handler";
import type { WsMessage } from "@qwack/shared";

/** P0 agent events — output, tool use, permissions, completion. */
export const AGENT_EVENT_TYPES = [
  "agent:output",
  "agent:thinking",
  "agent:tool_use",
  "agent:tool_result",
  "agent:permission",
  "agent:permission_response",
  "agent:complete",
] as const;

/** P1 agent-as-peer events — proposals, disagreements, pause/resume. */
export const AGENT_PEER_EVENT_TYPES = [
  "agent:plan_edit",
  "agent:plan_propose",
  "agent:proposal_response",
  "agent:disagreement",
  "agent:pause",
  "agent:resume",
] as const;

export type AgentRelayType = (typeof AGENT_EVENT_TYPES)[number];
export type AgentPeerRelayType = (typeof AGENT_PEER_EVENT_TYPES)[number];

/** All agent event types (P0 + P1) */
export const ALL_AGENT_EVENT_TYPES = [
  ...AGENT_EVENT_TYPES,
  ...AGENT_PEER_EVENT_TYPES,
] as const;

/**
 * Handle any agent:* event — broadcast to all session participants except sender.
 * The host's plugin captures Claude Code events and mirrors them here.
 * Server simply relays to all other connected clients (web + other plugins).
 */
export function handleAgentEvent(
  sessionId: string,
  userId: string,
  type: string,
  payload: unknown,
): void {
  broadcastToSession(
    sessionId,
    {
      type,
      sessionId,
      senderId: userId,
      timestamp: Date.now(),
      payload,
    } satisfies WsMessage,
    userId,
  );
}

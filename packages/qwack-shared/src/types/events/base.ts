// WebSocket event base types

export interface WsMessage<T = unknown> {
  type: string;
  sessionId: string;
  senderId: string;
  timestamp: number;
  payload: T;
  replayed?: boolean;
}

// Event type unions
export type AuthEventType = "auth:token" | "auth:ok" | "auth:error";
export type PresenceEventType = "presence:join" | "presence:leave" | "presence:typing" | "presence:list";
export type CollabEventType = "collab:message";
export type PromptEventType = "prompt:sent" | "prompt:request" | "prompt:execute";
export type AgentEventType = "agent:output" | "agent:tool_use" | "agent:tool_result" | "agent:permission" | "agent:permission_response" | "agent:complete";
export type AgentPeerEventType = "agent:plan_edit" | "agent:plan_propose" | "agent:proposal_response" | "agent:disagreement" | "agent:pause" | "agent:resume";
export type PlanEventType = "plan:sync" | "plan:awareness";
export type SessionEventType = "session:status_change" | "session:host_change" | "session:settings_change" | "session:context_snapshot";

export type EventType =
  | AuthEventType
  | PresenceEventType
  | CollabEventType
  | PromptEventType
  | AgentEventType
  | AgentPeerEventType
  | PlanEventType
  | SessionEventType;

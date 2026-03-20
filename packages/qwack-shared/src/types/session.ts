import type { SESSION_MODES, SESSION_STATUSES, AGENT_AUTONOMY_MODES, PERMISSION_MODELS, DISAGREEMENT_THRESHOLDS, RELAY_MODES } from "../constants";

export type SessionMode = (typeof SESSION_MODES)[number];
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export type AgentAutonomyMode = (typeof AGENT_AUTONOMY_MODES)[number];
export type PermissionModel = (typeof PERMISSION_MODELS)[number];
export type DisagreementThreshold = (typeof DISAGREEMENT_THRESHOLDS)[number];
export type RelayMode = (typeof RELAY_MODES)[number];

export interface Session {
  id: string;
  title: string;
  mode: SessionMode;
  status: SessionStatus;
  creatorId: string;
  opencodeSessionId: string | null;
  agentAutonomy: AgentAutonomyMode;
  permissionModel: PermissionModel;
  disagreementThreshold: DisagreementThreshold;
  canvasContent: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionSettings {
  mode: SessionMode;
  agentAutonomy: AgentAutonomyMode;
  permissionModel: PermissionModel;
  disagreementThreshold: DisagreementThreshold;
}

export interface CreateSessionInput {
  title: string;
  mode: SessionMode;
  agentAutonomy?: AgentAutonomyMode;
  permissionModel?: PermissionModel;
  disagreementThreshold?: DisagreementThreshold;
}

export interface QwackSessionListItem {
  id: string;
  title: string;
  status: SessionStatus;
  creatorId: string;
  participantCount: number;
  hasActiveHost: boolean;
  createdAt: string;
  updatedAt: string;
}

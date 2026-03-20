import type { AGENT_AUTONOMY_MODES, DISAGREEMENT_SEVERITIES } from "../constants";
import { AGENT_DISPLAY_NAME, AGENT_ACCENT_COLOR, AGENT_AVATAR, AGENT_ACTOR_ID } from "../constants";

export type AgentAutonomy = (typeof AGENT_AUTONOMY_MODES)[number];
export type DisagreementSeverity = (typeof DISAGREEMENT_SEVERITIES)[number];

export interface AgentIdentity {
  id: string;
  name: string;
  avatar: string;
  accentColor: string;
}

export const AGENT_IDENTITY: AgentIdentity = {
  id: AGENT_ACTOR_ID,
  name: AGENT_DISPLAY_NAME,
  avatar: AGENT_AVATAR,
  accentColor: AGENT_ACCENT_COLOR,
};

export interface AgentDisagreement {
  severity: DisagreementSeverity;
  message: string;
  context: string;
  timestamp: Date;
}

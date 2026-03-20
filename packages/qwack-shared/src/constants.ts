// @qwack/shared — Constants

export const AGENT_DISPLAY_NAME = "Qwack";
export const AGENT_ACCENT_COLOR = "#E8A317";
export const AGENT_AVATAR = "<(o )___";
export const AGENT_ACTOR_ID = "agent";

export const SESSION_MODES = ["structured", "freeform"] as const;
export const SESSION_STATUSES = ["planning", "queuing", "executing", "paused", "completed"] as const;
export const PARTICIPANT_ROLES = ["host", "collaborator", "viewer"] as const;
export const AGENT_AUTONOMY_MODES = ["full_peer", "propose_only", "hybrid"] as const;
export const PERMISSION_MODELS = ["host_decides", "majority_vote", "anyone_can_veto"] as const;
export const DISAGREEMENT_THRESHOLDS = ["pause_all", "flag_all", "configurable"] as const;
export const RELAY_MODES = ["host", "relay"] as const;
export const PROMPT_STATUSES = ["draft", "voting", "approved", "sent", "rejected"] as const;
export const DISAGREEMENT_SEVERITIES = ["minor", "major"] as const;

// Free tier limits
export const FREE_TIER_MAX_COLLABORATORS = 3;
export const FREE_TIER_MAX_SESSIONS_PER_MONTH = 5;
export const FREE_TIER_HISTORY_DAYS = 7;

// WebSocket / collaboration constants
export const MAX_COLLAB_MESSAGES = 100;
export const WS_HEARTBEAT_MS = 30_000;
export const WS_MAX_RECONNECT_DELAY = 30_000;

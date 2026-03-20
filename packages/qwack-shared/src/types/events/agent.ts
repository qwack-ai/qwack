export interface AgentOutputPayload {
  content: string;
  partId: string;
}

export interface AgentToolUsePayload {
  tool: string;
  input: unknown;
  partId: string;
  messageId?: string;
}

export interface AgentToolResultPayload {
  tool: string;
  output: unknown;
  partId: string;
  messageId?: string;
  error?: string;
  status: "completed" | "error";
}

export interface AgentPermissionPayload {
  tool: string;
  command: string;
  requestId: string;
}

export interface AgentPermissionResponsePayload {
  requestId: string;
  allowed: boolean;
}

export interface AgentCompletePayload {
  messageId: string;
}

export interface AgentPlanEditPayload {
  content: string;
  editType: "insert" | "replace" | "delete";
}

export interface AgentPlanProposePayload {
  proposalId: string;
  content: string;
  reason: string;
}

export interface AgentProposalResponsePayload {
  proposalId: string;
  accepted: boolean;
  responderId: string;
  responderName: string;
  reason?: string;
}

export interface AgentDisagreementPayload {
  severity: "minor" | "major";
  topic: string;
  reason: string;
  suggestion?: string;
}

export interface AgentPausePayload {
  reason: string;
  disagreementTopic?: string;
}

export interface AgentResumePayload {
  resumedBy: string;
  resolution?: string;
}

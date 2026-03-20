import { z } from "zod";

export const AgentOutputPayloadSchema = z.object({
  content: z.string(),
  partId: z.string(),
});

export const AgentToolUsePayloadSchema = z.object({
  tool: z.string(),
  input: z.unknown(),
  partId: z.string(),
  messageId: z.string().optional(),
});

export const AgentToolResultPayloadSchema = z.object({
  tool: z.string(),
  output: z.unknown(),
  partId: z.string(),
  messageId: z.string().optional(),
  error: z.string().optional(),
  status: z.enum(["completed", "error"]),
});

export const AgentPermissionPayloadSchema = z.object({
  tool: z.string(),
  command: z.string(),
  requestId: z.string(),
});

export const AgentPermissionResponsePayloadSchema = z.object({
  requestId: z.string(),
  allowed: z.boolean(),
});

export const AgentCompletePayloadSchema = z.object({
  messageId: z.string(),
});

export const AgentPlanEditPayloadSchema = z.object({
  content: z.string(),
  editType: z.enum(["insert", "replace", "delete"]),
});

export const AgentPlanProposePayloadSchema = z.object({
  proposalId: z.string(),
  content: z.string(),
  reason: z.string(),
});

export const AgentProposalResponsePayloadSchema = z.object({
  proposalId: z.string(),
  accepted: z.boolean(),
  responderId: z.string(),
  responderName: z.string(),
  reason: z.string().optional(),
});

export const AgentDisagreementPayloadSchema = z.object({
  severity: z.enum(["minor", "major"]),
  topic: z.string(),
  reason: z.string(),
  suggestion: z.string().optional(),
});

export const AgentPausePayloadSchema = z.object({
  reason: z.string(),
  disagreementTopic: z.string().optional(),
});

export const AgentResumePayloadSchema = z.object({
  resumedBy: z.string(),
  resolution: z.string().optional(),
});

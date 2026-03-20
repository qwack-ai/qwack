import { z } from "zod";
import {
  SESSION_MODES,
  SESSION_STATUSES,
  AGENT_AUTONOMY_MODES,
  PERMISSION_MODELS,
  DISAGREEMENT_THRESHOLDS,
  RELAY_MODES,
} from "../constants";

export const SessionModeSchema = z.enum(SESSION_MODES);
export const SessionStatusSchema = z.enum(SESSION_STATUSES);
export const AgentAutonomyModeSchema = z.enum(AGENT_AUTONOMY_MODES);
export const PermissionModelSchema = z.enum(PERMISSION_MODELS);
export const DisagreementThresholdSchema = z.enum(DISAGREEMENT_THRESHOLDS);
export const RelayModeSchema = z.enum(RELAY_MODES);

export const SessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  mode: SessionModeSchema,
  status: SessionStatusSchema,
  creatorId: z.string(),
  opencodeSessionId: z.string().nullable(),
  agentAutonomy: AgentAutonomyModeSchema,
  permissionModel: PermissionModelSchema,
  disagreementThreshold: DisagreementThresholdSchema,
  canvasContent: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const SessionSettingsSchema = z.object({
  mode: SessionModeSchema,
  agentAutonomy: AgentAutonomyModeSchema,
  permissionModel: PermissionModelSchema,
  disagreementThreshold: DisagreementThresholdSchema,
});

export const CreateSessionInputSchema = z.object({
  title: z.string().min(1).max(200),
  mode: SessionModeSchema,
  agentAutonomy: AgentAutonomyModeSchema.optional(),
  permissionModel: PermissionModelSchema.optional(),
  disagreementThreshold: DisagreementThresholdSchema.optional(),
});

export const QwackSessionListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: SessionStatusSchema,
  creatorId: z.string(),
  participantCount: z.number().int().nonnegative(),
  hasActiveHost: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

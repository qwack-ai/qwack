import { z } from "zod";
import { AGENT_AUTONOMY_MODES, DISAGREEMENT_SEVERITIES } from "../constants";

export const AgentAutonomySchema = z.enum(AGENT_AUTONOMY_MODES);
export const DisagreementSeveritySchema = z.enum(DISAGREEMENT_SEVERITIES);

export const AgentIdentitySchema = z.object({
  id: z.string(),
  name: z.string(),
  avatar: z.string(),
  accentColor: z.string(),
});

export const AgentDisagreementSchema = z.object({
  severity: DisagreementSeveritySchema,
  message: z.string(),
  context: z.string(),
  timestamp: z.coerce.date(),
});

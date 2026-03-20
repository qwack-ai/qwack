import { z } from "zod";

export const PlanSyncPayloadSchema = z.object({
  update: z.string(),
});

export const PlanAwarenessPayloadSchema = z.object({
  update: z.string(),
});

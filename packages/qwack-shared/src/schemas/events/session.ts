import { z } from "zod";

export const SessionStatusChangePayloadSchema = z.object({
  status: z.string(),
});

export const SessionHostChangePayloadSchema = z.object({
  newHostId: z.string(),
});

export const SessionSettingsChangePayloadSchema = z.object({
  settings: z.record(z.unknown()),
});

export const SessionContextSnapshotPayloadSchema = z.object({
  snapshot: z.string(),
  timestamp: z.number(),
});

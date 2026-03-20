import { z } from "zod";

export const WsMessageSchema = z.object({
  type: z.string(),
  sessionId: z.string(),
  senderId: z.string(),
  timestamp: z.number(),
  payload: z.unknown(),
  replayed: z.boolean().optional(),
});

import { z } from "zod";
import { PROMPT_STATUSES } from "../constants";

export const PromptStatusSchema = z.enum(PROMPT_STATUSES);

export const PromptQueueItemSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  authorId: z.string(),
  content: z.string(),
  status: PromptStatusSchema,
  position: z.number(),
  votesUp: z.number(),
  votesDown: z.number(),
  sentAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});

export const PromptVoteSchema = z.object({
  id: z.string(),
  promptId: z.string(),
  userId: z.string(),
  vote: z.enum(["up", "down"]),
});

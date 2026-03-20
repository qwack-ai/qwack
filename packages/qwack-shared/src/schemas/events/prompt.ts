import { z } from "zod";

export const PromptSentPayloadSchema = z.object({
  authorId: z.string(),
  authorName: z.string(),
  content: z.string(),
});

export const PromptRequestPayloadSchema = z.object({
  authorId: z.string(),
  authorName: z.string(),
  content: z.string(),
});

export const PromptExecutePayloadSchema = z.object({
  content: z.string(),
  requestedBy: z.string(),
});

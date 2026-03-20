import { z } from "zod";

export const CanvasBlockSchema = z.object({
  id: z.string(),
  content: z.string(),
  authorId: z.string(),
  authorType: z.enum(["user", "agent"]),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CanvasAnnotationSchema = z.object({
  id: z.string(),
  blockId: z.string(),
  authorId: z.string(),
  authorType: z.enum(["user", "agent"]),
  content: z.string(),
  type: z.enum(["comment", "suggestion", "disagreement"]),
  createdAt: z.coerce.date(),
});

export const CanvasProposalSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  content: z.string(),
  range: z.object({ start: z.number(), end: z.number() }),
  status: z.enum(["pending", "accepted", "rejected"]),
  createdAt: z.coerce.date(),
});

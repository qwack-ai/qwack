import { z } from "zod";

export const CollabMessagePayloadSchema = z.object({
  authorName: z.string(),
  content: z.string(),
});

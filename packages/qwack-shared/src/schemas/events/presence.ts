import { z } from "zod";
import { UserSchema, RoleSchema, PresenceSchema } from "../user";

export const PresenceJoinPayloadSchema = z.object({
  user: UserSchema,
  role: RoleSchema,
});

export const PresenceLeavePayloadSchema = z.object({
  userId: z.string(),
});

export const PresenceTypingPayloadSchema = z.object({
  userId: z.string(),
});

export const PresenceListPayloadSchema = z.object({
  participants: z.array(PresenceSchema),
});

import { z } from "zod";
import { PARTICIPANT_ROLES } from "../constants";

export const RoleSchema = z.enum(PARTICIPANT_ROLES);

export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const SessionParticipantSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  userId: z.string(),
  role: RoleSchema,
  joinedAt: z.coerce.date(),
});

export const PresenceSchema = z.object({
  userId: z.string(),
  user: UserSchema,
  role: RoleSchema,
  isOnline: z.boolean(),
  isTyping: z.boolean(),
  typingTarget: z.enum(["prompt", "canvas"]).nullable(),
  cursorPosition: z
    .object({ line: z.number(), ch: z.number() })
    .nullable(),
});

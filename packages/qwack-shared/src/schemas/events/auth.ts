import { z } from "zod";
import { UserSchema } from "../user";

export const AuthTokenPayloadSchema = z.object({
  token: z.string(),
});

export const AuthOkPayloadSchema = z.object({
  user: UserSchema,
});

export const AuthErrorPayloadSchema = z.object({
  message: z.string(),
});

import type { User } from "../user";

export interface AuthTokenPayload {
  token: string;
}

export interface AuthOkPayload {
  user: User;
}

export interface AuthErrorPayload {
  message: string;
}

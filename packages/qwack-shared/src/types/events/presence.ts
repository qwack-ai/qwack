import type { User, Role, Presence } from "../user";

export interface PresenceJoinPayload {
  user: User;
  role: Role;
}

export interface PresenceLeavePayload {
  userId: string;
}

export interface PresenceTypingPayload {
  userId: string;
}

export interface PresenceListPayload {
  participants: Presence[];
}

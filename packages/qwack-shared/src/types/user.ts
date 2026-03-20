import type { PARTICIPANT_ROLES } from "../constants";

export type Role = (typeof PARTICIPANT_ROLES)[number];

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionParticipant {
  id: string;
  sessionId: string;
  userId: string;
  role: Role;
  joinedAt: Date;
}

export interface Presence {
  userId: string;
  user: User;
  role: Role;
  isOnline: boolean;
  isTyping: boolean;
  typingTarget: "prompt" | "canvas" | null;
  cursorPosition: { line: number; ch: number } | null;
}

/** Lightweight presence entry used by TUI and plugin (subset of full Presence) */
export interface PresenceEntry {
  id: string;
  name: string;
  role: string;
}

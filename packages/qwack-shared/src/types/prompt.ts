import type { PROMPT_STATUSES } from "../constants";

export type PromptStatus = (typeof PROMPT_STATUSES)[number];

export interface PromptQueueItem {
  id: string;
  sessionId: string;
  authorId: string;
  content: string;
  status: PromptStatus;
  position: number;
  votesUp: number;
  votesDown: number;
  sentAt: Date | null;
  createdAt: Date;
}

export interface PromptVote {
  id: string;
  promptId: string;
  userId: string;
  vote: "up" | "down";
}

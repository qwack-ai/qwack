export interface PromptSentPayload {
  authorId: string;
  authorName: string;
  content: string;
}

export interface PromptRequestPayload {
  authorId: string;
  authorName: string;
  content: string;
}

export interface PromptExecutePayload {
  content: string;
  requestedBy: string;
}

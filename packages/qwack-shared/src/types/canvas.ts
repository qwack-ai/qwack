export interface CanvasBlock {
  id: string;
  content: string;
  authorId: string;
  authorType: "user" | "agent";
  createdAt: Date;
  updatedAt: Date;
}

export interface CanvasAnnotation {
  id: string;
  blockId: string;
  authorId: string;
  authorType: "user" | "agent";
  content: string;
  type: "comment" | "suggestion" | "disagreement";
  createdAt: Date;
}

export interface CanvasProposal {
  id: string;
  sessionId: string;
  content: string;
  range: { start: number; end: number };
  status: "pending" | "accepted" | "rejected";
  createdAt: Date;
}

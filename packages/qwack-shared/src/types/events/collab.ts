export interface CollabMessagePayload {
  authorName: string;
  content: string;
}

export interface CollabMessage extends CollabMessagePayload {
  id: string;
  timestamp: number;
}

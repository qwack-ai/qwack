import { broadcastToSession } from "./handler";
import type { WsMessage, CollabMessagePayload } from "@qwack/shared";

/**
 * Handle collab:message — broadcast collaborator chat to all session participants.
 * Messages appear inline with 👤 name: prefix in terminal and web.
 */
export function handleCollabMessage(
  sessionId: string,
  userId: string,
  payload: unknown,
): void {
  const { authorName, content } = payload as CollabMessagePayload;
  if (!authorName || !content) return;

  broadcastToSession(sessionId, {
    type: "collab:message",
    sessionId,
    senderId: userId,
    timestamp: Date.now(),
    payload: { authorName, content } satisfies CollabMessagePayload,
  } satisfies WsMessage<CollabMessagePayload>, userId);
}

import { broadcastToSession } from "./handler";
import type { WsMessage, PresenceTypingPayload } from "@qwack/shared";

/**
 * Handle presence:typing — broadcast to all other session participants.
 * Join/leave are handled directly in handler.ts onOpen/onClose.
 */
export function handlePresenceTyping(
  sessionId: string,
  userId: string,
  _payload: unknown,
): void {
  broadcastToSession(
    sessionId,
    {
      type: "presence:typing",
      sessionId,
      senderId: userId,
      timestamp: Date.now(),
      payload: { userId } satisfies PresenceTypingPayload,
    } satisfies WsMessage<PresenceTypingPayload>,
    userId,
  );
}

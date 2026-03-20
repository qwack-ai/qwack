import { broadcastToSession, sendToUser, getHostUserId } from "./handler"
import type { WsMessage, PromptSentPayload, PromptExecutePayload } from "@qwack/shared"

const MAX_BUFFERED_PROMPTS = 20
export const MAX_PROMPT_LENGTH = 100_000

// Buffered prompts for when host is disconnected
// sessionId → prompt messages awaiting delivery
const promptBuffer = new Map<string, Array<WsMessage<PromptExecutePayload>>>()

/**
 * Host sent a prompt to OpenCode — broadcast to all other participants.
 * This mirrors the prompt to web users and other terminal collaborators.
 */
export function handlePromptSent(sessionId: string, userId: string, payload: unknown): void {
  broadcastToSession(
    sessionId,
    {
      type: "prompt:sent",
      sessionId,
      senderId: userId,
      timestamp: Date.now(),
      payload: payload as PromptSentPayload,
    } satisfies WsMessage<PromptSentPayload>,
    userId,
  )
}

/**
 * Non-host requests prompt execution — relay to host only.
 * If host is disconnected, buffer the prompt for later delivery.
 */
export function handlePromptRequest(sessionId: string, userId: string, payload: unknown): void {
  const requestPayload = payload as Record<string, unknown>
  const content = requestPayload.content as string | undefined
  if (typeof content === "string" && content.length > MAX_PROMPT_LENGTH) {
    return
  }

  const hostUserId = getHostUserId(sessionId)
  const executeMsg: WsMessage<PromptExecutePayload> = {
    type: "prompt:execute",
    sessionId,
    senderId: userId,
    timestamp: Date.now(),
    payload: {
      content: requestPayload.content as string,
      requestedBy: userId,
    } satisfies PromptExecutePayload,
  }

  if (hostUserId) {
    sendToUser(sessionId, hostUserId, executeMsg)
  } else {
    // Driver not connected — buffer for later delivery
    bufferPrompt(sessionId, executeMsg)
  }

  broadcastToSession(
    sessionId,
    {
      type: "prompt:sent",
      sessionId,
      senderId: userId,
      timestamp: Date.now(),
      payload: {
        authorId: userId,
        authorName: (requestPayload.authorName as string) ?? userId,
        content: requestPayload.content as string,
      } satisfies PromptSentPayload,
    } satisfies WsMessage<PromptSentPayload>,
    userId,
  )
}

function bufferPrompt(sessionId: string, msg: WsMessage<PromptExecutePayload>): void {
  if (!promptBuffer.has(sessionId)) {
    promptBuffer.set(sessionId, [])
  }
  const buf = promptBuffer.get(sessionId)!
  if (buf.length < MAX_BUFFERED_PROMPTS) {
    buf.push(msg)
  }
}

/**
 * Deliver buffered prompts to the host when they reconnect.
 * Called by the connection handler in register-handlers.ts.
 */
export function flushBufferedPrompts(sessionId: string, hostUserId: string): void {
  const buf = promptBuffer.get(sessionId)
  if (!buf || buf.length === 0) return
  for (const msg of buf) {
    sendToUser(sessionId, hostUserId, msg)
  }
  promptBuffer.delete(sessionId)
}

/** Clear buffer for a session (e.g. session ends). */
export function clearPromptBuffer(sessionId: string): void {
  promptBuffer.delete(sessionId)
}

/** Get buffered prompt count (for testing). */
export function getBufferedPromptCount(sessionId: string): number {
  return promptBuffer.get(sessionId)?.length ?? 0
}

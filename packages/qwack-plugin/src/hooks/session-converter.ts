import type { WsMessage } from "@qwack/shared"

/** A simplified message structure matching what the OpenCode SDK returns */
export interface SessionMessage {
  info: {
    id: string
    role: "user" | "assistant"
    time: { created: number; completed?: number }
  }
  parts: Array<{
    id: string
    type: string
    text?: string
    tool?: string
    state?: {
      status: string
      input?: unknown
      output?: string
      error?: string
      metadata?: Record<string, unknown>
    }
  }>
}

/**
 * Convert OpenCode session messages into Qwack WS events.
 * Used by /qshare to push local session history to the server.
 * All events are marked with `replayed: true` at the envelope level.
 */
export function convertSessionToEvents(
  messages: SessionMessage[],
  sessionId: string,
  userId: string,
  userName: string,
): WsMessage[] {
  const events: WsMessage[] = []

  for (const msg of messages) {
    const ts = msg.info.time.created

    if (msg.info.role === "user") {
      const textParts = msg.parts.filter((p) => p.type === "text" && p.text)
      const content = textParts.map((p) => p.text).join("\n")
      if (content) {
        events.push({
          type: "prompt:sent",
          sessionId,
          senderId: userId,
          timestamp: ts,
          payload: { authorId: userId, authorName: userName, content },
          replayed: true,
        })
      }
    } else if (msg.info.role === "assistant") {
      for (const part of msg.parts) {
        if (part.type === "text" && part.text) {
          events.push({
            type: "agent:output",
            sessionId,
            senderId: userId,
            timestamp: ts,
            payload: { content: part.text, partId: part.id },
            replayed: true,
          })
        } else if (part.type === "reasoning" && part.text) {
          events.push({
            type: "agent:thinking",
            sessionId,
            senderId: userId,
            timestamp: ts,
            payload: { content: part.text, partId: part.id },
            replayed: true,
          })
        } else if (part.type === "tool" && part.tool) {
          events.push({
            type: "agent:tool_use",
            sessionId,
            senderId: userId,
            timestamp: ts,
            payload: {
              tool: part.tool,
              input: part.state?.input ?? {},
              partId: part.id,
              messageId: msg.info.id,
            },
            replayed: true,
          })

          if (part.state?.status === "completed" || part.state?.status === "error") {
            events.push({
              type: "agent:tool_result",
              sessionId,
              senderId: userId,
              timestamp: ts,
              payload: {
                tool: part.tool,
                output: part.state.output ?? "",
                metadata: part.state.metadata,
                partId: part.id,
                messageId: msg.info.id,
                status: part.state.status as "completed" | "error",
                error: part.state.status === "error" ? (part.state.error ?? "Unknown error") : undefined,
              },
              replayed: true,
            })
          }
        }
      }

      events.push({
        type: "agent:complete",
        sessionId,
        senderId: userId,
        timestamp: msg.info.time.completed ?? ts,
        payload: { messageId: msg.info.id },
        replayed: true,
      })
    }
  }

  return events
}

/**
 * Per-session event buffer — stores relayed events in memory
 * so late joiners receive full history on connect.
 *
 * Agent output/thinking deltas are aggregated into complete messages
 * before replay (no streaming animation for history).
 */

const MAX_EVENTS_PER_SESSION = 500

export interface BufferedEvent {
  type: string
  senderId: string
  timestamp: number
  payload: Record<string, unknown>
  replayed?: boolean
}

/** Raw event buffer per session. */
const buffers = new Map<string, BufferedEvent[]>()

/** Latest context snapshot per session (overwrites each time). */
const contextSnapshots = new Map<string, string>()

export function setContextSnapshot(sessionId: string, snapshot: string): void {
  contextSnapshots.set(sessionId, snapshot)
}

export function getContextSnapshot(sessionId: string): string | null {
  return contextSnapshots.get(sessionId) ?? null
}

export function clearContextSnapshot(sessionId: string): void {
  contextSnapshots.delete(sessionId)
}

/** Event types worth buffering (skip presence, ping, plan-sync). */
const BUFFERED_TYPES = new Set(["prompt:sent", "collab:message", "agent:output", "agent:thinking", "agent:complete", "agent:tool_use", "agent:tool_result"])

export function bufferEvent(sessionId: string, event: BufferedEvent): void {
  if (!BUFFERED_TYPES.has(event.type)) return

  if (!buffers.has(sessionId)) {
    buffers.set(sessionId, [])
  }
  const buf = buffers.get(sessionId)!
  buf.push(event)
  while (buf.length > MAX_EVENTS_PER_SESSION) buf.shift()
}

/**
 * Aggregate agent output/thinking deltas by messageId into single complete events.
 * Other events pass through unchanged. Pure function — no side effects.
 *
 * Agent output/thinking deltas are accumulated by messageId+type.
 * When agent:complete is encountered, accumulated content is flushed.
 * Non-agent events trigger a flush of pending content (preserves ordering).
 * Any remaining pending content is flushed at the end.
 */
export function aggregateEvents(raw: BufferedEvent[]): BufferedEvent[] {
  const result: BufferedEvent[] = []

  // Aggregate agent deltas: messageId+type → accumulated content
  const agentAcc = new Map<string, { content: string; type: string; senderId: string; firstTimestamp: number; replayed?: boolean }>()

  for (const evt of raw) {
    const payload = evt.payload as Record<string, unknown> | undefined


    if (evt.type === "agent:output" || evt.type === "agent:thinking") {
      const messageId = (evt.payload.messageId as string) ?? "unknown"
      const key = `${messageId}-${evt.type}`
      const existing = agentAcc.get(key)
      if (existing) {
        existing.content += (evt.payload.content as string) ?? ""
      } else {
        agentAcc.set(key, {
          content: (evt.payload.content as string) ?? "",
          type: evt.type,
          senderId: evt.senderId,
          firstTimestamp: evt.timestamp,
          replayed: evt.replayed ?? undefined,
        })
      }
    } else if (evt.type === "agent:complete") {
      // Flush accumulated agent content for this messageId
      const messageId = (evt.payload.messageId as string) ?? "unknown"
      for (const suffix of ["-agent:thinking", "-agent:output"]) {
        const key = `${messageId}${suffix}`
        const acc = agentAcc.get(key)
        if (acc) {
          const payload: Record<string, unknown> = { content: acc.content, messageId, complete: true }
          const entry: BufferedEvent = {
            type: acc.type,
            senderId: acc.senderId,
            timestamp: acc.firstTimestamp,
            payload,
          }
          if (acc.replayed) entry.replayed = true
          result.push(entry)
          agentAcc.delete(key)
        }
      }
      // Include the complete event itself
      result.push(evt)
    } else {
      // Flush any pending agent content before non-agent events (preserves ordering)
      flushPending(agentAcc, result)
      result.push(evt)
    }
  }

  // Flush any remaining (still-streaming) agent content
  flushPending(agentAcc, result)

  return result
}

/**
 * Build replay history for a late joiner.
 *
 * Agent output/thinking deltas are aggregated by messageId into
 * single complete events (no streaming). Other events pass through as-is.
 */
export function getReplayHistory(sessionId: string): BufferedEvent[] {
  const raw = buffers.get(sessionId)
  if (!raw || raw.length === 0) return []

  return aggregateEvents([...raw])
}

function flushPending(
  acc: Map<string, { content: string; type: string; senderId: string; firstTimestamp: number; replayed?: boolean }>,
  result: BufferedEvent[],
): void {
  for (const [key, val] of acc) {
    const messageId = key.split("-agent:")[0]
    const payload: Record<string, unknown> = { content: val.content, messageId, complete: true }
    const entry: BufferedEvent = {
      type: val.type,
      senderId: val.senderId,
      timestamp: val.firstTimestamp,
      payload,
    }
    if (val.replayed) entry.replayed = true
    result.push(entry)
  }
  acc.clear()
}

export function clearSessionBuffer(sessionId: string): void {
  buffers.delete(sessionId)
}

/** For testing only. */
export function clearAllBuffers(): void {
  buffers.clear()
  contextSnapshots.clear()
}

import { ulid } from "ulid"
import type { IRepository } from "../repo/types"
import {
  bufferEvent as memoryBufferEvent,
  getReplayHistory as memoryGetReplayHistory,
  setContextSnapshot as memorySetContextSnapshot,
  getContextSnapshot as memoryGetContextSnapshot,
  clearSessionBuffer,
  clearAllBuffers,
  clearContextSnapshot,
  aggregateEvents,
  type BufferedEvent,
} from "./event-buffer"

export { clearSessionBuffer, clearAllBuffers, clearContextSnapshot, aggregateEvents, type BufferedEvent }

let _repo: IRepository | null = null
let _pendingWrites: Array<{ sessionId: string; event: BufferedEvent }> = []
let _flushTimer: ReturnType<typeof setTimeout> | null = null
const FLUSH_INTERVAL_MS = 100
const MAX_PENDING = 50

function deriveActorType(type: string): "user" | "agent" | "system" {
  if (type.startsWith("agent:")) return "agent"
  if (type.startsWith("session:")) return "system"
  return "user"
}

export function initEventStore(repo: IRepository): void {
  _repo = repo
}

export function bufferEvent(sessionId: string, event: BufferedEvent): void {
  memoryBufferEvent(sessionId, event)
  if (!_repo) return

  _pendingWrites.push({ sessionId, event })

  if (_pendingWrites.length >= MAX_PENDING) {
    flushPendingWrites().catch(() => {})
    return
  }

  if (!_flushTimer) {
    _flushTimer = setTimeout(() => {
      _flushTimer = null
      flushPendingWrites().catch(() => {})
    }, FLUSH_INTERVAL_MS)
  }
}

export async function getReplayHistory(sessionId: string): Promise<BufferedEvent[]> {
  const memoryResult = memoryGetReplayHistory(sessionId)
  if (memoryResult.length > 0) return memoryResult

  if (!_repo) return []
  return loadSessionEvents(sessionId)
}

export async function setContextSnapshot(sessionId: string, snapshot: string): Promise<void> {
  memorySetContextSnapshot(sessionId, snapshot)
  if (!_repo) return

  try {
    await _repo.setContextSnapshot(sessionId, snapshot)
  } catch (e) {
    console.error(`[EventStore] Failed to write context snapshot for session ${sessionId}:`, e)
  }
}

export async function getContextSnapshot(sessionId: string): Promise<string | null> {
  const memoryResult = memoryGetContextSnapshot(sessionId)
  if (memoryResult !== null) return memoryResult

  if (!_repo) return null

  try {
    return await _repo.getContextSnapshot(sessionId)
  } catch (e) {
    console.error(`[EventStore] Failed to read context snapshot for session ${sessionId}:`, e)
    return null
  }
}

export async function loadSessionEvents(sessionId: string, limit = 500): Promise<BufferedEvent[]> {
  if (!_repo) return []

  try {
    const rows = await _repo.getEvents(sessionId, limit)

    const events: BufferedEvent[] = rows.map((row) => ({
      type: row.type,
      senderId: row.actorId ?? "system",
      timestamp: row.timestamp * 1000,
      payload: JSON.parse(row.payload),
    }))

    return aggregateEvents(events)
  } catch (e) {
    console.error(`[EventStore] Failed to load session events for session ${sessionId}:`, e)
    return []
  }
}

export async function flushPendingWrites(): Promise<void> {
  if (_flushTimer) {
    clearTimeout(_flushTimer)
    _flushTimer = null
  }

  if (!_repo || _pendingWrites.length === 0) return

  const batch = _pendingWrites.splice(0)

  for (const { sessionId, event } of batch) {
    try {
      await _repo.putEvent({
        id: ulid(),
        sessionId,
        timestamp: Math.floor(event.timestamp / 1000),
        type: event.type,
        actorType: deriveActorType(event.type),
        actorId: event.senderId,
        payload: JSON.stringify(event.payload),
      })
    } catch {
      // FK constraint fails if session not yet in DB — safe to skip
    }
  }
}

export async function shutdownEventStore(): Promise<void> {
  await flushPendingWrites()
  if (_flushTimer) {
    clearTimeout(_flushTimer)
    _flushTimer = null
  }
  _repo = null
}

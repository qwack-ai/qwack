import {
  broadcastToSession,
  sendToUser,
  setUserRole,
  getRawSessionMeta,
  registerCleanupCallback,
} from "./connection-registry"
import { getContextSnapshot } from "./event-store"
import { flushBufferedPrompts } from "./prompts"

const hostGraceTimers = new Map<string, ReturnType<typeof setTimeout>>()
let HOST_GRACE_PERIOD_MS = 5000

/** Auto-promote the next connected collaborator to host after grace period. */
export async function autoPromoteHost(sessionId: string): Promise<void> {
  const meta = getRawSessionMeta().get(sessionId)
  if (!meta || meta.size === 0) return

  const newHostId = meta.keys().next().value
  if (!newHostId) return

  setUserRole(sessionId, newHostId, "host")

  broadcastToSession(sessionId, {
    type: "session:host_change",
    sessionId,
    senderId: "system",
    timestamp: Date.now(),
    payload: { newHostId },
  })

  const snapshot = await getContextSnapshot(sessionId)
  if (snapshot) {
    sendToUser(sessionId, newHostId, {
      type: "session:context_snapshot",
      sessionId,
      senderId: "system",
      timestamp: Date.now(),
      payload: { snapshot, timestamp: Date.now() },
    })
  }

  flushBufferedPrompts(sessionId, newHostId)
}

/** Start a host grace timer (called from onClose, exported for testing). */
export function startGraceTimer(sessionId: string): void {
  const timer = setTimeout(() => {
    hostGraceTimers.delete(sessionId)
    autoPromoteHost(sessionId).catch(() => {})
  }, HOST_GRACE_PERIOD_MS)
  hostGraceTimers.set(sessionId, timer)
}

/** Cancel grace timer for reconnecting host (called from onOpen, exported for testing). */
export function cancelGraceTimer(sessionId: string): boolean {
  const timer = hostGraceTimers.get(sessionId)
  if (!timer) return false
  clearTimeout(timer)
  hostGraceTimers.delete(sessionId)
  return true
}

/** Check if a grace timer is running for a session (for testing). */
export function hasGraceTimer(sessionId: string): boolean {
  return hostGraceTimers.has(sessionId)
}

/** Clear host grace timers (for testing). */
export function clearHostGraceTimers(): void {
  for (const timer of hostGraceTimers.values()) clearTimeout(timer)
  hostGraceTimers.clear()
}

/** Set grace period duration (for testing — avoids 5s waits). */
export function setHostGracePeriod(ms: number): void {
  HOST_GRACE_PERIOD_MS = ms
}

registerCleanupCallback(clearHostGraceTimers)

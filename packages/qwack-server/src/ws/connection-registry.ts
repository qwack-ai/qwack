import type { WSContext } from "hono/ws"
import type { ServerWebSocket } from "bun"

export type WsConn = WSContext<ServerWebSocket>

const sessions = new Map<string, Map<string, WsConn[]>>()

export type UserMeta = { id: string; name: string; role: string }
const sessionMeta = new Map<string, Map<string, UserMeta>>()

export function getSessionMeta(sessionId: string): Map<string, UserMeta> {
  if (!sessionMeta.has(sessionId)) {
    sessionMeta.set(sessionId, new Map())
  }
  return sessionMeta.get(sessionId)!
}

export function getSessionConnections(sessionId: string): Map<string, WsConn[]> {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, new Map())
  }
  return sessions.get(sessionId)!
}

export function hasActiveConnections(sessionId: string): boolean {
  const room = sessions.get(sessionId)
  if (!room) return false
  for (const conns of room.values()) {
    if (conns.length > 0) return true
  }
  return false
}

export function broadcastToSession(sessionId: string, message: unknown, excludeUserId?: string): void {
  const room = sessions.get(sessionId)
  if (!room) return
  const data = JSON.stringify(message)
  for (const [uid, conns] of room) {
    if (uid !== excludeUserId) {
      for (const ws of conns) {
        try { ws.send(data) } catch {}
      }
    }
  }
}

export function sendToUser(sessionId: string, userId: string, message: unknown): void {
  const conns = sessions.get(sessionId)?.get(userId)
  if (conns) {
    const data = JSON.stringify(message)
    for (const ws of conns) {
      try {
        ws.send(data)
      } catch {
        /* disconnected */
      }
    }
  }
}

/** Remove ALL connections for a userId. Used by tests and full disconnect. */
export function removeConnection(sessionId: string, userId: string): void {
  const room = sessions.get(sessionId)
  if (room) {
    room.delete(userId)
    if (room.size === 0) sessions.delete(sessionId)
  }
  const meta = sessionMeta.get(sessionId)
  if (meta) {
    meta.delete(userId)
    if (meta.size === 0) sessionMeta.delete(sessionId)
  }
}

/** Remove a specific WebSocket from a userId's connection list. */
export function removeConnectionWs(sessionId: string, userId: string, ws: WsConn): boolean {
  const room = sessions.get(sessionId)
  if (!room) return true
  const conns = room.get(userId)
  if (!conns) return true
  const idx = conns.indexOf(ws)
  if (idx !== -1) conns.splice(idx, 1)
  if (conns.length === 0) {
    room.delete(userId)
    const meta = sessionMeta.get(sessionId)
    if (meta) {
      meta.delete(userId)
      if (meta.size === 0) sessionMeta.delete(sessionId)
    }
    if (room.size === 0) sessions.delete(sessionId)
    return true // last connection for this user
  }
  return false // user still has other connections
}

/** Returns the number of unique users connected to a session. */
export function getConnectionCount(sessionId: string): number {
  return sessions.get(sessionId)?.size ?? 0
}

/** Find the userId with role 'host' in a session, if connected. */
export function getHostUserId(sessionId: string): string | null {
  const meta = sessionMeta.get(sessionId)
  if (!meta) return null
  for (const [uid, m] of meta) {
    if (m.role === "host") return uid
  }
  return null
}

/** Update a user's role in session metadata. */
export function setUserRole(sessionId: string, userId: string, role: string): void {
  const meta = sessionMeta.get(sessionId)
  if (!meta) return
  const entry = meta.get(userId)
  if (entry) entry.role = role
}

/** Set user metadata (for testing and host assignment). */
export function setUserMeta(sessionId: string, userId: string, meta: UserMeta): void {
  const sessionMetaMap = getSessionMeta(sessionId)
  sessionMetaMap.set(userId, meta)
}

export type MessageHandler = (sessionId: string, userId: string, payload: unknown, ws: WsConn) => void

const messageHandlers = new Map<string, MessageHandler>()

export function registerHandler(prefix: string, handler: MessageHandler): void {
  messageHandlers.set(prefix, handler)
}

export type ConnectionHandler = (sessionId: string, userId: string, ws: WsConn) => void | Promise<void>

const connectionHandlers: ConnectionHandler[] = []

export function registerConnectionHandler(handler: ConnectionHandler): void {
  connectionHandlers.push(handler)
}

export function getConnectionHandlers(): ConnectionHandler[] {
  return connectionHandlers
}

export function clearHandlerRegistrations(): void {
  messageHandlers.clear()
  connectionHandlers.length = 0
}

export function getHandlerForType(type: string): MessageHandler | undefined {
  if (messageHandlers.has(type)) return messageHandlers.get(type)
  for (const [key, handler] of messageHandlers) {
    if (type.startsWith(key)) return handler
  }
  return undefined
}

const cleanupCallbacks: Array<() => void> = []

export function registerCleanupCallback(cb: () => void): void {
  cleanupCallbacks.push(cb)
}

/** For testing only. */
export function clearAllConnections(): void {
  sessions.clear()
  messageHandlers.clear()
  connectionHandlers.length = 0
  sessionMeta.clear()
  for (const cb of cleanupCallbacks) cb()
}

/** Raw access to sessionMeta for host-failover (avoids circular deps). */
export function getRawSessionMeta(): Map<string, Map<string, UserMeta>> {
  return sessionMeta
}

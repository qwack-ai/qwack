import { Hono } from "hono"
import { createBunWebSocket } from "hono/bun"
import type { ServerWebSocket } from "bun"
import { verifyToken } from "../auth/middleware"
import type { IRepository } from "../repo/types"
import {
  getSessionConnections,
  getSessionMeta,
  getRawSessionMeta,
  broadcastToSession,
  removeConnectionWs,
  getHandlerForType,
  getConnectionHandlers,
  hasActiveConnections,
} from "./connection-registry"
import type { WsConn } from "./connection-registry"
import { cancelGraceTimer, startGraceTimer } from "./host-failover"

export * from "./connection-registry"
export * from "./host-failover"

let _repo: IRepository | null = null

/** Set the repository reference used by the WS handler for user name lookups. */
export function setWsRepo(repo: IRepository): void {
  _repo = repo
}

/** Check if user is a participant in the session. Returns true if repo unavailable. */
async function isSessionParticipant(sessionId: string, userId: string): Promise<boolean> {
  if (!_repo || !sessionId) return true
  try {
    const count = await _repo.getParticipantCount(sessionId)
    if (count === 0) return true // new session, allow
    return await _repo.isParticipant(sessionId, userId)
  } catch {
    return true
  }
}

/** Look up user display name from repo. Returns null if not found. */
async function lookupUserName(userId: string): Promise<string | null> {
  if (!_repo) return null
  try {
    const user = await _repo.getUserById(userId)
    return user?.name ?? null
  } catch {
    return null
  }
}

function assignRole(sessionId: string, userId: string, userName: string): string {
  const meta = getSessionMeta(sessionId)
  const existing = meta.get(userId)
  if (existing) {
    existing.name = userName
    return existing.role
  }
  const hasHost = Array.from(meta.values()).some((m) => m.role === "host")
  const role = hasHost ? "collaborator" : "host"
  meta.set(userId, { id: userId, name: userName, role })
  return role
}

const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>()
export { websocket }

export const wsApp = new Hono()

wsApp.get(
  "/ws",
  upgradeWebSocket((c) => {
    const token = c.req.query("token")
    const sessionId = c.req.query("sessionId") ?? ""
    const name = c.req.query("name")
    let userId: string | null = null
    let authResolved = false
    let connWs: WsConn | null = null

    return {
      async onOpen(_event, ws) {
        if (!token || !token.trim()) {
          ws.close(4001, "Missing token")
          return
        }

        userId = await verifyToken(token)
        if (!userId) {
          ws.close(4001, "Invalid token")
          return
        }

        authResolved = true
        connWs = ws

        const room = getSessionConnections(sessionId)
        const existing = room.get(userId)
        if (existing) {
          existing.push(ws)
        } else {
          room.set(userId, [ws])
        }

        const userName = name || (await lookupUserName(userId)) || userId
        const role = assignRole(sessionId, userId, userName)

        if (role === "host") cancelGraceTimer(sessionId)
        if (_repo) {
          _repo.updateSession(sessionId, { status: "active" }).catch(() => {})
        }

        ws.send(
          JSON.stringify({
            type: "auth:ok",
            sessionId,
            senderId: "system",
            timestamp: Date.now(),
            payload: { user: { id: userId, name: userName, role } },
          }),
        )

        broadcastToSession(
          sessionId,
          {
            type: "presence:join",
            sessionId,
            senderId: userId,
            timestamp: Date.now(),
            payload: { user: { id: userId, name: userName }, role },
          },
          userId,
        )

        const participants = Array.from(getSessionMeta(sessionId).values())
        ws.send(
          JSON.stringify({
            type: "presence:list",
            sessionId,
            senderId: "system",
            timestamp: Date.now(),
            payload: { participants },
          }),
        )

        for (const handler of getConnectionHandlers()) {
          try {
            await handler(sessionId, userId, ws)
          } catch (e) {
            console.error(`[WS] Connection handler error for user ${userId} in session ${sessionId}:`, e)
          }
        }
      },

      onMessage(event, ws) {
        if (!authResolved || !userId) return
        try {
          const raw = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer)
          const { type, payload } = JSON.parse(raw)
          if (type === "ping") return

          const handler = getHandlerForType(type)
          if (handler) handler(sessionId, userId, payload, ws)
        } catch {
          ws.send(JSON.stringify({ type: "error", payload: { message: "Invalid message format" } }))
        }
      },

      onClose() {
        if (!userId || !connWs) return
        const meta = getRawSessionMeta().get(sessionId)
        const wasHost = meta?.get(userId)?.role === "host"
        const wasLast = removeConnectionWs(sessionId, userId, connWs)
        if (wasLast) {
          broadcastToSession(sessionId, {
            type: "presence:leave",
            sessionId,
            senderId: userId,
            timestamp: Date.now(),
            payload: { userId },
          })
          if (wasHost) {
            startGraceTimer(sessionId)
          }
          if (!hasActiveConnections(sessionId) && _repo) {
            _repo.updateSession(sessionId, { status: "inactive" }).catch(() => {})
          }
        }
      },

      onError(error) {
        console.error(`[WS] Error for user ${userId} in session ${sessionId}:`, error)
      },
    }
  }),
)
